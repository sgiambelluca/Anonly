/**
 * `scannedPdf.ts` — genera, DENTRO DEL BROWSER, un PDF de solo imágenes (sin
 * capa de texto) a partir de los bytes de un PDF con texto, para el
 * Escenario 2 (`07_Performance_Strategy.md` §11.3, item 2: OCR real).
 *
 * Fuente exacta del método (ADR-048 §2, `tests/fixtures/README.md` fila "2"):
 * "se genera en el browser, dentro del propio spec: `page.evaluate` rasteriza
 * `text-10p.pdf` con el `pdfjs-dist` que la app ya carga + re-arma un PDF de
 * imágenes con pdf-lib". Ni `pdfjs-dist` ni `pdf-lib` son dependencias
 * nuevas: ambos ya están en el `package.json` raíz del workspace.
 *
 * "El `pdfjs-dist` que la app ya carga" no es literalmente inyectable desde
 * afuera: la instancia de la app vive dentro de su propio bundle privado de
 * Vite (`main.tsx` configura `GlobalWorkerOptions.workerSrc` ahí mismo, sin
 * exponer el módulo en `window`) — no hay ningún hook de test expuesto para
 * alcanzarla, y agregar uno sería tocar `apps/react-client/src` fuera del
 * alcance de este PR (`tests/e2e/` y `tests/fixtures/`, ver prompt). Este
 * helper instancia el MISMO paquete/versión (mismo `node_modules`, resuelto
 * desde el workspace raíz) de forma independiente, dentro del propio browser:
 * lee los bundles ESM ya publicados por `pdfjs-dist`/`pdf-lib` desde Node (sin
 * pasar por el dev server de Vite), los inyecta como blob: URLs y los importa
 * dinámicamente. La CSP de la app (`apps/react-client/index.html`) permite
 * esto explícitamente: `script-src 'self' blob: 'wasm-unsafe-eval';
 * worker-src 'self' blob:`.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import type * as PdfLibModule from "pdf-lib";
import type * as PdfjsModule from "pdfjs-dist";

import type { E2eFilePayload } from "./fixtures.js";

// Bundles ESM minificados ya publicados por los paquetes (workspace raíz,
// mismas versiones que consume `apps/react-client`): resueltos por ruta
// relativa a este archivo, no por specifier — `tests/e2e/tsconfig.json` no
// tiene el remapeo de `paths` que sí tiene `tests/tsconfig.json` (ver
// `support/settingsOverride.ts`), pero acá no hace falta: son paquetes npm
// reales bajo `node_modules`, no motores del workspace `@anonly/*-engine`.
const PDFJS_MJS_PATH = fileURLToPath(
  new URL("../../../node_modules/pdfjs-dist/build/pdf.min.mjs", import.meta.url),
);
const PDFJS_WORKER_PATH = fileURLToPath(
  new URL("../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
);
const PDF_LIB_MJS_PATH = fileURLToPath(
  new URL("../../../node_modules/pdf-lib/dist/pdf-lib.esm.min.js", import.meta.url),
);

const DEFAULT_SCALE = 3; // resolución generosa para que Tesseract reconozca el texto de forma confiable.

interface BrowserRasterizeArgs {
  readonly pdfjsSource: string;
  readonly workerSource: string;
  readonly pdfLibSource: string;
  readonly sourceBase64: string;
  readonly scale: number;
  readonly rotations?: ReadonlyArray<0 | 90 | 180 | 270>;
  readonly pageCount?: number;
}

export interface PdfPixelSample {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
}

export interface PdfRegionSample {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfRegionStats {
  readonly sampleCount: number;
  readonly darkFraction: number;
  readonly blackFraction: number;
  readonly meanLuma: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly inkMask: ReadonlyArray<boolean>;
  readonly pageWidthPx: number;
  readonly pageHeightPx: number;
}

/**
 * Cuerpo que corre DENTRO del browser (`page.evaluate`). Los dos `import()`
 * dinámicos de blob: URLs no son estáticamente analizables por TypeScript
 * (el specifier no es un literal): el resultado se tipa `any` por el propio
 * compilador, y el cast a los tipos reales del paquete (`import type`
 * arriba) es un narrowing seguro documentado acá — no hay otra forma de
 * tipar un módulo cargado en runtime desde un blob: URL (`ai/Code_Standards.md`
 * §2, "`as` solo para narrowing seguro documentado"). No es `as unknown as`:
 * el origen (`any`) ya es asignable a cualquier tipo con un solo `as`.
 */
async function rasterizeInBrowser(args: BrowserRasterizeArgs): Promise<string> {
  const { pdfjsSource, workerSource, pdfLibSource, sourceBase64, scale, rotations, pageCount } =
    args;

  function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  const workerBlobUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  const pdfjsBlobUrl = URL.createObjectURL(new Blob([pdfjsSource], { type: "text/javascript" }));
  const pdfLibBlobUrl = URL.createObjectURL(new Blob([pdfLibSource], { type: "text/javascript" }));

  const pdfjsLib = (await import(pdfjsBlobUrl)) as typeof PdfjsModule;
  const pdfLib = (await import(pdfLibBlobUrl)) as typeof PdfLibModule;

  pdfjsLib.GlobalWorkerOptions.workerSrc = workerBlobUrl;

  const sourceDoc = await pdfjsLib.getDocument({ data: base64ToBytes(sourceBase64) }).promise;
  const outDoc = await pdfLib.PDFDocument.create();

  const pagesToRasterize = Math.min(pageCount ?? sourceDoc.numPages, sourceDoc.numPages);
  for (let pageNumber = 1; pageNumber <= pagesToRasterize; pageNumber += 1) {
    const sourcePage = await sourceDoc.getPage(pageNumber);
    // Dos viewports a propósito: `nativeViewport` (scale 1 = 72 DPI) define
    // el tamaño de la página PDF de salida en puntos, igual que la original
    // — `renderViewport` (la escala pedida, más alta) es solo la resolución
    // del bitmap que se dibuja adentro, para que Tesseract tenga píxeles de
    // sobra. Si se usaran los píxeles de `renderViewport` como tamaño de
    // página (puntos), la página resultante sería `scale` veces más grande
    // físicamente que el A4 original.
    const nativeViewport = sourcePage.getViewport({ scale: 1 });
    const renderViewport = sourcePage.getViewport({ scale });

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = Math.ceil(renderViewport.width);
    sourceCanvas.height = Math.ceil(renderViewport.height);
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("No se pudo obtener el contexto 2D del canvas.");

    // Fondo blanco explícito: un `<canvas>` recién creado es transparente, y
    // `page.render()` de pdfjs-dist no rellena fondo — solo dibuja el
    // contenido de la página (texto negro) sobre lo que ya haya. Sin este
    // fill, el PNG exportado (`canvas.toBlob`) queda con texto negro sobre
    // fondo TRANSPARENTE; en cualquier punto del pipeline de OCR que aplane
    // esa transparencia sin asumir blanco (p. ej. una conversión a JPEG, sin
    // canal alfa), el resultado es texto negro sobre negro — invisible para
    // Tesseract. Confirmado empíricamente: sin este fill, el Escenario 2
    // completaba OCR sin errores pero detectaba CERO entidades.
    sourceContext.fillStyle = "white";
    sourceContext.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);

    // pdfjs-dist@4.x tipa `canvas` como parte de `RenderParameters` (además
    // de `canvasContext`) desde v4.something; el genérico `build/pdf.min.mjs`
    // acepta el mismo shape que usa `render-engine` (Core) en su propio
    // `rasterizePage` — mismo patrón, sin necesidad de castear.
    await sourcePage.render({ canvasContext: sourceContext, viewport: renderViewport }).promise;

    const rotation = rotations?.[pageNumber - 1] ?? 0;
    const quarterTurn = rotation === 90 || rotation === 270;
    const canvas = document.createElement("canvas");
    canvas.width = quarterTurn ? sourceCanvas.height : sourceCanvas.width;
    canvas.height = quarterTurn ? sourceCanvas.width : sourceCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo obtener el contexto 2D del canvas girado.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    if (rotation === 90) {
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
    } else if (rotation === 180) {
      context.translate(canvas.width, canvas.height);
      context.rotate(Math.PI);
    } else if (rotation === 270) {
      context.translate(0, canvas.height);
      context.rotate(-Math.PI / 2);
    }
    context.drawImage(sourceCanvas, 0, 0);
    context.restore();

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`canvas.toBlob() falló para la página ${pageNumber}.`));
      }, "image/png");
    });
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

    const embeddedImage = await outDoc.embedPng(pngBytes);
    const outPage = outDoc.addPage(
      quarterTurn
        ? [nativeViewport.height, nativeViewport.width]
        : [nativeViewport.width, nativeViewport.height],
    );
    outPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: quarterTurn ? nativeViewport.height : nativeViewport.width,
      height: quarterTurn ? nativeViewport.width : nativeViewport.height,
    });
  }

  const outBytes = await outDoc.save();
  return bytesToBase64(outBytes);
}

async function samplePixelsInBrowser(args: {
  readonly pdfjsSource: string;
  readonly workerSource: string;
  readonly pdfBytesBase64: string;
  readonly samples: ReadonlyArray<PdfPixelSample>;
}): Promise<ReadonlyArray<readonly [number, number, number, number]>> {
  const pdfjsBlobUrl = URL.createObjectURL(
    new Blob([args.pdfjsSource], { type: "text/javascript" }),
  );
  const workerBlobUrl = URL.createObjectURL(
    new Blob([args.workerSource], { type: "text/javascript" }),
  );
  const pdfjsLib = (await import(pdfjsBlobUrl)) as typeof PdfjsModule;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerBlobUrl;
  const bytes = Uint8Array.from(atob(args.pdfBytesBase64), (char) => char.charCodeAt(0));
  const pdfDocument = await pdfjsLib.getDocument({ data: bytes }).promise;
  const canvases = new Map<number, HTMLCanvasElement>();
  const contexts = new Map<number, CanvasRenderingContext2D>();
  const output: Array<readonly [number, number, number, number]> = [];
  for (const sample of args.samples) {
    let context = contexts.get(sample.pageIndex);
    if (context === undefined) {
      const pdfPage = await pdfDocument.getPage(sample.pageIndex + 1);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const candidate = canvas.getContext("2d");
      if (candidate === null) throw new Error("No se pudo crear canvas para muestreo PDF.");
      await pdfPage.render({ canvasContext: candidate, viewport }).promise;
      canvases.set(sample.pageIndex, canvas);
      contexts.set(sample.pageIndex, candidate);
      context = candidate;
    }
    const pixel = context.getImageData(Math.round(sample.x), Math.round(sample.y), 1, 1).data;
    output.push([pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0, pixel[3] ?? 0]);
  }
  for (const canvas of canvases.values()) canvas.width = 0;
  return output;
}

async function sampleRegionsInBrowser(args: {
  readonly pdfjsSource: string;
  readonly workerSource: string;
  readonly pdfBytesBase64: string;
  readonly regions: ReadonlyArray<PdfRegionSample>;
  readonly scale?: number;
  readonly opaqueMode?: "black" | "white" | undefined;
}): Promise<ReadonlyArray<PdfRegionStats>> {
  const pdfjsBlobUrl = URL.createObjectURL(
    new Blob([args.pdfjsSource], { type: "text/javascript" }),
  );
  const workerBlobUrl = URL.createObjectURL(
    new Blob([args.workerSource], { type: "text/javascript" }),
  );
  const pdfjsLib = (await import(pdfjsBlobUrl)) as typeof PdfjsModule;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerBlobUrl;
  const bytes = Uint8Array.from(atob(args.pdfBytesBase64), (char) => char.charCodeAt(0));
  const pdfDocument = await pdfjsLib.getDocument({ data: bytes }).promise;
  const canvases = new Map<number, HTMLCanvasElement>();
  const contexts = new Map<number, CanvasRenderingContext2D>();
  const output: Array<PdfRegionStats> = [];
  for (const region of args.regions) {
    let context = contexts.get(region.pageIndex);
    if (context === undefined) {
      const pdfPage = await pdfDocument.getPage(region.pageIndex + 1);
      const viewport = pdfPage.getViewport({ scale: args.scale ?? 1 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const candidate = canvas.getContext("2d");
      if (candidate === null) throw new Error("No se pudo crear canvas para región PDF.");
      candidate.fillStyle = "white";
      candidate.fillRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: candidate, viewport }).promise;
      canvases.set(region.pageIndex, canvas);
      contexts.set(region.pageIndex, candidate);
      context = candidate;
    }
    const scale = args.scale ?? 1;
    const x0 = Math.floor(scale * region.x);
    const y0 = Math.floor(scale * region.y);
    const x1 = Math.ceil(scale * (region.x + region.width));
    const y1 = Math.ceil(scale * (region.y + region.height));
    const widthPx = x1 - x0;
    const heightPx = y1 - y0;
    if (
      widthPx <= 0 ||
      heightPx <= 0 ||
      x0 < 0 ||
      y0 < 0 ||
      x1 > context.canvas.width ||
      y1 > context.canvas.height
    )
      throw new Error("Recorte externo vacío o fuera de página.");
    const data = context.getImageData(x0, y0, widthPx, heightPx).data;
    const inkMask: boolean[] = [];
    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = args.opaqueMode === undefined ? (data[offset + 3] ?? 255) / 255 : 1;
      const channel =
        args.opaqueMode === "black" ? 0 : args.opaqueMode === "white" ? 255 : undefined;
      const value =
        (alpha *
          ((channel ?? data[offset] ?? 255) +
            (channel ?? data[offset + 1] ?? 255) +
            (channel ?? data[offset + 2] ?? 255))) /
          3 +
        (1 - alpha) * 255;
      inkMask.push(value < 128);
    }
    let dark = 0;
    let black = 0;
    let luma = 0;
    const columns = 8;
    const rows = 5;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        // Se evita el 15 % exterior para no convertir el antialiasing del
        // borde de una caja en una falsa falta de cobertura.
        const x = scale * (region.x + (0.15 + ((column + 0.5) / columns) * 0.7) * region.width);
        const y = scale * (region.y + (0.15 + ((row + 0.5) / rows) * 0.7) * region.height);
        const pixel = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        const red = pixel[0] ?? 255;
        const green = pixel[1] ?? 255;
        const blue = pixel[2] ?? 255;
        const value = (red + green + blue) / 3;
        luma += value;
        if (value < 220) dark += 1;
        if (red < 80 && green < 80 && blue < 80) black += 1;
      }
    }
    const sampleCount = columns * rows;
    output.push({
      sampleCount,
      darkFraction: dark / sampleCount,
      blackFraction: black / sampleCount,
      meanLuma: luma / sampleCount,
      widthPx,
      heightPx,
      inkMask,
      pageWidthPx: context.canvas.width,
      pageHeightPx: context.canvas.height,
    });
  }
  for (const canvas of canvases.values()) canvas.width = 0;
  return output;
}

/** Muestrea puntos de un PDF dentro del browser para comprobar que una
 * exportación cambió los píxeles de las cajas censuradas. */
export async function samplePdfPixels(
  page: Page,
  pdfBytes: Uint8Array,
  samples: ReadonlyArray<PdfPixelSample>,
): Promise<ReadonlyArray<readonly [number, number, number, number]>> {
  const [pdfjsSource, workerSource] = await Promise.all([
    readFile(PDFJS_MJS_PATH, "utf-8"),
    readFile(PDFJS_WORKER_PATH, "utf-8"),
  ]);
  return page.evaluate(samplePixelsInBrowser, {
    pdfjsSource,
    workerSource,
    pdfBytesBase64: Buffer.from(pdfBytes).toString("base64"),
    samples,
  });
}

/** Muestrea cada rectángulo de un PDF para probar cobertura y conservación. */
export async function samplePdfRegions(
  page: Page,
  pdfBytes: Uint8Array,
  regions: ReadonlyArray<PdfRegionSample>,
): Promise<ReadonlyArray<PdfRegionStats>> {
  const [pdfjsSource, workerSource] = await Promise.all([
    readFile(PDFJS_MJS_PATH, "utf-8"),
    readFile(PDFJS_WORKER_PATH, "utf-8"),
  ]);
  return page.evaluate(sampleRegionsInBrowser, {
    pdfjsSource,
    workerSource,
    pdfBytesBase64: Buffer.from(pdfBytes).toString("base64"),
    regions,
    scale: 1,
  });
}

/** Igual comparador espacial para fuente/exportación, a 144 DPI (ADR-164 §5.1). */
export async function samplePdfRegionsAt144Dpi(
  page: Page,
  pdfBytes: Uint8Array,
  regions: ReadonlyArray<PdfRegionSample>,
  opaqueMode?: "black" | "white",
): Promise<ReadonlyArray<PdfRegionStats>> {
  const [pdfjsSource, workerSource] = await Promise.all([
    readFile(PDFJS_MJS_PATH, "utf-8"),
    readFile(PDFJS_WORKER_PATH, "utf-8"),
  ]);
  return page.evaluate(sampleRegionsInBrowser, {
    pdfjsSource,
    workerSource,
    pdfBytesBase64: Buffer.from(pdfBytes).toString("base64"),
    regions,
    scale: 2,
    opaqueMode,
  });
}

/**
 * Rasteriza `sourcePdfBytes` (un PDF con texto) a un PDF de solo imágenes,
 * sin capa de texto extraíble — el fixture del Escenario 2. Todo el trabajo
 * pesado corre en el `page` (browser real), no en Node.
 */
export async function rasterizeToScannedPdf(
  page: Page,
  sourcePdfBytes: Uint8Array,
  scale: number = DEFAULT_SCALE,
): Promise<E2eFilePayload> {
  const [pdfjsSource, workerSource, pdfLibSource] = await Promise.all([
    readFile(PDFJS_MJS_PATH, "utf-8"),
    readFile(PDFJS_WORKER_PATH, "utf-8"),
    readFile(PDF_LIB_MJS_PATH, "utf-8"),
  ]);

  const sourceBase64 = Buffer.from(sourcePdfBytes).toString("base64");

  const resultBase64 = await page.evaluate(rasterizeInBrowser, {
    pdfjsSource,
    workerSource,
    pdfLibSource,
    sourceBase64,
    scale,
  });

  return {
    name: "scanned-10p.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(resultBase64, "base64"),
  };
}

/** Fixture de aceptación T-5: giros físicos intercalados en los PNG, sin
 * depender de `/Rotate` en el PDF. */
export async function rasterizePixelRotationsToScannedPdf(
  page: Page,
  sourcePdfBytes: Uint8Array,
  rotations: ReadonlyArray<0 | 90 | 180 | 270>,
  scale: number = DEFAULT_SCALE,
): Promise<E2eFilePayload> {
  const [pdfjsSource, workerSource, pdfLibSource] = await Promise.all([
    readFile(PDFJS_MJS_PATH, "utf-8"),
    readFile(PDFJS_WORKER_PATH, "utf-8"),
    readFile(PDF_LIB_MJS_PATH, "utf-8"),
  ]);
  const resultBase64 = await page.evaluate(rasterizeInBrowser, {
    pdfjsSource,
    workerSource,
    pdfLibSource,
    sourceBase64: Buffer.from(sourcePdfBytes).toString("base64"),
    scale,
    rotations,
    pageCount: rotations.length,
  });
  return {
    name: "t5-orientation-pixel.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(resultBase64, "base64"),
  };
}
