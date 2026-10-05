import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { chromium, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type * as PdfjsModule from "pdfjs-dist";

export const SMALL_REGION_SEED = 20261005;
export const SMALL_REGION_GENERATOR = "ocr-small-region-corpus-v2-misaligned-overlay";
export const PAGE_WIDTH_PT = 595;
export const PAGE_HEIGHT_PT = 842;
export const MEASURED_HEIGHTS_PT = [25, 50, 56, 75, 99, 100, 125] as const;
export const SOURCE_DPI = [150, 200, 300] as const;
export const CONTENT_KINDS = [
  "sensitive",
  "neutral",
  "blank",
  "native-overlay-misaligned",
] as const;
export const ORIENTATIONS = ["horizontal", "vertical"] as const;

export type SmallRegionOrientation = (typeof ORIENTATIONS)[number];
export type SmallRegionContent = (typeof CONTENT_KINDS)[number];

export interface SmallRegionCase {
  readonly id: string;
  readonly pageIndex: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly pageWidthPt: number;
  readonly pageHeightPt: number;
  readonly sourceDpi: number;
  readonly orientation: SmallRegionOrientation;
  readonly content: SmallRegionContent;
  readonly expectedTextTokens: ReadonlyArray<string>;
  readonly fontSizePx: number | null;
  readonly fontFace: string;
  readonly textMaxWidthPx: number | null;
  readonly truth: ReadonlyArray<string>;
  readonly imageRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly imagePixels: { readonly width: number; readonly height: number };
  readonly sourceImageSha256: string;
  readonly pdfImageRotationDegrees: number;
  readonly nativeLayerExplainsImage: boolean;
  readonly nativeOverlayAudit?: {
    readonly text: string;
    readonly font: string;
    readonly fontSizePt: number;
    readonly textRectPt: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly rasterInkRectPt: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    } | null;
    readonly bboxIntersectionOverSmallerArea: number;
    readonly relation: "misaligned-overlay-control" | "none";
  };
  readonly isFilterBoundary: boolean;
}

export interface SmallRegionCorpus {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly cases: ReadonlyArray<SmallRegionCase>;
  readonly generator: string;
  readonly seed: number;
  readonly pageCount: number;
}

export interface SmallRegionLoadFixture {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly cases: ReadonlyArray<SmallRegionCase>;
  readonly distribution: "one-per-page" | "many-same-page";
  readonly imageCount: number;
  readonly pageCount: number;
  readonly maxImagesPerPage: number;
}

export interface AlignedTextImageControl {
  readonly id: string;
  readonly pageIndex: number;
  readonly heightPt: 56 | 125;
  readonly orientation: SmallRegionOrientation;
  readonly sourceDpi: 150 | 200 | 300;
  readonly text: string;
  readonly imageRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly textRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly imagePixels: { readonly width: number; readonly height: number };
  readonly sourceImageSha256: string;
  readonly sourceImagePng: Uint8Array;
}

export interface AlignedTextImageCorpus {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly cases: ReadonlyArray<AlignedTextImageControl>;
  readonly generator: string;
  readonly seed: number;
}

export interface EntityAuditCorpus {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly cases: ReadonlyArray<SmallRegionCase>;
  readonly generator: string;
  readonly seed: number;
}

interface RasterResult {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly fontSizePx: number | null;
  readonly fontFace: string;
  readonly textMaxWidthPx: number | null;
  readonly inkBoundsPx: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function cropPdfTextAtDpi(
  page: Page,
  pdfBytes: Uint8Array,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  dpi: number,
): Promise<Uint8Array> {
  const [pdfJsSource, workerSource] = await Promise.all([
    readFile(
      new URL("../../../node_modules/pdfjs-dist/build/pdf.min.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  const result = await page.evaluate(
    async ({ pdfJsSource, workerSource, sourceBase64, rect, dpi }) => {
      const pdfjsUrl = URL.createObjectURL(new Blob([pdfJsSource], { type: "text/javascript" }));
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      let canvas: HTMLCanvasElement | undefined;
      let cropped: HTMLCanvasElement | undefined;
      let pdfDocument: PdfjsModule.PDFDocumentProxy | undefined;
      try {
        const pdfjs = (await import(pdfjsUrl)) as typeof PdfjsModule;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const bytes = Uint8Array.from(atob(sourceBase64), (character) => character.charCodeAt(0));
        pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
        const pdfPage = await pdfDocument.getPage(1);
        const scale = dpi / 72;
        const viewport = pdfPage.getViewport({ scale });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("Canvas de render PDF no disponible.");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
        cropped = document.createElement("canvas");
        cropped.width = Math.round(rect.width * scale);
        cropped.height = Math.round(rect.height * scale);
        const cropContext = cropped.getContext("2d");
        if (cropContext === null) throw new Error("Canvas del recorte PDF no disponible.");
        const cropX = Math.round(rect.x * scale);
        const cropY = Math.round((842 - rect.y - rect.height) * scale);
        cropContext.drawImage(
          canvas,
          cropX,
          cropY,
          cropped.width,
          cropped.height,
          0,
          0,
          cropped.width,
          cropped.height,
        );
        return cropped.toDataURL("image/png").split(",")[1] ?? "";
      } finally {
        if (cropped !== undefined) {
          cropped.width = 0;
          cropped.height = 0;
        }
        if (canvas !== undefined) {
          canvas.width = 0;
          canvas.height = 0;
        }
        await pdfDocument?.destroy();
        URL.revokeObjectURL(pdfjsUrl);
        URL.revokeObjectURL(workerUrl);
      }
    },
    {
      pdfJsSource,
      workerSource,
      sourceBase64: Buffer.from(pdfBytes).toString("base64"),
      rect,
      dpi,
    },
  );
  return Buffer.from(result, "base64");
}

export async function generateAlignedTextImageControls(): Promise<AlignedTextImageCorpus> {
  const doc = await PDFDocument.create();
  const date = new Date("2026-10-05T12:00:00.000Z");
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const cases: AlignedTextImageControl[] = [];
  try {
    for (const heightPt of [56, 125] as const) {
      for (const orientation of ORIENTATIONS) {
        for (const sourceDpi of SOURCE_DPI) {
          const widthPt = orientation === "horizontal" ? 300 : heightPt;
          const bandHeightPt = orientation === "horizontal" ? heightPt : 300;
          const imageRect = { x: 88, y: 300, width: widthPt, height: bandHeightPt };
          const text = "DNI 34567891";
          const fontSize = Math.min(18, heightPt * 0.45);
          const textWidth = font.widthOfTextAtSize(text, fontSize);
          const textX =
            orientation === "horizontal"
              ? imageRect.x + (imageRect.width - textWidth) / 2
              : imageRect.x + 25;
          const textY =
            orientation === "horizontal"
              ? imageRect.y + (imageRect.height - fontSize) / 2
              : imageRect.y + 16;
          const scratch = await PDFDocument.create();
          const scratchFont = await scratch.embedFont(StandardFonts.Helvetica);
          const scratchPage = scratch.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
          scratchPage.drawText(text, {
            x: textX,
            y: textY,
            size: fontSize,
            font: scratchFont,
            ...(orientation === "vertical" ? { rotate: degrees(90) } : {}),
            color: rgb(0, 0, 0),
          });
          const scratchBytes = await scratch.save({ useObjectStreams: false });
          const sourcePng = await cropPdfTextAtDpi(page, scratchBytes, imageRect, sourceDpi);
          const embedded = await doc.embedPng(sourcePng);
          const outputPage = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
          outputPage.drawImage(embedded, imageRect);
          outputPage.drawText(text, {
            x: textX,
            y: textY,
            size: fontSize,
            font,
            opacity: 0,
            ...(orientation === "vertical" ? { rotate: degrees(90) } : {}),
            color: rgb(0, 0, 0),
          });
          outputPage.drawText("CONTROL PUBLICO", {
            x: 8,
            y: 8,
            size: 6,
            font,
            color: rgb(0, 0, 0),
          });
          const id = "aligned-h" + heightPt + "-" + orientation + "-d" + sourceDpi;
          const textRect =
            orientation === "horizontal"
              ? { x: textX, y: textY, width: textWidth, height: fontSize }
              : { x: textX - fontSize, y: textY, width: fontSize, height: textWidth };
          cases.push({
            id,
            pageIndex: cases.length,
            heightPt,
            orientation,
            sourceDpi,
            text,
            imageRect,
            textRect,
            imagePixels: {
              width: Math.round((widthPt * sourceDpi) / 72),
              height: Math.round((bandHeightPt * sourceDpi) / 72),
            },
            sourceImageSha256: sha256(sourcePng),
            sourceImagePng: sourcePng,
          });
        }
      }
    }
  } finally {
    await page.close();
    await browser.close();
  }
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return {
    bytes,
    sha256: sha256(bytes),
    cases,
    generator: "aligned-pdf-text-raster-controls-v1",
    seed: SMALL_REGION_SEED,
  };
}

export async function generateEntityAuditControls(): Promise<EntityAuditCorpus> {
  const doc = await PDFDocument.create();
  const fixedTime = new Date("2026-10-05T12:00:00.000Z");
  doc.setCreationDate(fixedTime);
  doc.setModificationDate(fixedTime);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const browser = await chromium.launch();
  const rasterPage = await browser.newPage();
  const cases: SmallRegionCase[] = [];
  try {
    for (const content of ["sensitive", "neutral", "blank"] as const) {
      const image = await rasterize(
        rasterPage,
        300,
        56,
        300,
        "horizontal",
        content,
        SMALL_REGION_SEED ^ cases.length ^ 0x148,
      );
      const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
      const embedded = await doc.embedPng(image.bytes);
      const imageRect = { x: 88, y: 300, width: 300, height: 56 };
      page.drawImage(embedded, imageRect);
      page.drawText("CONTROL PUBLICO", {
        x: 8,
        y: 8,
        size: 6,
        font,
        color: rgb(0, 0, 0),
      });
      const contentInfo = textFor(content);
      cases.push({
        id: `entity-audit-${content}-300x56-d300`,
        pageIndex: cases.length,
        widthPt: 300,
        heightPt: 56,
        pageWidthPt: PAGE_WIDTH_PT,
        pageHeightPt: PAGE_HEIGHT_PT,
        sourceDpi: 300,
        orientation: "horizontal",
        content,
        expectedTextTokens: contentInfo.expectedTextTokens,
        fontSizePx: image.fontSizePx,
        fontFace: image.fontFace,
        textMaxWidthPx: image.textMaxWidthPx,
        truth: contentInfo.truth,
        imageRect,
        imagePixels: { width: image.width, height: image.height },
        sourceImageSha256: sha256(image.bytes),
        pdfImageRotationDegrees: 0,
        nativeLayerExplainsImage: false,
        isFilterBoundary: false,
      });
    }
  } finally {
    await rasterPage.close();
    await browser.close();
  }
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return {
    bytes,
    sha256: sha256(bytes),
    cases,
    generator: "ocr-small-region-entity-audit-controls-v1",
    seed: SMALL_REGION_SEED,
  };
}

function textFor(content: SmallRegionContent): {
  readonly text: string;
  readonly truth: ReadonlyArray<string>;
  readonly expectedTextTokens: ReadonlyArray<string>;
} {
  if (content === "sensitive" || content === "native-overlay-misaligned") {
    return {
      text: "DNI 34567891",
      truth: ["34567891"],
      expectedTextTokens: ["DNI", "34567891"],
    };
  }
  if (content === "neutral") {
    return { text: "REGION PUBLICA", truth: [], expectedTextTokens: ["REGION", "PUBLICA"] };
  }
  return { text: "", truth: [], expectedTextTokens: [] };
}

async function rasterize(
  page: Page,
  widthPt: number,
  heightPt: number,
  dpi: number,
  orientation: SmallRegionOrientation,
  content: SmallRegionContent,
  seed: number,
  textOverride?: string,
): Promise<RasterResult> {
  const pixelWidth = Math.max(1, Math.round((widthPt * dpi) / 72));
  const pixelHeight = Math.max(1, Math.round((heightPt * dpi) / 72));
  const text = textOverride ?? textFor(content).text;
  const shortSide = orientation === "horizontal" ? pixelHeight : pixelWidth;
  const lines = text.split("\n");
  const fontSizePx =
    text.length === 0 ? null : Math.max(5, Math.floor((shortSide * 0.53) / lines.length));
  const textMaxWidthPx =
    text.length === 0 ? null : (orientation === "horizontal" ? pixelWidth : pixelHeight) - 8;
  const result = await page.evaluate(
    ({ width, height, value, direction, noiseSeed }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (context === null) throw new Error("Canvas 2D no disponible");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      if (value.length > 0) {
        const lines = value.split("\n");
        const shortSide = direction === "horizontal" ? height : width;
        const fontSize = Math.max(5, Math.floor((shortSide * 0.53) / lines.length));
        context.fillStyle = "#111";
        context.font = `600 ${fontSize}px Arial`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        if (direction === "horizontal") {
          lines.forEach((line, index) =>
            context.fillText(
              line,
              width / 2,
              height / 2 + (index - (lines.length - 1) / 2) * fontSize,
              width - 8,
            ),
          );
        } else {
          context.save();
          context.translate(width / 2, height / 2);
          context.rotate(-Math.PI / 2);
          lines.forEach((line, index) =>
            context.fillText(line, 0, (index - (lines.length - 1) / 2) * fontSize, height - 8),
          );
          context.restore();
        }
      } else {
        let state = noiseSeed >>> 0;
        const pixels = context.getImageData(0, 0, width, height);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            const index = (y * width + x) * 4;
            const stamp = x < 14 && y < 14 && (x + y) % 3 === 0;
            const shade = stamp ? 120 : 245 + Math.floor((state >>> 24) % 10);
            pixels.data[index] = shade;
            pixels.data[index + 1] = shade;
            pixels.data[index + 2] = shade;
            pixels.data[index + 3] = 255;
          }
        }
        context.putImageData(pixels, 0, 0);
      }
      const imageData = context.getImageData(0, 0, width, height).data;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          if (
            (imageData[index] ?? 255) < 180 ||
            (imageData[index + 1] ?? 255) < 180 ||
            (imageData[index + 2] ?? 255) < 180
          ) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      const inkBounds =
        maxX < minX || maxY < minY
          ? null
          : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      return new Promise<{
        readonly base64: string;
        readonly width: number;
        readonly height: number;
        readonly inkBounds: typeof inkBounds;
      }>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) {
            reject(new Error("canvas.toBlob falló"));
            return;
          }
          void blob.arrayBuffer().then((buffer) => {
            const bytes = new Uint8Array(buffer);
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 0x8000) {
              binary += String.fromCharCode(
                ...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)),
              );
            }
            resolve({ base64: btoa(binary), width, height, inkBounds });
          }, reject);
        }, "image/png");
      });
    },
    {
      width: pixelWidth,
      height: pixelHeight,
      value: text,
      direction: orientation,
      noiseSeed: seed,
    },
  );
  return {
    bytes: Uint8Array.from(Buffer.from(result.base64, "base64")),
    width: result.width,
    height: result.height,
    fontSizePx,
    fontFace: text.length === 0 ? "none" : `600 ${fontSizePx}px Arial`,
    textMaxWidthPx,
    inkBoundsPx: result.inkBounds,
  };
}

export async function generateSmallRegionCorpus(): Promise<SmallRegionCorpus> {
  const doc = await PDFDocument.create();
  const fixedTime = new Date("2026-10-05T12:00:00.000Z");
  doc.setCreationDate(fixedTime);
  doc.setModificationDate(fixedTime);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const browser = await chromium.launch();
  const rasterPage = await browser.newPage();
  const cases: SmallRegionCase[] = [];
  try {
    for (const heightPt of MEASURED_HEIGHTS_PT) {
      for (const orientation of ORIENTATIONS) {
        for (const sourceDpi of SOURCE_DPI) {
          for (const content of CONTENT_KINDS) {
            const widthPt = orientation === "horizontal" ? 300 : heightPt;
            const bandHeightPt = orientation === "horizontal" ? heightPt : 300;
            const image = await rasterize(
              rasterPage,
              widthPt,
              bandHeightPt,
              sourceDpi,
              orientation,
              content,
              SMALL_REGION_SEED ^ cases.length,
            );
            const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
            const embedded = await doc.embedPng(image.bytes);
            const imageRect = { x: 88, y: 300, width: widthPt, height: bandHeightPt };
            page.drawImage(embedded, imageRect);
            const contentInfo = textFor(content);
            let nativeOverlayAudit: NonNullable<SmallRegionCase["nativeOverlayAudit"]> | undefined;
            if (content === "native-overlay-misaligned") {
              const nativeSize = Math.max(
                4,
                Math.min(12, Math.floor(Math.min(widthPt, bandHeightPt) * 0.53)),
              );
              const textWidth = font.widthOfTextAtSize(contentInfo.text, nativeSize);
              const textX = imageRect.x + Math.max(1, (imageRect.width - textWidth) / 2);
              const textY = imageRect.y + (imageRect.height - nativeSize) / 2;
              page.drawText(contentInfo.text, {
                x: textX,
                y: textY,
                size: nativeSize,
                font,
                color: rgb(0, 0, 0),
              });
              const ink = image.inkBoundsPx;
              nativeOverlayAudit = {
                text: contentInfo.text,
                font: "Helvetica",
                fontSizePt: nativeSize,
                textRectPt: { x: textX, y: textY, width: textWidth, height: nativeSize },
                rasterInkRectPt:
                  ink === null
                    ? null
                    : {
                        x: imageRect.x + ink.x * (imageRect.width / image.width),
                        y:
                          imageRect.y +
                          (image.height - ink.y - ink.height) * (imageRect.height / image.height),
                        width: ink.width * (imageRect.width / image.width),
                        height: ink.height * (imageRect.height / image.height),
                      },
                bboxIntersectionOverSmallerArea: (() => {
                  if (ink === null) return 0;
                  const rasterLeft = imageRect.x + ink.x * (imageRect.width / image.width);
                  const rasterBottom =
                    imageRect.y +
                    (image.height - ink.y - ink.height) * (imageRect.height / image.height);
                  const rasterWidth = ink.width * (imageRect.width / image.width);
                  const rasterHeight = ink.height * (imageRect.height / image.height);
                  const overlapWidth = Math.max(
                    0,
                    Math.min(textX + textWidth, rasterLeft + rasterWidth) -
                      Math.max(textX, rasterLeft),
                  );
                  const overlapHeight = Math.max(
                    0,
                    Math.min(textY + nativeSize, rasterBottom + rasterHeight) -
                      Math.max(textY, rasterBottom),
                  );
                  const smallerArea = Math.min(textWidth * nativeSize, rasterWidth * rasterHeight);
                  return smallerArea === 0 ? 0 : (overlapWidth * overlapHeight) / smallerArea;
                })(),
                relation: "misaligned-overlay-control",
              };
            }
            // A neutral native word makes these mixed pages use only the product's
            // retained-region path; the word sits outside every image rectangle.
            page.drawText("CONTROL PUBLICO", {
              x: 8,
              y: 8,
              size: 6,
              font,
              color: rgb(0, 0, 0),
            });
            const id = `h${heightPt}-${orientation}-d${sourceDpi}-${content}`;
            cases.push({
              id,
              pageIndex: cases.length,
              widthPt,
              heightPt: bandHeightPt,
              pageWidthPt: PAGE_WIDTH_PT,
              pageHeightPt: PAGE_HEIGHT_PT,
              sourceDpi,
              orientation,
              content,
              truth: contentInfo.truth,
              expectedTextTokens: contentInfo.expectedTextTokens,
              fontSizePx: image.fontSizePx,
              fontFace: image.fontFace,
              textMaxWidthPx: image.textMaxWidthPx,
              imageRect,
              imagePixels: { width: image.width, height: image.height },
              sourceImageSha256: sha256(image.bytes),
              pdfImageRotationDegrees: 0,
              nativeLayerExplainsImage: false,
              ...(nativeOverlayAudit === undefined ? {} : { nativeOverlayAudit }),
              isFilterBoundary: false,
            });
          }
        }
      }
    }

    // Area boundary in a 1200 × 1200 pt page: candidate width 120 pt keeps
    // both sides above the current 100 pt minimum while straddling 1% area.
    for (const [label, imageHeight] of [
      ["area-0.99", 119],
      ["area-1.00", 120],
      ["area-1.01", 121],
    ] as const) {
      const page = doc.addPage([1200, 1200]);
      const image = await rasterize(
        rasterPage,
        120,
        imageHeight,
        200,
        "horizontal",
        "sensitive",
        SMALL_REGION_SEED ^ cases.length,
      );
      const embedded = await doc.embedPng(image.bytes);
      const imageRect = { x: 80, y: 400, width: 120, height: imageHeight };
      page.drawImage(embedded, imageRect);
      page.drawText("CONTROL PUBLICO", { x: 8, y: 8, size: 6, font, color: rgb(0, 0, 0) });
      cases.push({
        id: label,
        pageIndex: cases.length,
        widthPt: 120,
        heightPt: imageHeight,
        pageWidthPt: 1200,
        pageHeightPt: 1200,
        sourceDpi: 200,
        orientation: "horizontal",
        content: "sensitive",
        truth: ["34567891"],
        expectedTextTokens: ["DNI", "34567891"],
        fontSizePx: image.fontSizePx,
        fontFace: image.fontFace,
        textMaxWidthPx: image.textMaxWidthPx,
        imageRect,
        imagePixels: { width: image.width, height: image.height },
        sourceImageSha256: sha256(image.bytes),
        pdfImageRotationDegrees: 0,
        nativeLayerExplainsImage: false,
        isFilterBoundary: true,
      });
    }

    for (const [id, x, y] of [
      ["grid-aligned", (595 / 64) * 12, (842 / 64) * 20],
      ["grid-crossing", (595 / 64) * 12 + 0.5, (842 / 64) * 20 + 0.5],
    ] as const) {
      const gridPage = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
      const gridImage = await rasterize(
        rasterPage,
        300,
        125,
        200,
        "horizontal",
        "sensitive",
        SMALL_REGION_SEED ^ cases.length,
      );
      const gridEmbedded = await doc.embedPng(gridImage.bytes);
      const gridRect = { x, y, width: 300, height: 125 };
      gridPage.drawImage(gridEmbedded, gridRect);
      gridPage.drawText("CONTROL PUBLICO", { x: 8, y: 8, size: 6, font, color: rgb(0, 0, 0) });
      cases.push({
        id,
        pageIndex: cases.length,
        widthPt: 300,
        heightPt: 125,
        pageWidthPt: PAGE_WIDTH_PT,
        pageHeightPt: PAGE_HEIGHT_PT,
        sourceDpi: 200,
        orientation: "horizontal",
        content: "sensitive",
        truth: ["34567891"],
        expectedTextTokens: ["DNI", "34567891"],
        fontSizePx: gridImage.fontSizePx,
        fontFace: gridImage.fontFace,
        textMaxWidthPx: gridImage.textMaxWidthPx,
        imageRect: gridRect,
        imagePixels: { width: gridImage.width, height: gridImage.height },
        sourceImageSha256: sha256(gridImage.bytes),
        pdfImageRotationDegrees: 0,
        nativeLayerExplainsImage: false,
        isFilterBoundary: true,
      });
    }

    for (const rotation of [90, 180] as const) {
      const rotatedPage = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
      const rotatedImage = await rasterize(
        rasterPage,
        300,
        125,
        200,
        "horizontal",
        "sensitive",
        SMALL_REGION_SEED ^ cases.length,
      );
      const rotatedEmbedded = await doc.embedPng(rotatedImage.bytes);
      const rect =
        rotation === 90
          ? { x: 240, y: 350, width: 300, height: 125 }
          : { x: 380, y: 400, width: 300, height: 125 };
      rotatedPage.drawImage(rotatedEmbedded, { ...rect, rotate: degrees(rotation) });
      rotatedPage.drawText("CONTROL PUBLICO", {
        x: 8,
        y: 8,
        size: 6,
        font,
        color: rgb(0, 0, 0),
      });
      cases.push({
        id: `rotation-${rotation}`,
        pageIndex: cases.length,
        widthPt: rotation === 90 ? 125 : 300,
        heightPt: rotation === 90 ? 300 : 125,
        pageWidthPt: PAGE_WIDTH_PT,
        pageHeightPt: PAGE_HEIGHT_PT,
        sourceDpi: 200,
        orientation: "horizontal",
        content: "sensitive",
        truth: ["34567891"],
        expectedTextTokens: ["DNI", "34567891"],
        fontSizePx: rotatedImage.fontSizePx,
        fontFace: rotatedImage.fontFace,
        textMaxWidthPx: rotatedImage.textMaxWidthPx,
        imageRect:
          rotation === 90
            ? { x: rect.x - rect.height, y: rect.y, width: rect.height, height: rect.width }
            : {
                x: rect.x - rect.width,
                y: rect.y - rect.height,
                width: rect.width,
                height: rect.height,
              },
        imagePixels: { width: rotatedImage.width, height: rotatedImage.height },
        sourceImageSha256: sha256(rotatedImage.bytes),
        pdfImageRotationDegrees: rotation,
        nativeLayerExplainsImage: false,
        isFilterBoundary: true,
      });
    }
  } finally {
    await rasterPage.close();
    await browser.close();
  }
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return {
    bytes,
    sha256: sha256(bytes),
    cases,
    generator: SMALL_REGION_GENERATOR,
    seed: SMALL_REGION_SEED,
    pageCount: cases.length,
  };
}

export async function generateSmallRegionLoadFixture(
  imageCount: 1 | 10 | 50,
  distribution: "one-per-page" | "many-same-page",
): Promise<SmallRegionLoadFixture> {
  const doc = await PDFDocument.create();
  const date = new Date("2026-10-05T12:00:00.000Z");
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const browser = await chromium.launch();
  const rasterPage = await browser.newPage();
  const cases: SmallRegionCase[] = [];
  try {
    const onePerPage = distribution === "one-per-page";
    const pageCount = onePerPage ? imageCount : 1;
    const widthPt = onePerPage ? 300 : 40;
    const heightPt = onePerPage ? 56 : 25;
    const image = await rasterize(
      rasterPage,
      widthPt,
      heightPt,
      300,
      "horizontal",
      "sensitive",
      SMALL_REGION_SEED ^ imageCount ^ (onePerPage ? 0x11 : 0x22),
    );
    const embedded = await doc.embedPng(image.bytes);
    const totalImages = imageCount;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
      page.drawText("CONTROL DNI 99999999", { x: 8, y: 8, size: 6, font, color: rgb(0, 0, 0) });
      const countOnPage = onePerPage ? 1 : totalImages;
      const columns = onePerPage ? 1 : 5;
      const gapX = onePerPage ? 0 : 8;
      const gapY = onePerPage ? 0 : 8;
      for (let localIndex = 0; localIndex < countOnPage; localIndex += 1) {
        const col = localIndex % columns;
        const row = Math.floor(localIndex / columns);
        const rect = {
          x: onePerPage ? 88 : 24 + col * (widthPt + gapX),
          y: onePerPage ? 300 : PAGE_HEIGHT_PT - 40 - heightPt - row * (heightPt + gapY),
          width: widthPt,
          height: heightPt,
        };
        page.drawImage(embedded, rect);
        cases.push({
          id: `load-${distribution}-${imageCount}-p${pageIndex}-i${localIndex}`,
          pageIndex,
          widthPt,
          heightPt,
          pageWidthPt: PAGE_WIDTH_PT,
          pageHeightPt: PAGE_HEIGHT_PT,
          sourceDpi: 300,
          orientation: "horizontal",
          content: "sensitive",
          truth: ["34567891"],
          expectedTextTokens: ["DNI", "34567891"],
          fontSizePx: image.fontSizePx,
          fontFace: image.fontFace,
          textMaxWidthPx: image.textMaxWidthPx,
          imageRect: rect,
          imagePixels: { width: image.width, height: image.height },
          sourceImageSha256: sha256(image.bytes),
          pdfImageRotationDegrees: 0,
          nativeLayerExplainsImage: false,
          isFilterBoundary: true,
        });
      }
    }
  } finally {
    await rasterPage.close();
    await browser.close();
  }
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return {
    bytes,
    sha256: sha256(bytes),
    cases,
    distribution,
    imageCount,
    pageCount: distribution === "one-per-page" ? imageCount : 1,
    maxImagesPerPage: distribution === "one-per-page" ? 1 : imageCount,
  };
}

export async function extractCorpusPage(
  corpusBytes: Uint8Array,
  pageIndex: number,
): Promise<Buffer> {
  const source = await PDFDocument.load(corpusBytes);
  const output = await PDFDocument.create();
  output.setCreationDate(new Date("2026-10-05T12:00:00.000Z"));
  output.setModificationDate(new Date("2026-10-05T12:00:00.000Z"));
  const [page] = await output.copyPages(source, [pageIndex]);
  if (page === undefined) throw new Error(`Página fuera del corpus: ${pageIndex}`);
  output.addPage(page);
  return Buffer.from(await output.save({ useObjectStreams: false }));
}

export async function extractCorpusPages(
  corpusBytes: Uint8Array,
  pageIndexes: ReadonlyArray<number>,
): Promise<Buffer> {
  const source = await PDFDocument.load(corpusBytes);
  const output = await PDFDocument.create();
  output.setCreationDate(new Date("2026-10-05T12:00:00.000Z"));
  output.setModificationDate(new Date("2026-10-05T12:00:00.000Z"));
  for (const pageIndex of pageIndexes) {
    const [page] = await output.copyPages(source, [pageIndex]);
    if (page === undefined) throw new Error(`Página fuera del corpus: ${pageIndex}`);
    output.addPage(page);
  }
  return Buffer.from(await output.save({ useObjectStreams: false }));
}

export function scoreOcrText(
  truth: ReadonlyArray<string>,
  recognizedText: string,
): {
  readonly found: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
  /**
   * Historical text-level indicator retained for prior report compatibility.
   * It is not an entity false positive: with empty numeric truth, any text
   * (including REGION PUBLICA) sets it. Use detector occurrence audits for
   * entity false positives and blank-only truth for OCR text noise.
   */
  readonly falsePositive: boolean;
  readonly nonemptyTextWithoutNumericTruth: boolean;
} {
  const normalized = recognizedText.replaceAll(/\s+/g, " ").replaceAll(/[.-]/g, "");
  const found = truth.filter((value) => normalized.includes(value));
  return {
    found,
    missing: truth.filter((value) => !found.includes(value)),
    falsePositive: truth.length === 0 && recognizedText.trim().length > 0,
    nonemptyTextWithoutNumericTruth: truth.length === 0 && recognizedText.trim().length > 0,
  };
}

export function scoreExpectedText(
  expectedTokens: ReadonlyArray<string>,
  recognizedText: string,
): {
  readonly foundTokens: ReadonlyArray<string>;
  readonly missingTokens: ReadonlyArray<string>;
  readonly tokenRecall: number | null;
  readonly tokenPrecision: number | null;
  readonly recognizedTokenCount: number;
  readonly recognizedTextIsEmpty: boolean;
} {
  const normalized = recognizedText.toLocaleUpperCase().replaceAll(/[^\p{L}\p{N}]+/gu, " ");
  const recognizedTokens = new Set(normalized.split(/\s+/u).filter(Boolean));
  const foundTokens = expectedTokens.filter((token) =>
    recognizedTokens.has(token.toLocaleUpperCase()),
  );
  return {
    foundTokens,
    missingTokens: expectedTokens.filter((token) => !foundTokens.includes(token)),
    tokenRecall: expectedTokens.length === 0 ? null : foundTokens.length / expectedTokens.length,
    tokenPrecision:
      expectedTokens.length === 0 || recognizedTokens.size === 0
        ? null
        : foundTokens.length / recognizedTokens.size,
    recognizedTokenCount: recognizedTokens.size,
    recognizedTextIsEmpty: recognizedText.trim().length === 0,
  };
}

export function assessIndependentSourceLegibility(
  content: SmallRegionContent,
  truth: ReadonlyArray<string>,
  expectedTokens: ReadonlyArray<string>,
  recognizedText: string,
): {
  readonly independentlyReadable: boolean;
  readonly inconclusive: boolean;
  readonly status: "CONFIRMED_READABLE" | "INCONCLUSIVE_NOT_CONFIRMED_BY_INDEPENDENT_OCR";
  readonly tokenTruth: ReturnType<typeof scoreExpectedText>;
  readonly sensitiveTargetFound: ReadonlyArray<string>;
  readonly spuriousTextForNoTextTruth: boolean;
} {
  const tokenTruth = scoreExpectedText(expectedTokens, recognizedText);
  const sensitiveTargetFound = scoreOcrText(truth, recognizedText).found;
  const hasTextTruth = expectedTokens.length > 0 || truth.length > 0;
  const independentlyReadable =
    hasTextTruth &&
    tokenTruth.missingTokens.length === 0 &&
    (truth.length === 0 || sensitiveTargetFound.length === truth.length);
  return {
    independentlyReadable,
    inconclusive: !independentlyReadable,
    status: independentlyReadable
      ? "CONFIRMED_READABLE"
      : "INCONCLUSIVE_NOT_CONFIRMED_BY_INDEPENDENT_OCR",
    tokenTruth,
    sensitiveTargetFound,
    spuriousTextForNoTextTruth:
      truth.length === 0 && expectedTokens.length === 0 && recognizedText.trim().length > 0,
  };
}
