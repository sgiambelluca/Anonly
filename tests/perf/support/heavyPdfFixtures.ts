import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const HEAVY_GENERATOR_VERSION = "heavy-pdf-v1";
export const HEAVY_SEED = 17420260923;
export const HEAVY_PAGE_COUNT = 6;
export const HEAVY_IMAGE_WIDTH = 1800;
export const HEAVY_IMAGE_HEIGHT = 2544;
export const HEAVY_SOURCE_MIN_BYTES = 8 * 1024 * 1024;
const CACHE_DIR = resolve(".measure/fixtures");
const C0_FIXTURE_PATH = resolve("tests/fixtures/text-10p.pdf");
export const C0_FIXTURE_SHA256 = "0a495198686aae89091b38147860b2f48de4a37e7a013d3f41c028f9262b104a";
export const C0_FIXTURE_SIZE_BYTES = 3_391;

export type HeavyProfile = "C0" | "H1" | "H2";

export interface HeavyFixture {
  readonly profile: HeavyProfile;
  readonly generatorVersion: string;
  readonly seed: number;
  readonly pageCount: number;
  readonly pageWidthPt: number;
  readonly pageHeightPt: number;
  readonly imageWidthPx: number | null;
  readonly imageHeightPx: number | null;
  readonly visualMode: "native-text" | "color" | "grayscale";
  readonly codec: "none" | "jpeg" | "png";
  readonly encodedColorSpace: string;
  readonly bytes: Buffer;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly cachePath: string;
}

interface ImageBytes {
  readonly data: Uint8Array;
  readonly mimeType: "image/jpeg" | "image/png";
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixturePath(profile: HeavyProfile): string {
  if (profile === "C0") return C0_FIXTURE_PATH;
  const params = `${HEAVY_GENERATOR_VERSION}-${profile}-${HEAVY_PAGE_COUNT}p-${HEAVY_IMAGE_WIDTH}x${HEAVY_IMAGE_HEIGHT}-${HEAVY_SEED}`;
  return resolve(CACHE_DIR, `${params}.pdf`);
}

/** Shared H1/H2 pixel pattern, exposed for a small deterministic unit test. */
export function fillDeterministicPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  pageNo: number,
  seed: number,
  grayscale: boolean,
): void {
  let state = (seed ^ Math.imul(pageNo + 1, 0x9e3779b1)) >>> 0;
  for (let offset = 0; offset < width * height * 4; offset += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const value = 24 + ((state >>> 24) % 208);
    data[offset] = value;
    data[offset + 1] = grayscale ? value : (value * 3 + 29) % 256;
    data[offset + 2] = grayscale ? value : (value * 7 + 61) % 256;
    data[offset + 3] = 255;
  }
}

async function makeEncodedImage(pageIndex: number, grayscale: boolean): Promise<ImageBytes> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({
      content: `window.__fillHeavyFixturePixels = ${fillDeterministicPixels.toString()};`,
    });
    const encoded = await page.evaluate(
      async ({ width, height, page: pageNo, seed, grayscale: gray }) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        if (context === null) throw new Error("Canvas 2D no disponible");
        const image = context.createImageData(width, height);
        const scope = window as unknown as {
          __fillHeavyFixturePixels: (
            target: Uint8ClampedArray,
            pixelWidth: number,
            pixelHeight: number,
            pageNumber: number,
            fixtureSeed: number,
            isGrayscale: boolean,
          ) => void;
        };
        scope.__fillHeavyFixturePixels(image.data, width, height, pageNo, seed, gray);
        context.putImageData(image, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (candidate) =>
              candidate ? resolve(candidate) : reject(new Error("canvas.toBlob falló")),
            gray ? "image/png" : "image/jpeg",
            0.88,
          );
        });
        return { mimeType: blob.type, base64: await blobToBase64(blob) };
        async function blobToBase64(blobValue: Blob): Promise<string> {
          const buffer = await blobValue.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
          }
          return btoa(binary);
        }
      },
      {
        width: HEAVY_IMAGE_WIDTH,
        height: HEAVY_IMAGE_HEIGHT,
        page: pageIndex,
        seed: HEAVY_SEED,
        grayscale,
      },
    );
    return {
      data: Uint8Array.from(Buffer.from(encoded.base64, "base64")),
      mimeType: encoded.mimeType === "image/png" ? "image/png" : "image/jpeg",
    };
  } finally {
    await browser.close();
  }
}

async function generatePdf(profile: HeavyProfile): Promise<Buffer> {
  if (profile === "C0") return readFile(C0_FIXTURE_PATH);
  const doc = await PDFDocument.create();
  const fixedDate = new Date(
    profile === "H1" ? "2026-09-23T16:07:33.000Z" : "2026-09-23T16:07:35.000Z",
  );
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let index = 0; index < HEAVY_PAGE_COUNT; index += 1) {
    const image = await makeEncodedImage(index, profile === "H2");
    const embedded =
      image.mimeType === "image/png"
        ? await doc.embedPng(image.data)
        : await doc.embedJpg(image.data);
    const page = doc.addPage([595, 842]);
    page.drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
    page.drawRectangle({ x: 24, y: 24, width: 547, height: 58, color: rgb(1, 1, 1) });
    page.drawText(`MARCA SINTETICA PAGINA ${index + 1}`, {
      x: 34,
      y: 59,
      size: 13,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(`Vecino: informe ficticio ${index + 1} / control ${HEAVY_SEED}.`, {
      x: 34,
      y: 38,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Rebuilds one fixture without reading or writing the cache; used by the
 * explicit heavy-generator reproducibility check. */
export async function regenerateHeavyFixture(profile: HeavyProfile): Promise<HeavyFixture> {
  const bytes = await generatePdf(profile);
  return toFixture(profile, bytes, "<regenerated-without-cache>");
}

function toFixture(profile: HeavyProfile, bytes: Buffer, cachePath: string): HeavyFixture {
  const heavy = profile !== "C0";
  return {
    profile,
    generatorVersion: profile === "C0" ? "versioned-fixture" : HEAVY_GENERATOR_VERSION,
    seed: HEAVY_SEED,
    pageCount: heavy ? HEAVY_PAGE_COUNT : 10,
    pageWidthPt: 595,
    pageHeightPt: 842,
    imageWidthPx: heavy ? HEAVY_IMAGE_WIDTH : null,
    imageHeightPx: heavy ? HEAVY_IMAGE_HEIGHT : null,
    visualMode: profile === "C0" ? "native-text" : profile === "H1" ? "color" : "grayscale",
    codec: profile === "C0" ? "none" : profile === "H1" ? "jpeg" : "png",
    // Chromium Canvas emits PNG RGB here; equal channel values make it visually gray,
    // but the file is not claimed to be one-channel grayscale.
    encodedColorSpace:
      profile === "H2"
        ? "RGB PNG, equal R/G/B channels"
        : profile === "H1"
          ? "RGB JPEG"
          : "not-applicable",
    bytes,
    sizeBytes: bytes.byteLength,
    sha256: digest(bytes),
    cachePath,
  };
}

export async function getOrGenerateHeavyFixture(profile: HeavyProfile): Promise<HeavyFixture> {
  if (profile !== "C0") await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = fixturePath(profile);
  const manifestPath = `${cachePath}.json`;
  const cached = profile === "C0" ? undefined : await readFile(cachePath).catch(() => undefined);
  const bytes =
    profile === "C0" ? await readFile(C0_FIXTURE_PATH) : (cached ?? (await generatePdf(profile)));
  const fixture = toFixture(profile, bytes, cachePath);
  if (profile === "C0") {
    if (fixture.sha256 !== C0_FIXTURE_SHA256 || fixture.sizeBytes !== C0_FIXTURE_SIZE_BYTES) {
      throw new Error("C0 no coincide con el fixture versionado tests/fixtures/text-10p.pdf");
    }
  } else if (cached !== undefined) {
    const manifestBytes = await readFile(manifestPath).catch(() => undefined);
    if (manifestBytes === undefined)
      throw new Error(`${profile}: falta manifest de caché ${manifestPath}`);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      readonly profile?: unknown;
      readonly generatorVersion?: unknown;
      readonly pageCount?: unknown;
      readonly pageWidthPt?: unknown;
      readonly pageHeightPt?: unknown;
      readonly sha256?: unknown;
      readonly sizeBytes?: unknown;
    };
    if (
      manifest.profile !== profile ||
      manifest.generatorVersion !== fixture.generatorVersion ||
      manifest.pageCount !== fixture.pageCount ||
      manifest.pageWidthPt !== fixture.pageWidthPt ||
      manifest.pageHeightPt !== fixture.pageHeightPt ||
      manifest.sha256 !== fixture.sha256 ||
      manifest.sizeBytes !== fixture.sizeBytes
    ) {
      throw new Error(`${profile}: hash o tamaño de caché no coincide con su manifest`);
    }
  }
  if (profile !== "C0" && fixture.sizeBytes < HEAVY_SOURCE_MIN_BYTES) {
    throw new Error(
      `${profile} incumple tamaño mínimo: ${fixture.sizeBytes} < ${HEAVY_SOURCE_MIN_BYTES}`,
    );
  }
  const parsed = await PDFDocument.load(bytes);
  const expectedPages = profile === "C0" ? 10 : HEAVY_PAGE_COUNT;
  if (parsed.getPageCount() !== expectedPages)
    throw new Error(`${profile}: cantidad de páginas inválida en caché`);
  for (const [index, page] of parsed.getPages().entries()) {
    const size = page.getSize();
    if (
      Math.abs(size.width - fixture.pageWidthPt) > 1 ||
      Math.abs(size.height - fixture.pageHeightPt) > 1
    ) {
      throw new Error(
        `${profile}: página ${index + 1} mide ${size.width}x${size.height} pt; se esperaba ` +
          `${fixture.pageWidthPt}x${fixture.pageHeightPt} pt ±1`,
      );
    }
  }
  if (profile !== "C0" && cached === undefined) {
    await writeFile(cachePath, bytes);
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          profile,
          generatorVersion: fixture.generatorVersion,
          seed: fixture.seed,
          pageCount: fixture.pageCount,
          pageWidthPt: fixture.pageWidthPt,
          pageHeightPt: fixture.pageHeightPt,
          imageWidthPx: fixture.imageWidthPx,
          imageHeightPx: fixture.imageHeightPx,
          codec: fixture.codec,
          sha256: fixture.sha256,
          sizeBytes: fixture.sizeBytes,
        },
        null,
        2,
      )}\n`,
    );
  }
  return fixture;
}
