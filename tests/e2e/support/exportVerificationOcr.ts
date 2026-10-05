import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";

import type { Page } from "@playwright/test";
import type * as PdfjsModule from "pdfjs-dist";
import { createWorker, OEM, PSM } from "tesseract.js";

import type { OcrDocument } from "./exportVerificationOracle.js";

const PDFJS_PATH = resolve("node_modules/pdfjs-dist/build/pdf.min.mjs");
const PDFJS_WORKER_PATH = resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const TESSERACT_REQUIRE = createRequire(resolve("node_modules/tesseract.js/src/index.js"));
const TESSERACT_PATH = resolve("apps/react-client/public/wasm/tesseract");
const LANGUAGE_PATH = resolve("apps/react-client/public/models/tesseract");
const ASSET_PATHS = new Map<string, string>([
  ["tesseract-worker", resolve(TESSERACT_PATH, "worker.min.js")],
  ["tesseract-core-lstm", resolve(TESSERACT_PATH, "tesseract-core-lstm.wasm.js")],
  ["tesseract-core-simd-lstm", resolve(TESSERACT_PATH, "tesseract-core-simd-lstm.wasm.js")],
  ["tesseract-lang-spa", resolve(LANGUAGE_PATH, "spa.traineddata.gz")],
]);

export type RasterizedPage = {
  readonly png: Buffer;
  readonly widthPt: number;
  readonly heightPt: number;
};

export type OcrAudit = {
  readonly document: OcrDocument;
  readonly textByPage: ReadonlyArray<string>;
  readonly rasters: ReadonlyArray<RasterizedPage>;
  readonly versions: {
    readonly pdfjs: string;
    readonly tesseract: string;
    readonly tesseractCore: string;
  };
  readonly assetHashes: OcrRuntimeAssetHashes;
};

type ManifestHash = {
  readonly path: string;
  readonly actual: string;
  readonly expected: string;
  readonly matches: boolean;
};

type InstalledFileHash = { readonly path: string; readonly sha256: string };

type LockedPackageAudit = {
  readonly version: string;
  readonly lockfileSha256: string;
};

type OcrRuntimeAssetHashes = {
  readonly verifier: {
    readonly nodeWorker: LockedPackageAudit & {
      readonly entry: InstalledFileHash;
      readonly commonScript: InstalledFileHash;
      readonly coreLoader: InstalledFileHash;
    };
    readonly nodeCore: LockedPackageAudit & {
      readonly simd: boolean;
      readonly entry: InstalledFileHash;
      readonly wasm: InstalledFileHash;
    };
    readonly language: ManifestHash;
  };
  readonly productBrowser: Readonly<Record<string, ManifestHash>>;
};

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function packageVersionFromManifest(path: string): Promise<string> {
  const packageJson: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error(`No se pudo leer la versión de ${path}.`);
  }
  return packageJson.version;
}

function isSimdDetector(value: unknown): value is { readonly simd: () => Promise<boolean> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "simd" in value &&
    typeof value.simd === "function"
  );
}

function relativePath(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

async function installedFileHash(path: string): Promise<InstalledFileHash> {
  return { path: relativePath(path), sha256: await sha256(path) };
}

async function lockPackageAudit(
  packageName: string,
  version: string,
  lockText: string,
  lockfileSha256: string,
): Promise<LockedPackageAudit> {
  const expectedEntry = `${packageName}@${version}:`;
  if (!lockText.split(/\r?\n/u).some((line) => line.trim() === expectedEntry)) {
    throw new Error(`${packageName}@${version} no está fijado como paquete en pnpm-lock.yaml.`);
  }
  return { version, lockfileSha256 };
}

export async function verifyLocalOcrAssets(): Promise<OcrRuntimeAssetHashes> {
  const lockJson: unknown = JSON.parse(await readFile(resolve("assets.lock.json"), "utf8"));
  if (
    typeof lockJson !== "object" ||
    lockJson === null ||
    !("assets" in lockJson) ||
    !Array.isArray(lockJson.assets)
  ) {
    throw new Error("assets.lock.json no contiene el manifiesto esperado.");
  }
  const expectedById = new Map<string, string>();
  const lockedAssets: ReadonlyArray<unknown> = lockJson.assets;
  for (const entry of lockedAssets) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !("sha256" in entry) ||
      typeof entry.sha256 !== "string"
    ) {
      throw new Error("assets.lock.json contiene una entrada OCR inválida.");
    }
    expectedById.set(entry.id, entry.sha256);
  }
  const productBrowser: Record<string, ManifestHash> = {};
  for (const [id, path] of ASSET_PATHS) {
    const expected = expectedById.get(id);
    if (expected === undefined) throw new Error(`Falta el hash ${id} en assets.lock.json.`);
    const actual = await sha256(path);
    productBrowser[id] = {
      path: relativePath(path),
      actual,
      expected,
      matches: actual === expected,
    };
  }
  const languagePath = ASSET_PATHS.get("tesseract-lang-spa");
  const expectedLanguageHash = expectedById.get("tesseract-lang-spa");
  if (languagePath === undefined || expectedLanguageHash === undefined)
    throw new Error("Falta el modelo spa ejecutado en assets.lock.json.");
  const languageActual = await sha256(languagePath);

  const workerEntryPath = TESSERACT_REQUIRE.resolve("./worker-script/node/index.js");
  const workerCommonScriptPath = TESSERACT_REQUIRE.resolve("./worker-script/index.js");
  const coreLoaderPath = TESSERACT_REQUIRE.resolve("./worker-script/node/getCore.js");
  const detectorValue: unknown = TESSERACT_REQUIRE("wasm-feature-detect");
  if (!isSimdDetector(detectorValue)) throw new Error("Falta el detector SIMD de wasm instalado.");
  const simd = await detectorValue.simd();
  const coreBaseName = simd ? "tesseract-core-simd-lstm" : "tesseract-core-lstm";
  const coreEntryPath = TESSERACT_REQUIRE.resolve(`tesseract.js-core/${coreBaseName}`);
  const coreWasmPath = resolve(dirname(coreEntryPath), `${coreBaseName}.wasm`);
  const workerVersion = await packageVersionFromManifest(
    resolve("node_modules", "tesseract.js", "package.json"),
  );
  const coreVersion = await packageVersionFromManifest(
    resolve(dirname(coreEntryPath), "package.json"),
  );
  const lockText = await readFile(resolve("pnpm-lock.yaml"), "utf8");
  const lockfileSha256 = createHash("sha256").update(lockText).digest("hex");

  return {
    verifier: {
      nodeWorker: {
        ...(await lockPackageAudit("tesseract.js", workerVersion, lockText, lockfileSha256)),
        entry: await installedFileHash(workerEntryPath),
        commonScript: await installedFileHash(workerCommonScriptPath),
        coreLoader: await installedFileHash(coreLoaderPath),
      },
      nodeCore: {
        ...(await lockPackageAudit("tesseract.js-core", coreVersion, lockText, lockfileSha256)),
        simd,
        entry: await installedFileHash(coreEntryPath),
        wasm: await installedFileHash(coreWasmPath),
      },
      language: {
        path: relativePath(languagePath),
        actual: languageActual,
        expected: expectedLanguageHash,
        matches: languageActual === expectedLanguageHash,
      },
    },
    productBrowser,
  };
}

export async function rasterizePdfAt288Dpi(
  page: Page,
  pdfBytes: Uint8Array,
  rotations: ReadonlyArray<0 | 90 | 180 | 270>,
): Promise<ReadonlyArray<RasterizedPage>> {
  const [pdfjsSource, workerSource] = await Promise.all([
    readFile(PDFJS_PATH, "utf8"),
    readFile(PDFJS_WORKER_PATH, "utf8"),
  ]);
  const pngPages = await page.evaluate(
    async ({ pdfjsSource, workerSource, bytesBase64, rotations }) => {
      const pdfjsUrl = URL.createObjectURL(new Blob([pdfjsSource], { type: "text/javascript" }));
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      try {
        const pdfjs = (await import(pdfjsUrl)) as typeof PdfjsModule;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const bytes = Uint8Array.from(atob(bytesBase64), (character) => character.charCodeAt(0));
        const pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
        const results: { png: string; widthPt: number; heightPt: number }[] = [];
        const canvases: HTMLCanvasElement[] = [];
        try {
          for (let index = 0; index < pdfDocument.numPages; index += 1) {
            const pdfPage = await pdfDocument.getPage(index + 1);
            const viewport = pdfPage.getViewport({ scale: 1 });
            const renderViewport = pdfPage.getViewport({ scale: 4 });
            const canvas = window.document.createElement("canvas");
            canvases.push(canvas);
            canvas.width = Math.ceil(renderViewport.width);
            canvas.height = Math.ceil(renderViewport.height);
            const context = canvas.getContext("2d");
            if (context === null) throw new Error("No se pudo crear canvas de verificación OCR.");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await pdfPage.render({
              canvasContext: context,
              viewport: renderViewport,
              background: "#ffffff",
            }).promise;
            const rotation = rotations[index] ?? 0;
            let imageCanvas = canvas;
            if (rotation !== 0) {
              const oriented = window.document.createElement("canvas");
              canvases.push(oriented);
              oriented.width = rotation === 180 ? canvas.width : canvas.height;
              oriented.height = rotation === 180 ? canvas.height : canvas.width;
              const orientedContext = oriented.getContext("2d");
              if (orientedContext === null) throw new Error("No se pudo orientar el bitmap OCR.");
              if (rotation === 90) {
                orientedContext.setTransform(0, -1, 1, 0, 0, canvas.width);
              } else if (rotation === 180) {
                orientedContext.setTransform(-1, 0, 0, -1, canvas.width, canvas.height);
              } else {
                orientedContext.setTransform(0, 1, -1, 0, canvas.height, 0);
              }
              orientedContext.drawImage(canvas, 0, 0);
              imageCanvas = oriented;
            }
            results.push({
              png: imageCanvas.toDataURL("image/png").split(",")[1] ?? "",
              widthPt: viewport.width,
              heightPt: viewport.height,
            });
          }
        } finally {
          for (const canvas of canvases) {
            canvas.width = 0;
            canvas.height = 0;
          }
          await pdfDocument.destroy();
        }
        return results;
      } finally {
        URL.revokeObjectURL(pdfjsUrl);
        URL.revokeObjectURL(workerUrl);
      }
    },
    { pdfjsSource, workerSource, bytesBase64: Buffer.from(pdfBytes).toString("base64"), rotations },
  );
  return pngPages.map(({ png, widthPt, heightPt }) => ({
    png: Buffer.from(png, "base64"),
    widthPt,
    heightPt,
  }));
}

async function recognizePages(pages: ReadonlyArray<RasterizedPage>): Promise<OcrDocument> {
  const worker = await createWorker("spa", OEM.LSTM_ONLY, {
    langPath: LANGUAGE_PATH,
    cacheMethod: "none",
    gzip: true,
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    const recognized: OcrDocument["pages"][number][] = [];
    for (const page of pages) {
      const result = await worker.recognize(page.png);
      const lines =
        result.data.blocks?.flatMap((block) =>
          block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => line.text)),
        ) ?? result.data.text.split(/\r?\n/u).filter((line) => line.length > 0);
      recognized.push({ widthPt: page.widthPt, heightPt: page.heightPt, lines });
    }
    return { pages: recognized };
  } finally {
    await worker.terminate();
  }
}

export async function auditPdfWithIndependentOcr(
  page: Page,
  pdfBytes: Uint8Array,
  rotations: ReadonlyArray<0 | 90 | 180 | 270>,
): Promise<OcrAudit> {
  const [rasters, pdfjsVersion, assetHashes] = await Promise.all([
    rasterizePdfAt288Dpi(page, pdfBytes, rotations),
    packageVersionFromManifest(resolve("node_modules", "pdfjs-dist", "package.json")),
    verifyLocalOcrAssets(),
  ]);
  const document = await recognizePages(rasters);
  return {
    document,
    textByPage: document.pages.map((recognized) => recognized.lines.join("\n")),
    rasters,
    versions: {
      pdfjs: pdfjsVersion,
      tesseract: assetHashes.verifier.nodeWorker.version,
      tesseractCore: assetHashes.verifier.nodeCore.version,
    },
    assetHashes,
  };
}
