// R1/R2 integration probe. PDF text remains in renderer memory; only numeric
// diagnostics leave the app. No output includes paths, names, hashes or text.
import { readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

if (process.env.ANONLY_NER_BATCH_REAL_RUN !== "1")
  throw new Error("Set ANONLY_NER_BATCH_REAL_RUN=1");
for (const key of ["ANONLY_REAL_DOC_R1", "ANONLY_REAL_DOC_R2"])
  if (!process.env[key]) throw new Error(`${key} is required`);
const root = process.cwd();
const appRequire = createRequire(resolve(root, "apps/desktop-shell/package.json"));
const clientRequire = createRequire(resolve(root, "apps/react-client/package.json"));
const esbuild = createRequire(clientRequire.resolve("vite"))("esbuild");
const { _electron: electron } = appRequire("@playwright/test");
const sourcePath = resolve(root, "tests/perf/ner-batch-feasibility.mjs");
const source = readFileSync(sourcePath, "utf8");
const probe = source.match(/const probe = `([\s\S]*?)`;\nconst build/);
if (!probe) throw new Error("Synthetic browser probe source not found");
const kernelPath = resolve(root, "packages/anonymization-core/ner-engine/src/worker/kernel.ts");
const kernel = readFileSync(kernelPath, "utf8");
const bundle = await esbuild.build({
  stdin: {
    contents: kernel + probe[1],
    resolveDir: resolve(root, "packages/anonymization-core/ner-engine/src/worker"),
    sourcefile: kernelPath,
    loader: "ts",
  },
  bundle: true,
  alias: { "@anonly/shared": resolve(root, "packages/anonymization-core/shared/src/index.ts") },
  platform: "browser",
  format: "iife",
  globalName: "NerBatchProbe",
  target: "es2022",
  write: false,
  logLevel: "warning",
});
const assetNames = readdirSync(resolve(root, "apps/react-client/dist/assets"));
const wasm = assetNames.find((name) => /^ort-wasm.*\.wasm$/.test(name));
const mjs = assetNames.find((name) => /^ort-wasm.*\.mjs$/.test(name));
if (!wasm || !mjs) throw new Error("ONNX WASM assets absent");

const results = [];
let failed = false;
for (const profile of ["R1", "R2"]) {
  const pdf = readFileSync(process.env[`ANONLY_REAL_DOC_${profile}`]);
  const appDir = resolve(root, "apps/desktop-shell");
  const userDataDir = `/tmp/anonly-ner-batch-real-${process.pid}-${profile}`;
  const app = await electron.launch({
    args: [appDir, `--user-data-dir=${userDataDir}`],
    executablePath: resolve(appDir, "node_modules/.bin/electron"),
  });
  let page;
  let stage = "import";
  try {
    page = await app.firstWindow();
    await page.waitForLoadState("load");
    await page.addInitScript(() => {
      const captured = [];
      const nerWorkers = new WeakSet();
      const state = {
        captured,
        seenWorkers: 0,
        terminatedWorkers: 0,
        done: false,
        failed: false,
        substage: "init",
      };
      Object.defineProperty(globalThis, "__nerBatchReal", { value: state, configurable: true });
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, ...transfer) {
        if (
          typeof message === "object" &&
          message !== null &&
          message.type === "RUN" &&
          message.jobType === "ner-page" &&
          typeof message.payload?.text === "string"
        ) {
          captured.push({ text: message.payload.text, pageIndex: message.payload.pageIndex });
          if (!nerWorkers.has(this)) {
            nerWorkers.add(this);
            state.seenWorkers++;
          }
        }
        return Reflect.apply(post, this, [message, ...transfer]);
      };
      const terminate = Worker.prototype.terminate;
      Worker.prototype.terminate = function () {
        if (nerWorkers.has(this)) state.terminatedWorkers++;
        return Reflect.apply(terminate, this, []);
      };
    });
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => {
      const core = globalThis.__anonlyCore;
      const state = globalThis.__nerBatchReal;
      if (!core || !state) throw new Error("Core/probe missing");
      core.bus.on("pipeline", "PIPELINE_READY", () => {
        state.done = true;
      });
      core.bus.on("pipeline", "PIPELINE_FAILED", () => {
        state.failed = true;
        state.done = true;
      });
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "document.pdf", mimeType: "application/pdf", buffer: pdf });
    await page.waitForFunction(() => globalThis.__nerBatchReal?.done === true, undefined, {
      timeout: 1_800_000,
    });
    stage = "capture";
    const imported = await page.evaluate(() => ({
      failed: globalThis.__nerBatchReal.failed,
      pageCount: globalThis.__nerBatchReal.captured.length,
    }));
    if (imported.failed || imported.pageCount < 4)
      throw new Error(`${profile} import did not yield enough successful NER page jobs`);
    // ADR-167: let the actual NER pool idle-dispose at its configured 15 s.
    stage = "idle";
    await delay(16_000);
    const disposed = await page.evaluate(() => ({
      seen: globalThis.__nerBatchReal.seenWorkers,
      terminated: globalThis.__nerBatchReal.terminatedWorkers,
    }));
    if (disposed.seen === 0 || disposed.terminated < disposed.seen)
      throw new Error(`${profile} NER worker did not idle-dispose; refusing a second loaded model`);
    stage = "load";
    await page.evaluate(async (sourceText) => {
      const url = URL.createObjectURL(new Blob([sourceText], { type: "text/javascript" }));
      await new Promise((ok, fail) => {
        const script = document.createElement("script");
        script.src = url;
        script.onload = ok;
        script.onerror = fail;
        document.head.append(script);
      });
    }, bundle.outputFiles[0].text);
    stage = "batch";
    const report = await page.evaluate(
      async ({ modelId, wasmPaths }) => {
        const captured = globalThis.__nerBatchReal.captured;
        const ordered = [...captured].sort((a, b) => a.pageIndex - b.pageIndex);
        const charsByPage = ordered.map((item) => item.text.length);
        const wordsByPage = ordered.map(
          (item) => item.text.trim().split(/\s+/u).filter(Boolean).length,
        );
        globalThis.__nerBatchReal.substage = "tokenCount";
        const pageTokenCounts = await NerBatchProbe.tokenCounts(
          ordered.map((item) => item.text),
          modelId,
          wasmPaths,
        );
        const tokenized = ordered.map((item, index) => ({ item, tokens: pageTokenCounts[index] }));
        globalThis.__nerBatchReal.substage = "eligibility";
        const eligible = tokenized.filter((entry) => entry.tokens <= 508);
        const excluded = tokenized.filter((entry) => entry.tokens > 508);
        const percentile = (values, p) =>
          [...values].sort((a, b) => a - b)[
            Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
          ] ?? 0;
        globalThis.__nerBatchReal.substage = "internalSplit";
        const densestExcluded = excluded.reduce(
          (best, entry) => (best === undefined || entry.tokens > best.tokens ? entry : best),
          undefined,
        );
        const internalSplitProbe =
          densestExcluded === undefined
            ? null
            : {
                pageChars: densestExcluded.item.text.length,
                pageWords: densestExcluded.item.text.trim().split(/\s+/u).filter(Boolean).length,
                pageTokens: densestExcluded.tokens,
                measurement: await NerBatchProbe.runAdversarial(
                  densestExcluded.item.text,
                  modelId,
                  wasmPaths,
                  null,
                ),
              };
        if (eligible.length < 4) {
          const error = new Error("");
          error.name = "SelectionInsufficient";
          throw error;
        }
        globalThis.__nerBatchReal.substage = "select";
        const byChars = [...eligible].sort((a, b) => a.item.text.length - b.item.text.length);
        const similarEntries = byChars.slice(
          Math.floor((byChars.length - 4) / 2),
          Math.floor((byChars.length - 4) / 2) + 4,
        );
        const similar = similarEntries.map((entry) => entry.item);
        const disparate = [
          byChars[0],
          byChars[Math.floor(byChars.length / 3)],
          byChars[Math.floor((2 * byChars.length) / 3)],
          byChars.at(-1),
        ].map((entry) => entry.item);
        globalThis.__nerBatchReal.substage = "similar4";
        const similar4 = await NerBatchProbe.runBatchProbe(
          similar.map((item) => item.text),
          modelId,
          wasmPaths,
          3,
        );
        globalThis.__nerBatchReal.substage = "disparate4";
        const disparate4 = await NerBatchProbe.runBatchProbe(
          disparate.map((item) => item.text),
          modelId,
          wasmPaths,
          3,
        );
        globalThis.__nerBatchReal.substage = "similar2";
        const similar2 = await NerBatchProbe.runBatchProbe(
          similar.slice(0, 2).map((item) => item.text),
          modelId,
          wasmPaths,
          3,
        );
        globalThis.__nerBatchReal.substage = "disparate2";
        const disparate2 = await NerBatchProbe.runBatchProbe(
          [disparate[0].text, disparate[3].text],
          modelId,
          wasmPaths,
          3,
        );
        const result = {
          pageJobs: ordered.length,
          eligiblePageJobs: eligible.length,
          excludedOverBudgetPageJobs: excluded.length,
          excludedOverBudgetPageJobFraction: excluded.length / tokenized.length,
          excludedOverBudgetChars: excluded.reduce((sum, entry) => sum + entry.item.text.length, 0),
          excludedOverBudgetCharFraction:
            excluded.reduce((sum, entry) => sum + entry.item.text.length, 0) /
            charsByPage.reduce((sum, value) => sum + value, 0),
          totalTokenizerTokens: tokenized.reduce((sum, entry) => sum + entry.tokens, 0),
          chars: {
            total: charsByPage.reduce((a, b) => a + b, 0),
            median: percentile(charsByPage, 0.5),
            p90: percentile(charsByPage, 0.9),
            p95: percentile(charsByPage, 0.95),
            max: Math.max(...charsByPage),
          },
          words: {
            total: wordsByPage.reduce((a, b) => a + b, 0),
            median: percentile(wordsByPage, 0.5),
            p90: percentile(wordsByPage, 0.9),
            p95: percentile(wordsByPage, 0.95),
            max: Math.max(...wordsByPage),
          },
          tokenizerTokensByPage: {
            median: percentile(
              tokenized.map((entry) => entry.tokens),
              0.5,
            ),
            p90: percentile(
              tokenized.map((entry) => entry.tokens),
              0.9,
            ),
            p95: percentile(
              tokenized.map((entry) => entry.tokens),
              0.95,
            ),
            max: Math.max(...tokenized.map((entry) => entry.tokens)),
          },
          selectedTokenCounts: {
            similar: similarEntries.map((entry) => entry.tokens),
            disparate: [
              byChars[0],
              byChars[Math.floor(byChars.length / 3)],
              byChars[Math.floor((2 * byChars.length) / 3)],
              byChars.at(-1),
            ].map((entry) => entry.tokens),
          },
          internalSplitProbe,
          similar4,
          disparate4,
          similar2,
          disparate2,
        };
        globalThis.__nerBatchReal.substage = "dispose";
        await NerBatchProbe.kernelDispose();
        globalThis.__nerBatchReal.captured.length = 0;
        return result;
      },
      {
        modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
        wasmPaths: { wasm: `/assets/${wasm}`, mjs: `/assets/${mjs}` },
      },
    );
    results.push({ profile, ...report, idleDisposedWorkers: disposed.terminated });
  } catch (error) {
    const errorName =
      error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? error.name : "Unknown";
    let substage = "none";
    try {
      substage =
        (await page?.evaluate(() => globalThis.__nerBatchReal?.substage ?? "none")) ?? "none";
    } catch {
      /* renderer already gone */
    }
    process.stderr.write(`${JSON.stringify({ profile, stage, substage, errorName })}\n`);
    failed = true;
  } finally {
    try {
      await page?.evaluate(() => {
        const probe = globalThis.__nerBatchReal;
        if (probe) probe.captured.length = 0;
      });
    } catch {
      /* renderer already closed */
    }
    await app.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
  if (failed) break;
}
if (failed) process.exitCode = 1;
else process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
