// Sonda de reproducibilidad del OCR entre plataformas. Separa dos etapas:
// (1) los píxeles que llegan a Tesseract (PNG que arma Render y RGBA decodificado)
// y (2) las palabras que Tesseract devuelve. En un documento real solo salen
// hashes y conteos; los PNG y el texto solo se guardan o se fijan si el
// documento se declara sintético (ANONLY_OCR_PROBE_SYNTHETIC=1).
/* global atob, btoa, crypto, createImageBitmap -- corren dentro del renderer vía page.evaluate */
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const env = process.env;
const docPath = env.ANONLY_OCR_PROBE_DOC;
const docId = env.ANONLY_OCR_PROBE_ID;
const outPath = env.ANONLY_OCR_PROBE_OUT;
const synthetic = env.ANONLY_OCR_PROBE_SYNTHETIC === "1";
const saveDir = env.ANONLY_OCR_PROBE_SAVE_DIR;
const pinDir = env.ANONLY_OCR_PROBE_PIN_DIR;
const extraArgs = (env.ANONLY_OCR_PROBE_ELECTRON_ARGS ?? "").split(/\s+/).filter(Boolean);
if (!docPath || !outPath)
  throw new Error("ANONLY_OCR_PROBE_DOC y ANONLY_OCR_PROBE_OUT son obligatorias");
if (!docId || !/^[A-Z0-9]{1,4}$/.test(docId))
  throw new Error("ANONLY_OCR_PROBE_ID debe ser un id neutro (p. ej. R2, P2)");
if ((saveDir || pinDir) && !synthetic)
  throw new Error("Guardar o fijar PNG solo se permite con un documento sintético");

const root = process.cwd();
const appRequire = createRequire(resolve(root, "apps/desktop-shell/package.json"));
const { _electron: electron } = appRequire("@playwright/test");

const pin = {};
if (pinDir) {
  for (const name of readdirSync(pinDir)) {
    const match = /^(ocr-page|ocr-orient)-(\d+)\.png$/.exec(name);
    if (match) pin[`${match[1]}:${match[2]}`] = readFileSync(join(pinDir, name)).toString("base64");
  }
  if (Object.keys(pin).length === 0)
    throw new Error("ANONLY_OCR_PROBE_PIN_DIR no tiene PNG de referencia");
}

const pdf = readFileSync(docPath);
const appDir = resolve(root, "apps/desktop-shell");
const userDataDir = join(tmpdir(), `anonly-ocr-probe-${process.pid}`);
const app = await electron.launch({
  args: [appDir, `--user-data-dir=${userDataDir}`, ...extraArgs],
  executablePath: resolve(appDir, "node_modules/.bin/electron"),
});
let result;
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("load");
  await page.addInitScript((pinMap) => {
    const state = {
      jobs: [],
      pin: pinMap,
      pinnedJobs: 0,
      words: {},
      documentId: undefined,
      done: false,
      failed: false,
    };
    Object.defineProperty(globalThis, "__ocrProbe", { value: state, configurable: true });
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (
        message !== null &&
        typeof message === "object" &&
        message.type === "RUN" &&
        (message.jobType === "ocr-page" || message.jobType === "ocr-orient") &&
        message.payload?.image?.bytes instanceof ArrayBuffer
      ) {
        const key = `${message.jobType}:${message.payload.pageIndex}`;
        const pinned = state.pin?.[key];
        if (pinned !== undefined) {
          const binary = atob(pinned);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          message = {
            ...message,
            payload: {
              ...message.payload,
              image: { ...message.payload.image, bytes: bytes.buffer },
            },
          };
          state.pinnedJobs++;
        }
        const payload = message.payload;
        state.jobs.push({
          jobType: message.jobType,
          pageIndex: payload.pageIndex,
          dpi: payload.dpi ?? null,
          orientation: payload.orientation ?? null,
          widthPx: payload.image.widthPx,
          heightPx: payload.image.heightPx,
          format: payload.image.format,
          bytes: new Uint8Array(payload.image.bytes.slice(0)),
        });
      }
      return Reflect.apply(post, this, [message, ...rest]);
    };
  }, pin);
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => {
    const core = globalThis.__anonlyCore;
    const state = globalThis.__ocrProbe;
    if (!core || !state) throw new Error("Core o sonda ausentes (build sin VITE_E2E=1)");
    core.bus.on("pipeline", "DOCUMENT_IMPORTED", (payload) => {
      if (typeof payload?.documentId === "string") state.documentId = payload.documentId;
    });
    core.bus.on("ocr", "OCR_PAGE_FINISHED", (payload) => {
      if (typeof payload?.pageIndex !== "number" || state.documentId === undefined) return;
      const words = core.engines?.ocr?.ctx?.cache?.get(
        `ocr-words:${state.documentId}:${payload.pageIndex}`,
      );
      state.words[payload.pageIndex] = {
        eventWordCount: payload.wordCount,
        words: Array.isArray(words)
          ? words.map((w) => ({ text: w.text, bbox: w.bbox, confidence: w.confidence }))
          : null,
      };
    });
    core.bus.on("pipeline", "PIPELINE_READY", () => (state.done = true));
    core.bus.on("pipeline", "PIPELINE_FAILED", () => {
      state.failed = true;
      state.done = true;
    });
  });
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "document.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.waitForFunction(() => globalThis.__ocrProbe?.done === true, undefined, {
    timeout: 900_000,
  });

  result = await page.evaluate(
    async ({ keepContent }) => {
      const state = globalThis.__ocrProbe;
      const hex = (buffer) =>
        [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const sha = async (data) => hex(await crypto.subtle.digest("SHA-256", data));
      const shaText = (text) => sha(new TextEncoder().encode(text));
      const b64 = (u8) => {
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000)
          s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const jobs = [];
      for (const job of state.jobs) {
        const bitmap = await createImageBitmap(
          new Blob([job.bytes], { type: `image/${job.format}` }),
        );
        const canvas = new OffscreenCanvas(job.widthPx, job.heightPx);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const rgba = ctx.getImageData(0, 0, job.widthPx, job.heightPx).data;
        let dark = 0;
        for (let i = 0; i < rgba.length; i += 4)
          if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 384) dark++;
        jobs.push({
          jobType: job.jobType,
          pageIndex: job.pageIndex,
          dpi: job.dpi,
          orientation: job.orientation,
          widthPx: job.widthPx,
          heightPx: job.heightPx,
          format: job.format,
          pngBytes: job.bytes.length,
          pngSha256: await sha(job.bytes),
          rgbaSha256: await sha(rgba),
          darkPixels: dark,
          pngBase64: keepContent ? b64(job.bytes) : undefined,
        });
      }
      const pages = [];
      for (const [pageIndex, entry] of Object.entries(state.words)) {
        const words = entry.words ?? [];
        pages.push({
          pageIndex: Number(pageIndex),
          eventWordCount: entry.eventWordCount,
          wordCount: entry.words === null ? null : words.length,
          characterCount: words.reduce((sum, w) => sum + w.text.length, 0),
          textSha256: await shaText(words.map((w) => w.text).join("\n")),
          bboxSha256: await shaText(JSON.stringify(words.map((w) => w.bbox))),
          confidenceSha256: await shaText(JSON.stringify(words.map((w) => w.confidence))),
          words: keepContent ? words : undefined,
        });
      }
      pages.sort((a, b) => a.pageIndex - b.pageIndex);
      jobs.sort((a, b) => a.pageIndex - b.pageIndex || a.jobType.localeCompare(b.jobType));
      state.jobs.length = 0;
      return { failed: state.failed, pinnedJobs: state.pinnedJobs, jobs, pages };
    },
    { keepContent: synthetic },
  );
  result.versions = await app.evaluate(() => process.versions);
  result.gpu = await app.evaluate(({ app: electronApp }) => electronApp.getGPUFeatureStatus());
} finally {
  await app.close();
  await rm(userDataDir, { recursive: true, force: true });
}

if (saveDir) {
  mkdirSync(saveDir, { recursive: true });
  for (const job of result.jobs)
    writeFileSync(
      join(saveDir, `${job.jobType}-${job.pageIndex}.png`),
      Buffer.from(job.pngBase64, "base64"),
    );
}
for (const job of result.jobs) delete job.pngBase64;

let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* sin git */
}
const report = {
  docId,
  synthetic,
  mode: pinDir ? "pinned" : "capture",
  commit,
  platform: process.platform,
  arch: process.arch,
  electron: result.versions.electron,
  chrome: result.versions.chrome,
  v8: result.versions.v8,
  electronArgs: extraArgs,
  gpu2dCanvas: result.gpu?.["2d_canvas"] ?? null,
  gpuCompositing: result.gpu?.gpu_compositing ?? null,
  failed: result.failed,
  pinnedJobs: result.pinnedJobs,
  jobs: result.jobs,
  pages: result.pages,
};
mkdirSync(resolve(outPath, ".."), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `OCR probe ${docId} (${report.mode}) en ${process.platform}: ${result.jobs.length} jobs, ${result.pages.length} páginas -> ${outPath}\n`,
);
