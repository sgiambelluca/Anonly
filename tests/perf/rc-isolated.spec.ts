/** ADR-218 opt-in builds A/RC, identical natural observation and full M2 allowlist. */
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { _electron as electron } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { openApp, test as base } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";
import { generateText50p } from "../fixtures/generate.js";

import { installTransportObserver } from "./support/adr190Browser.js";
import { generateCampaignFixtures } from "./support/adr190Fixtures.js";
import { measureProfile, type RunReport } from "./support/memoryProfile.js";
import { corpusEntries } from "./support/osdVerdictCorpus.js";
import { generateSparseFixtures } from "./support/osdVerdictFixtures.js";
import { readRealDocument } from "./support/osdVerdictFixturesM2.js";
import {
  captureM3Run,
  installM3Collector,
  type RunSnapshot,
} from "./support/osdVerdictM3Collector.js";
import { buildP2WithNoise, loadNoiseSheets } from "./support/osdVerdictM3Fixtures.js";
import {
  projectRcRun,
  projectRcSnapshot,
  rcKey,
  rcPlan,
  rcReuseRecord,
  RcProductStop,
  type RcConflicts,
  type RcRun,
  type RcSide,
} from "./support/rcIsolatedCampaign.js";
import {
  activateRcBuild,
  RC_REPO_ROOT,
  rcHash,
  rcTreeHash,
  verifyRcBuildIdentity,
} from "./support/rcIsolatedFiles.js";
import { parseRcSourceMode, type RcArm, type RcSourceMode } from "./support/rcIsolatedTransform.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";
import { safeV1ErrorName, sanitizeV1Report } from "./support/validateSamplePrivacy.js";

const ENABLED = process.env.ANONLY_RC_ISOLATED === "1";
const SMOKE = process.env.ANONLY_RC_MODE === "smoke";
const DIR = process.env.ANONLY_RC_OUTPUT_DIR ?? "";
const BUILDS = process.env.ANONLY_RC_BUILD_DIR ?? "";
const BATCH = process.env.ANONLY_RC_BATCH_ID ?? "";
const SOURCE_MODE = parseRcSourceMode(process.env.ANONLY_RC_SOURCE_MODE);
const TIMEOUT = 1_200_000;
const payloads = new Map<string, E2eFilePayload>();
/** Decide before fixtures: never launch Electron merely to skip an existing row. */
const pending = (() => {
  if (!ENABLED || SMOKE) return [];
  const plan = rcPlan();
  const expected = new Set(plan.map((id) => rcKey(id) + ".json"));
  const auxiliary = new Set([
    "manifest.json",
    "build-identity.json",
    "transform-A.json",
    "transform-RC.json",
    "cleanup.json",
    "summary.json",
    "validity.json",
    "caveats.json",
    "sleep-detection.json",
    "host.json",
    "identity-integrity.json",
    "source-mode.txt",
    "normal-renderer.sha256",
  ]);
  for (const name of readdirSync(DIR))
    if (
      name.endsWith(".json") &&
      !expected.has(name) &&
      !auxiliary.has(name) &&
      !/^batch-tanda-\d{8}T\d{6}Z-\d+\.json$/.test(name) &&
      !/^history-(R1|P2N)-(A|RC)-r[123]-tanda-\d{8}T\d{6}Z-\d+\.json$/.test(name)
    )
      throw new Error("RC unexpected run file");
  const build = JSON.parse(readFileSync(join(BUILDS, "build-identity.json"), "utf8")) as {
    arms: Record<RcArm, string>;
    sourceMode: RcSourceMode;
  };
  if (build.sourceMode !== SOURCE_MODE) throw new Error("RC source mode identity mismatch");
  const manifest = existsSync(join(DIR, "manifest.json"))
    ? (JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
        fixtureHashes: Record<string, string>;
        sourceMode: RcSourceMode;
      })
    : null;
  return plan.filter((id) => {
    const path = join(DIR, rcKey(id) + ".json");
    if (!existsSync(path)) return true;
    const run = projectRcRun(JSON.parse(readFileSync(path, "utf8")) as RcRun);
    if (
      rcKey(run) !== rcKey(id) ||
      run.sourceMode !== SOURCE_MODE ||
      run.buildSha256 !== build.arms[id.arm] ||
      manifest?.fixtureHashes[id.doc] !== run.fixtureSha256
    )
      throw new Error("RC existing record identity mismatch");
    const sealPath = join(DIR, `batch-${run.batchId}.json`);
    const seal = existsSync(sealPath)
      ? (JSON.parse(readFileSync(sealPath, "utf8")) as unknown)
      : null;
    if (
      rcReuseRecord(run, id, build.arms[id.arm], manifest?.fixtureHashes[id.doc], seal, SOURCE_MODE)
    )
      return false;
    const archive = join(DIR, `history-${rcKey(id)}-${run.batchId}.json`);
    if (existsSync(archive)) throw new Error("RC repeated historical identity");
    renameSync(path, archive);
    return true;
  });
})();
const smokePlan = [
  ...corpusEntries()
    .filter(
      (e) =>
        e.label === "N1" &&
        [90, 270].includes(e.physicalRotation) &&
        [150, 300].includes(e.sourceDpi),
    )
    .map((e) => ({ key: e.key, arm: "RC" as const })),
  ...(["blank", "noise"] as const).flatMap((key) =>
    (["A", "RC"] as const).map((arm) => ({ key: `${key}-150-0`, arm })),
  ),
];
const test = base.extend<{ activeRcBuild: void }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature, no fixture dependencies.
  activeRcBuild: async ({}, use, info) => {
    const arm = /-(A|RC)-/.exec(info.title)?.[1] as RcArm | undefined;
    if (arm === undefined) throw new Error("RC test build unidentified");
    await activateRcBuild(BUILDS, arm);
    await use();
  },
  electronApp: async ({ electronUserDataDir, activeRcBuild: _activeRcBuild }, use) => {
    const app = await electron.launch({
      executablePath: resolve(RC_REPO_ROOT, "apps/desktop-shell/node_modules/.bin/electron"),
      args: [
        resolve(RC_REPO_ROOT, "apps/desktop-shell"),
        `--user-data-dir=${electronUserDataDir}`,
        "--remote-debugging-port=0",
      ],
    });
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});
async function conflicts(page: Parameters<typeof captureM3Run>[0]): Promise<RcConflicts> {
  return page.evaluate(() => {
    const core = globalThis.__anonlyCore as typeof globalThis.__anonlyCore & {
      orchestrator: {
        documents: ReadonlyMap<
          string,
          { pages: ReadonlyArray<{ words: ReadonlyArray<{ text: string }> }> }
        >;
      };
    };
    const id = globalThis.__anonlyMemoryRun?.documentId;
    const view = core as typeof core & {
      engines?: {
        grouping?: {
          getSnapshot(documentId: string): {
            conflicts: ReadonlyArray<{ reason: string; resolved: boolean; heldManual?: boolean }>;
          };
        };
      };
    };
    if (id === undefined || view?.engines?.grouping === undefined)
      return { available: false, counts: {} };
    const counts: Record<string, { total: number; resolved: number; heldManual: number }> = {};
    for (const c of view.engines.grouping.getSnapshot(id).conflicts) {
      const reason = ["overlap", "disagree", "low_confidence", "ambiguous_canonical"].includes(
        c.reason,
      )
        ? c.reason
        : "unknown";
      const row = (counts[reason] ??= { total: 0, resolved: 0, heldManual: 0 });
      row.total++;
      if (c.resolved) row.resolved++;
      if (c.heldManual === true) row.heldManual++;
    }
    return { available: true, counts };
  });
}
async function writeNeutral(file: string, value: unknown): Promise<void> {
  await writeFile(join(DIR, file + ".tmp"), JSON.stringify(value, null, 2));
  const { rename } = await import("node:fs/promises");
  await rename(join(DIR, file + ".tmp"), join(DIR, file));
}
test.describe("RC isolated cost", () => {
  test.skip(!ENABLED, "RC experiment opt-in");
  test.beforeAll(async () => {
    if (!DIR || !BUILDS || !BATCH) throw new Error("RC incomplete configuration");
    await verifyRcBuildIdentity(BUILDS);
    await mkdir(DIR, { recursive: true });
    if (SMOKE) {
      const sparse = await generateSparseFixtures(
        corpusEntries().filter(
          (e) => smokePlan.some((s) => s.key === e.key) && e.geometry !== null,
        ),
        join(DIR, "fixtures"),
      );
      const controls = await generateCampaignFixtures(
        ["blank", "noise"].map((density) => ({
          density: density as "blank" | "noise",
          sourceDpi: 150,
          angle: 0,
          arm: "native",
          repetition: 1,
        })),
        join(DIR, "fixtures"),
      );
      for (const [key, f] of [...sparse, ...controls])
        payloads.set(key, {
          name: key + ".pdf",
          mimeType: "application/pdf",
          buffer: await readFile(f.path),
        });
    } else {
      payloads.set("R1", {
        name: "R1.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await readRealDocument(process.env.ANONLY_REAL_DOC_R1 ?? "")),
      });
      const p2 = await getOrGenerateScannedFixture(
        "p2-scanned-50p",
        new Uint8Array(await generateText50p()),
      );
      payloads.set("P2N", {
        name: "P2N.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(
          await buildP2WithNoise(p2.buffer, await loadNoiseSheets(join(DIR, "fixtures"))),
        ),
      });
      for (const [key, file] of payloads)
        if (
          (await PDFDocument.load(file.buffer, { updateMetadata: false })).getPageCount() !==
          (key === "R1" ? 20 : 60)
        )
          throw new Error("RC source page mismatch");
    }
    const buildIdentity = JSON.parse(
      await readFile(join(BUILDS, "build-identity.json"), "utf8"),
    ) as {
      arms: Record<RcArm, string>;
      shellSha256: string;
      sourceMode: RcSourceMode;
    };
    if (buildIdentity.sourceMode !== SOURCE_MODE) throw new Error("RC source mode mismatch");
    if (
      (await rcTreeHash(resolve(RC_REPO_ROOT, "apps/desktop-shell/dist"))) !==
      buildIdentity.shellSha256
    )
      throw new Error("RC shell build mismatch");
    const fixtureHashes = Object.fromEntries(
      [...payloads].map(([key, file]) => [key, rcHash(file.buffer)]),
    );
    if (!SMOKE) {
      const reference = process.env.ANONLY_RC_M3_REFERENCE_DIR;
      if (!reference) throw new Error("RC M-O3 reference missing");
      const prior = JSON.parse(await readFile(join(reference, "manifest.json"), "utf8")) as {
        fixtureHashes: Record<string, string>;
      };
      if (["R1", "P2N"].some((doc) => fixtureHashes[doc] !== prior.fixtureHashes[doc]))
        throw new Error("RC M-O3 fixture hash mismatch");
    }
    const previous = existsSync(join(DIR, "manifest.json"))
      ? (JSON.parse(await readFile(join(DIR, "manifest.json"), "utf8")) as {
          fixtureHashes: typeof fixtureHashes;
          buildIdentity: typeof buildIdentity;
          sourceMode: RcSourceMode;
        })
      : null;
    if (
      previous !== null &&
      (JSON.stringify(previous.fixtureHashes) !== JSON.stringify(fixtureHashes) ||
        JSON.stringify(previous.buildIdentity) !== JSON.stringify(buildIdentity) ||
        previous.sourceMode !== SOURCE_MODE)
    )
      throw new Error("RC campaign identity mismatch");
    await writeNeutral("manifest.json", {
      schema: 1,
      phase: "RC-isolated",
      mode: SMOKE ? "smoke" : "cost",
      sourceMode: SOURCE_MODE,
      fixtureHashes,
      buildIdentity,
    });
  });
  const plan = SMOKE
    ? smokePlan.map((s) => ({ title: `smoke-${s.arm}-${s.key}`, key: s.key, arm: s.arm, id: null }))
    : pending.map((id) => ({ title: rcKey(id), key: id.doc, arm: id.arm, id }));
  for (const entry of plan)
    test(entry.title, async ({ page, electronApp, electronUserDataDir }) => {
      test.setTimeout(TIMEOUT * 3);
      const file = payloads.get(entry.key);
      if (file === undefined) throw new Error("RC payload unavailable");
      const snapshots: Record<"cold" | "hot", RunSnapshot> = {
        cold: { observer: true, pages: [], ocrPageJobs: 0 },
        hot: { observer: true, pages: [], ocrPageJobs: 0 },
      };
      const conflictCounts: Record<"cold" | "hot", RcConflicts> = {
        cold: { available: false, counts: {} },
        hot: { available: false, counts: {} },
      };
      const recovered: Record<"cold" | "hot", boolean> = { cold: false, hot: false };
      const productFailureObserved: Array<"cold" | "hot"> = [];
      let cold: RcSide | null = null;
      let hot: RcSide | null = null;
      try {
        await installTransportObserver(page, { lightweightResults: true });
        await installSettingsOverride(page, { performancePreset: "medium", nerEnabled: true });
        await openApp(page, "networkidle");
        const report = await measureProfile(
          page,
          electronApp,
          electronUserDataDir,
          "rc-isolated",
          file,
          TIMEOUT,
          [installM3Collector],
          async (inPage, temp) => {
            snapshots[temp] = projectRcSnapshot(await captureM3Run(inPage));
            conflictCounts[temp] = await conflicts(inPage);
            const failed = await inPage.evaluate(
              () => globalThis.__anonlyMemoryRun?.failedAt !== undefined,
            );
            if (failed) productFailureObserved.push(temp);
            if (SMOKE && entry.key.startsWith("N1-"))
              recovered[temp] = await inPage.evaluate(() => {
                const core = globalThis.__anonlyCore as typeof globalThis.__anonlyCore & {
                  orchestrator: {
                    documents: ReadonlyMap<
                      string,
                      { pages: ReadonlyArray<{ words: ReadonlyArray<{ text: string }> }> }
                    >;
                  };
                };
                const id = globalThis.__anonlyMemoryRun?.documentId;
                const text =
                  id === undefined
                    ? ""
                    : (core?.orchestrator.documents
                        .get(id)
                        ?.pages.flatMap((p) => p.words.map((w) => w.text))
                        .join(" ") ?? "");
                return text
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "")
                  .includes("juanperezdni34567891");
              });
          },
          undefined,
          { captureOcrWords: false, allowFailedRunReport: true },
          undefined,
          0,
          (completed) => {
            const side = {
              report: sanitizeV1Report(completed),
              snapshot: snapshots[completed.temperature],
              conflicts: conflictCounts[completed.temperature],
            };
            if (completed.temperature === "cold") cold = side;
            else hot = side;
            if (!completed.ok) throw new RcProductStop(completed.temperature);
          },
        );
        const side = (r: RunReport, temp: "cold" | "hot"): RcSide => ({
          report: sanitizeV1Report(r),
          snapshot: snapshots[temp],
          conflicts: conflictCounts[temp],
        });
        cold = side(report.cold, "cold");
        hot = side(report.hot, "hot");
        if (SMOKE) {
          const issue =
            entry.key.startsWith("N1-") && (!recovered.cold || !recovered.hot)
              ? "N1-not-recovered"
              : !cold.report.ok || !hot.report.ok
                ? "pipeline-failed"
                : null;
          await writeNeutral(entry.title + ".json", {
            schema: 1,
            sourceMode: SOURCE_MODE,
            batchId: BATCH,
            arm: entry.arm,
            key: entry.key,
            fixtureSha256: rcHash(file.buffer),
            cold,
            hot,
            recovered,
            issue,
          });
          if (issue !== null) throw new Error("RC smoke invariant failed");
        } else if (entry.id !== null) {
          const build = JSON.parse(await readFile(join(BUILDS, "build-identity.json"), "utf8")) as {
            arms: Record<RcArm, string>;
            sourceMode: RcSourceMode;
          };
          const run: RcRun = {
            schema: 1,
            sourceMode: build.sourceMode,
            ...entry.id,
            batchId: BATCH,
            fixtureSha256: rcHash(file.buffer),
            buildSha256: build.arms[entry.arm],
            capturedAtUtc: new Date().toISOString(),
            cold,
            hot,
            failure: !cold.report.ok || !hot.report.ok ? "product" : null,
            errorName: null,
            productFailureObserved,
          };
          await writeNeutral(entry.title + ".json", projectRcRun(run));
        }
        console.log(
          `RC ${entry.title}: observación conservada; producto listo=${cold.report.ok && hot.report.ok}`,
        );
      } catch (error: unknown) {
        const productStop = error instanceof RcProductStop;
        if (!existsSync(join(DIR, entry.title + ".json"))) {
          if (entry.id !== null) {
            const build = JSON.parse(
              await readFile(join(BUILDS, "build-identity.json"), "utf8"),
            ) as { arms: Record<RcArm, string>; sourceMode: RcSourceMode };
            await writeNeutral(
              entry.title + ".json",
              projectRcRun({
                schema: 1,
                sourceMode: build.sourceMode,
                ...entry.id,
                batchId: BATCH,
                fixtureSha256: rcHash(file.buffer),
                buildSha256: build.arms[entry.arm],
                capturedAtUtc: new Date().toISOString(),
                cold,
                hot,
                failure: productStop ? "product" : "instrument",
                errorName: productStop ? null : safeV1ErrorName(error),
                productFailureObserved,
              }),
            );
          } else
            await writeNeutral(entry.title + ".json", {
              schema: 1,
              sourceMode: SOURCE_MODE,
              batchId: BATCH,
              arm: entry.arm,
              key: entry.key,
              failure: productStop ? "product" : "instrument",
              errorName: productStop ? null : safeV1ErrorName(error),
              cold,
              hot,
              productFailureObserved,
            });
        }
        if (productStop && !SMOKE) {
          console.log(
            `RC ${entry.title}: falla de producto observada; temperatura pendiente conservada.`,
          );
          return;
        }
        throw new Error(
          `RC neutral failure ${entry.title}: ${productStop ? "pipeline-failed" : safeV1ErrorName(error)}`,
        );
      }
    });
});
