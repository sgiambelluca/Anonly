import type { Page } from "@playwright/test";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFPage } from "pdf-lib";
import type * as PdfjsModule from "pdfjs-dist";

import { rasterizeToScannedPdf } from "./scannedPdf.js";

export const EXPORT_FIXTURE_IDS = ["native", "scan", "mixed", "stamp"] as const;
export type ExportFixtureId = (typeof EXPORT_FIXTURE_IDS)[number];
export type FixtureRect = {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
export type FixtureTarget = {
  readonly id: string;
  readonly value: string;
  readonly pageIndex: number;
  readonly rectPdf: FixtureRect;
  readonly geometryOnly?: boolean;
  readonly source: "pdf" | "ocr";
};
export type ExportFixture = {
  readonly id: ExportFixtureId;
  readonly sourceKind: "text" | "scanned" | "mixed";
  readonly bytes: Uint8Array;
  readonly pageSizes: ReadonlyArray<{ readonly width: number; readonly height: number }>;
  readonly targets: ReadonlyArray<FixtureTarget>;
  readonly neighborRects: ReadonlyArray<{ readonly text: string; readonly rectPdf: FixtureRect }>;
  readonly neighborsByPage: ReadonlyArray<ReadonlyArray<string>>;
  readonly textLayerTextByPage?: ReadonlyArray<string>;
  readonly rotations: ReadonlyArray<0 | 90 | 180 | 270>;
  readonly formatRules: {
    readonly dpi: number;
    readonly format: "png" | "jpeg";
    readonly jpegQuality: number;
  };
  readonly corpusRevision?: "mixed-eligible-v2-300x125" | "mixed-small-v1-300x56";
  readonly mixedGeometry?: {
    readonly imageRect: FixtureRect;
    readonly sourceStrip: {
      readonly widthPt: number;
      readonly heightPt: number;
      readonly fontFamily: "Helvetica";
      readonly fontSizePt: number;
      readonly text: string;
      readonly xPt: number;
      readonly yPt: number;
    };
  };
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const FONT_SIZE = 18;
const MARGIN = 36;
const LINE_SPACING = 28;
const DNI_VALUES = ["34.567.891", "62.938.475"] as const;
const TARGET_IDS = ["34567891", "62938475", "72938461"] as const;
const NEUTRAL_LINES = Array.from(
  { length: 10 },
  (_unused, index) => `Contenido publico de prueba linea ${String.fromCharCode(65 + index)}`,
);

function drawLine(
  page: PDFPage,
  text: string,
  y: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
): void {
  page.drawText(text, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0, 0, 0) });
}

function identifierRect(
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  prefix: string,
  value: string,
  y: number,
  pageIndex: number,
): FixtureRect {
  const x = MARGIN + font.widthOfTextAtSize(prefix, FONT_SIZE);
  const width = font.widthOfTextAtSize(value, FONT_SIZE);
  return { pageIndex, x: x - 2, y: y - 2, width: width + 4, height: FONT_SIZE + 4 };
}

function lineRect(
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  text: string,
  x: number,
  y: number,
  pageIndex: number,
): FixtureRect {
  return {
    pageIndex,
    x: x - 2,
    y: y - 2,
    width: font.widthOfTextAtSize(text, FONT_SIZE) + 4,
    height: FONT_SIZE + 4,
  };
}

async function buildNativeDocument(): Promise<ExportFixture> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const firstLines = ["INICIO PUBLICO", ...NEUTRAL_LINES.slice(0, 5)];
  firstLines.forEach((line, index) =>
    drawLine(first, line, PAGE_HEIGHT - MARGIN - index * LINE_SPACING, font),
  );
  const target1Y = PAGE_HEIGHT - MARGIN - firstLines.length * LINE_SPACING;
  const target2Y = target1Y - LINE_SPACING;
  drawLine(first, `DNI ${DNI_VALUES[0]}`, target1Y, font);
  drawLine(first, `DNI ${DNI_VALUES[1]}`, target2Y, font);
  [...NEUTRAL_LINES.slice(5), "CIERRE PUBLICO"].forEach((line, index) =>
    drawLine(first, line, target2Y - (index + 1) * LINE_SPACING, font),
  );
  const second = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const secondPageLines = [
    "INICIO PUBLICO",
    "SEGUNDA PAGINA PUBLICA",
    ...NEUTRAL_LINES,
    "CIERRE PUBLICO",
  ];
  secondPageLines.forEach((line, index) =>
    drawLine(second, line, PAGE_HEIGHT - MARGIN - index * LINE_SPACING, font),
  );
  const bytes = await pdf.save();
  return {
    id: "native",
    sourceKind: "text",
    bytes,
    pageSizes: [
      { width: PAGE_WIDTH, height: PAGE_HEIGHT },
      { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    ],
    targets: [
      {
        id: TARGET_IDS[0],
        value: DNI_VALUES[0],
        pageIndex: 0,
        source: "pdf",
        rectPdf: identifierRect(font, "DNI ", DNI_VALUES[0], target1Y, 0),
      },
      {
        id: TARGET_IDS[1],
        value: DNI_VALUES[1],
        pageIndex: 0,
        source: "pdf",
        rectPdf: identifierRect(font, "DNI ", DNI_VALUES[1], target2Y, 0),
      },
    ],
    neighborRects: [
      {
        text: "INICIO PUBLICO",
        rectPdf: lineRect(font, "INICIO PUBLICO", MARGIN, PAGE_HEIGHT - MARGIN, 0),
      },
      {
        text: "CIERRE PUBLICO",
        rectPdf: lineRect(font, "CIERRE PUBLICO", MARGIN, target2Y - 6 * LINE_SPACING, 0),
      },
      {
        text: "INICIO PUBLICO",
        rectPdf: lineRect(font, "INICIO PUBLICO", MARGIN, PAGE_HEIGHT - MARGIN, 1),
      },
      {
        text: "SEGUNDA PAGINA PUBLICA",
        rectPdf: lineRect(
          font,
          "SEGUNDA PAGINA PUBLICA",
          MARGIN,
          PAGE_HEIGHT - MARGIN - LINE_SPACING,
          1,
        ),
      },
      {
        text: "CIERRE PUBLICO",
        rectPdf: lineRect(
          font,
          "CIERRE PUBLICO",
          MARGIN,
          PAGE_HEIGHT - MARGIN - 12 * LINE_SPACING,
          1,
        ),
      },
    ],
    neighborsByPage: [
      ["INICIO PUBLICO", "CIERRE PUBLICO"],
      ["INICIO PUBLICO", "SEGUNDA PAGINA PUBLICA", "CIERRE PUBLICO"],
    ],
    rotations: [0, 0],
    formatRules: { dpi: 150, format: "jpeg", jpegQuality: 0.85 },
  };
}

type MixedFixtureVariant = {
  readonly corpusRevision: NonNullable<ExportFixture["corpusRevision"]>;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly closureDrawY: number;
};

const SMALL_MIXED_VARIANT: MixedFixtureVariant = {
  corpusRevision: "mixed-small-v1-300x56",
  imageX: 40,
  imageY: 248,
  imageWidth: 300,
  imageHeight: 56,
  closureDrawY: 560 - 5 * LINE_SPACING,
};

const ELIGIBLE_MIXED_VARIANT: MixedFixtureVariant = {
  corpusRevision: "mixed-eligible-v2-300x125",
  imageX: 40,
  imageY: 220,
  imageWidth: 300,
  imageHeight: 125,
  closureDrawY: 560 - 6 * LINE_SPACING,
};

async function buildMixedFixtureVariant(
  page: Page,
  variant: MixedFixtureVariant,
): Promise<ExportFixture> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const targetPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const firstY = PAGE_HEIGHT - MARGIN - 5 * LINE_SPACING;
  const firstLines = ["INICIO PUBLICO", ...NEUTRAL_LINES.slice(0, 4)];
  firstLines.forEach((line, index) =>
    drawLine(targetPage, line, PAGE_HEIGHT - MARGIN - index * LINE_SPACING, font),
  );
  drawLine(targetPage, `DNI ${DNI_VALUES[0]}`, firstY, font);
  const sourceStrip = await PDFDocument.create();
  const stripFont = await sourceStrip.embedFont(StandardFonts.Helvetica);
  const stripPage = sourceStrip.addPage([variant.imageWidth, variant.imageHeight]);
  const imageText = `REGION PUBLICA  DNI ${DNI_VALUES[1]}`;
  const imageTextX = 8;
  const imageTextY = 18;
  stripPage.drawText(imageText, {
    x: imageTextX,
    y: imageTextY,
    size: FONT_SIZE,
    font: stripFont,
    color: rgb(0, 0, 0),
  });
  const png = await renderFixturePagePng(page, await sourceStrip.save());
  const image = await pdf.embedPng(png);
  targetPage.drawImage(image, {
    x: variant.imageX,
    y: variant.imageY,
    width: variant.imageWidth,
    height: variant.imageHeight,
  });
  [...NEUTRAL_LINES.slice(4), "CIERRE PUBLICO"].forEach((line, index) =>
    drawLine(targetPage, line, 560 - index * LINE_SPACING, font),
  );
  const bytes = await pdf.save();
  const baseNative = await buildNativeDocument();
  const target2Rect = identifierRect(
    stripFont,
    "REGION PUBLICA  DNI ",
    DNI_VALUES[1],
    imageTextY,
    0,
  );
  const regionNeighborRect = lineRect(
    stripFont,
    "REGION PUBLICA",
    variant.imageX + imageTextX,
    variant.imageY + imageTextY,
    0,
  );
  const textLayerTextByPage = await extractPdfTextLayer(page, bytes);
  return {
    id: "mixed",
    sourceKind: "mixed",
    bytes,
    pageSizes: [{ width: PAGE_WIDTH, height: PAGE_HEIGHT }],
    targets: [
      {
        id: TARGET_IDS[0],
        value: DNI_VALUES[0],
        pageIndex: 0,
        source: "pdf",
        rectPdf: identifierRect(font, "DNI ", DNI_VALUES[0], firstY, 0),
      },
      {
        id: TARGET_IDS[1],
        value: DNI_VALUES[1],
        pageIndex: 0,
        source: "ocr",
        rectPdf: {
          ...target2Rect,
          x: variant.imageX + imageTextX + target2Rect.x - MARGIN,
          y: variant.imageY + imageTextY - 2,
        },
      },
    ],
    neighborRects: [
      {
        text: "INICIO PUBLICO",
        rectPdf: lineRect(font, "INICIO PUBLICO", MARGIN, PAGE_HEIGHT - MARGIN, 0),
      },
      {
        text: "CIERRE PUBLICO",
        rectPdf: lineRect(font, "CIERRE PUBLICO", MARGIN, variant.closureDrawY, 0),
      },
      { text: "REGION PUBLICA", rectPdf: regionNeighborRect },
    ],
    neighborsByPage: [["INICIO PUBLICO", "CIERRE PUBLICO", "REGION PUBLICA"]],
    textLayerTextByPage,
    rotations: [0],
    formatRules: baseNative.formatRules,
    corpusRevision: variant.corpusRevision,
    mixedGeometry: {
      imageRect: {
        pageIndex: 0,
        x: variant.imageX,
        y: variant.imageY,
        width: variant.imageWidth,
        height: variant.imageHeight,
      },
      sourceStrip: {
        widthPt: variant.imageWidth,
        heightPt: variant.imageHeight,
        fontFamily: "Helvetica",
        fontSizePt: FONT_SIZE,
        text: imageText,
        xPt: imageTextX,
        yPt: imageTextY,
      },
    },
  };
}

export async function buildSmallMixedCharacterizationFixture(page: Page): Promise<ExportFixture> {
  return buildMixedFixtureVariant(page, SMALL_MIXED_VARIANT);
}

export async function buildExportFixture(id: ExportFixtureId, page?: Page): Promise<ExportFixture> {
  if (id === "native") return buildNativeDocument();
  if (id === "scan") {
    if (page === undefined)
      throw new Error("El fixture scan requiere el renderer para rasterizar a 288 DPI.");
    const native = await buildNativeDocument();
    const scanned = await rasterizeToScannedPdf(page, native.bytes, 4, 1);
    return {
      ...native,
      id,
      sourceKind: "scanned",
      bytes: scanned.buffer,
      pageSizes: [native.pageSizes[0]!],
      targets: native.targets.filter((target) => target.pageIndex === 0),
      neighborRects: native.neighborRects.filter((neighbor) => neighbor.rectPdf.pageIndex === 0),
      neighborsByPage: [native.neighborsByPage[0]!],
      rotations: [0],
    };
  }
  if (id === "mixed") {
    if (page === undefined)
      throw new Error("El fixture mixed requiere el renderer para rasterizar la región.");
    return buildMixedFixtureVariant(page, ELIGIBLE_MIXED_VARIANT);
  }
  if (id === "stamp") {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const stampY = PAGE_HEIGHT - 20;
    const cause = "72938461";
    const dni = DNI_VALUES[0];
    page.drawText(`SELLO PUBLICO  DNI ${dni}  CAUSA FICTICIA ${cause}`, {
      x: MARGIN,
      y: stampY,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
    const yLines = ["INICIO PUBLICO", ...NEUTRAL_LINES, "CIERRE PUBLICO"];
    yLines.forEach((line, index) =>
      drawLine(page, line, PAGE_HEIGHT - 60 - index * LINE_SPACING, font),
    );
    const prefixWidth = font.widthOfTextAtSize("SELLO PUBLICO  DNI ", FONT_SIZE);
    const rect = identifierRect(font, "", dni, stampY, 0);
    const bytes = await pdf.save();
    const adjustedRect: FixtureRect = { ...rect, x: rect.x + prefixWidth };
    return {
      id,
      sourceKind: "text",
      bytes,
      pageSizes: [{ width: PAGE_WIDTH, height: PAGE_HEIGHT }],
      targets: [
        { id: TARGET_IDS[0], value: dni, pageIndex: 0, source: "pdf", rectPdf: adjustedRect },
        {
          id: TARGET_IDS[2],
          value: cause,
          pageIndex: 0,
          source: "pdf",
          rectPdf: {
            pageIndex: 0,
            x:
              MARGIN +
              prefixWidth +
              font.widthOfTextAtSize(`${dni}  CAUSA FICTICIA `, FONT_SIZE) -
              2,
            y: stampY - 2,
            width: font.widthOfTextAtSize(cause, FONT_SIZE) + 4,
            height: FONT_SIZE + 4,
          },
          geometryOnly: true,
        },
      ],
      neighborRects: [
        { text: "SELLO PUBLICO", rectPdf: lineRect(font, "SELLO PUBLICO", MARGIN, stampY, 0) },
        {
          text: "INICIO PUBLICO",
          rectPdf: lineRect(font, "INICIO PUBLICO", MARGIN, PAGE_HEIGHT - 60, 0),
        },
        {
          text: "CIERRE PUBLICO",
          rectPdf: lineRect(
            font,
            "CIERRE PUBLICO",
            MARGIN,
            PAGE_HEIGHT - 60 - 11 * LINE_SPACING,
            0,
          ),
        },
      ],
      neighborsByPage: [["INICIO PUBLICO", "CIERRE PUBLICO", "SELLO PUBLICO"]],
      rotations: [0],
      formatRules: { dpi: 150, format: "jpeg", jpegQuality: 0.85 },
    };
  }
  throw new Error("Fixture no soportado.");
}

export async function extractPdfTextLayer(
  page: Page,
  pdfBytes: Uint8Array,
): Promise<ReadonlyArray<string>> {
  const [pdfjsSource, workerSource] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../../../node_modules/pdfjs-dist/build/pdf.min.mjs", import.meta.url),
        "utf8",
      ),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
        "utf8",
      ),
    ),
  ]);
  return page.evaluate(
    async ({ pdfjsSource, workerSource, bytesBase64 }) => {
      const pdfjsUrl = URL.createObjectURL(new Blob([pdfjsSource], { type: "text/javascript" }));
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      let pdfDocument: PdfjsModule.PDFDocumentProxy | undefined;
      try {
        const pdfjs = (await import(pdfjsUrl)) as typeof PdfjsModule;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const bytes = Uint8Array.from(atob(bytesBase64), (character) => character.charCodeAt(0));
        pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
        const textByPage: string[] = [];
        for (let index = 0; index < pdfDocument.numPages; index += 1) {
          const textContent = await (await pdfDocument.getPage(index + 1)).getTextContent();
          textByPage.push(
            textContent.items
              .filter((item) => "str" in item)
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
        }
        return textByPage;
      } finally {
        if (pdfDocument !== undefined) await pdfDocument.destroy();
        URL.revokeObjectURL(pdfjsUrl);
        URL.revokeObjectURL(workerUrl);
      }
    },
    { pdfjsSource, workerSource, bytesBase64: Buffer.from(pdfBytes).toString("base64") },
  );
}

export function assertMixedFixtureTextLayer(fixture: ExportFixture): void {
  if (fixture.id !== "mixed") throw new Error("El assert de capa textual requiere fixture mixed.");
  const revision = fixture.corpusRevision;
  const geometry = fixture.mixedGeometry;
  if (revision === undefined || geometry === undefined) {
    throw new Error("El fixture mixed debe declarar revision y geometría de fuente.");
  }
  const expected =
    revision === "mixed-eligible-v2-300x125"
      ? { x: 40, y: 220, width: 300, height: 125, closureDrawY: 392 }
      : revision === "mixed-small-v1-300x56"
        ? { x: 40, y: 248, width: 300, height: 56, closureDrawY: 420 }
        : undefined;
  if (expected === undefined) throw new Error(`Revision mixed no admitida: ${revision}`);
  const { imageRect, sourceStrip } = geometry;
  if (
    imageRect.pageIndex !== 0 ||
    imageRect.x !== expected.x ||
    imageRect.y !== expected.y ||
    imageRect.width !== expected.width ||
    imageRect.height !== expected.height ||
    sourceStrip.widthPt !== expected.width ||
    sourceStrip.heightPt !== expected.height ||
    sourceStrip.fontFamily !== "Helvetica" ||
    sourceStrip.fontSizePt !== FONT_SIZE ||
    sourceStrip.text !== `REGION PUBLICA  DNI ${DNI_VALUES[1]}` ||
    sourceStrip.xPt !== 8 ||
    sourceStrip.yPt !== 18
  ) {
    throw new Error(`Geometría o fuente incorrecta para ${revision}.`);
  }
  const nativeTarget = fixture.targets.find((target) => target.source === "pdf");
  const externalNeighbors = fixture.neighborRects.filter(
    (neighbor) => neighbor.text !== "REGION PUBLICA",
  );
  const overlapsImage = (rect: FixtureRect): boolean =>
    rect.x < imageRect.x + imageRect.width &&
    imageRect.x < rect.x + rect.width &&
    rect.y < imageRect.y + imageRect.height &&
    imageRect.y < rect.y + rect.height;
  if (
    nativeTarget === undefined ||
    overlapsImage(nativeTarget.rectPdf) ||
    externalNeighbors.some((neighbor) => overlapsImage(neighbor.rectPdf))
  ) {
    throw new Error(`La imagen de ${revision} se cruza con texto nativo o vecino externo.`);
  }
  const closure = fixture.neighborRects.find((neighbor) => neighbor.text === "CIERRE PUBLICO");
  if (closure?.rectPdf.y !== expected.closureDrawY - 2) {
    throw new Error(`BBox del cierre incoherente con el descriptor de ${revision}.`);
  }
  const text = fixture.textLayerTextByPage?.join(" ").replaceAll(/\s+/gu, " ") ?? "";
  if (!text.includes(DNI_VALUES[0]) || text.includes(DNI_VALUES[1])) {
    throw new Error(
      `La capa textual mixed debe incluir solo el primer DNI; texto observado: ${text}`,
    );
  }
}

async function renderFixturePagePng(page: Page, sourcePdf: Uint8Array): Promise<Uint8Array> {
  const pdfJs = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../../../node_modules/pdfjs-dist/build/pdf.min.mjs", import.meta.url),
      "utf8",
    ),
  );
  const worker = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      "utf8",
    ),
  );
  const base64 = Buffer.from(sourcePdf).toString("base64");
  const output = await page.evaluate(
    async ({ pdfJsSource, workerSource, sourceBase64 }) => {
      const pdfjsUrl = URL.createObjectURL(new Blob([pdfJsSource], { type: "text/javascript" }));
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      try {
        const pdfjs = (await import(pdfjsUrl)) as typeof PdfjsModule;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const bytes = Uint8Array.from(atob(sourceBase64), (character) => character.charCodeAt(0));
        const pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
        let canvas: HTMLCanvasElement | undefined;
        try {
          const pdfPage = await pdfDocument.getPage(1);
          const viewport = pdfPage.getViewport({ scale: 4 });
          canvas = window.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (context === null) throw new Error("No se pudo crear canvas del fixture.");
          context.fillStyle = "white";
          context.fillRect(0, 0, canvas.width, canvas.height);
          await pdfPage.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
          return canvas.toDataURL("image/png").split(",")[1] ?? "";
        } finally {
          if (canvas !== undefined) {
            canvas.width = 0;
            canvas.height = 0;
          }
          await pdfDocument.destroy();
        }
      } finally {
        URL.revokeObjectURL(pdfjsUrl);
        URL.revokeObjectURL(workerUrl);
      }
    },
    { pdfJsSource: pdfJs, workerSource: worker, sourceBase64: base64 },
  );
  return Buffer.from(output, "base64");
}

export async function addPdfRotation(
  fixture: ExportFixture,
  angle: 90 | 180 | 270,
): Promise<ExportFixture> {
  const pdf = await PDFDocument.load(fixture.bytes);
  for (const page of pdf.getPages()) page.setRotation(degrees(angle));
  return { ...fixture, bytes: await pdf.save(), rotations: fixture.pageSizes.map(() => angle) };
}

export function assertFixtureRules(fixture: ExportFixture): void {
  if (fixture.id === "mixed") {
    if (fixture.corpusRevision !== "mixed-eligible-v2-300x125") {
      throw new Error("El gate mixed debe ejecutar mixed-eligible-v2-300x125.");
    }
    assertMixedFixtureTextLayer(fixture);
  }
  for (const target of fixture.targets) {
    const { x, y, width, height } = target.rectPdf;
    const size = fixture.pageSizes[target.pageIndex];
    if (
      size === undefined ||
      x < 0 ||
      y < 0 ||
      x + width > size.width ||
      y + height > size.height
    ) {
      throw new Error(`La caja de ${target.id} sale de página en ${fixture.id}.`);
    }
    for (const neighbor of fixture.neighborsByPage[target.pageIndex] ?? []) {
      if (neighbor.includes(target.value))
        throw new Error(`Vecino de ${target.id} contiene fragmentos prohibidos.`);
    }
    for (const neighbor of fixture.neighborRects) {
      const other = neighbor.rectPdf;
      if (other.pageIndex !== target.pageIndex) continue;
      if (
        target.rectPdf.x < other.x + other.width &&
        other.x < target.rectPdf.x + target.rectPdf.width &&
        target.rectPdf.y < other.y + other.height &&
        other.y < target.rectPdf.y + target.rectPdf.height
      ) {
        throw new Error(`La caja de ${target.id} invade al vecino ${neighbor.text}.`);
      }
    }
  }
  for (const identifier of TARGET_IDS) {
    const fragments = [identifier.slice(0, 4), identifier.slice(-4)];
    for (const allowed of [
      "INICIO PUBLICO",
      "CIERRE PUBLICO",
      "SEGUNDA PAGINA PUBLICA",
      ...NEUTRAL_LINES,
    ]) {
      if (fragments.some((fragment) => allowed.includes(fragment))) {
        throw new Error(`Texto permitido contiene fragmentos prohibidos: ${allowed}`);
      }
    }
  }
  const knownReplacements = ["", "[DNI 01]", "[DNI 02]", "XX.XXX.XXX", "79.406.215", "85.170.269"];
  for (const identifier of TARGET_IDS) {
    const fragments = [identifier.slice(0, 4), identifier.slice(-4)];
    for (const replacement of knownReplacements) {
      if (fragments.some((fragment) => replacement.includes(fragment))) {
        throw new Error(`Un reemplazo conocido contiene fragmentos prohibidos: ${replacement}`);
      }
    }
  }
}
