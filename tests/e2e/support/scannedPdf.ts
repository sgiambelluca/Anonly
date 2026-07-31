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
  const { pdfjsSource, workerSource, pdfLibSource, sourceBase64, scale } = args;

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

  for (let pageNumber = 1; pageNumber <= sourceDoc.numPages; pageNumber += 1) {
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

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo obtener el contexto 2D del canvas.");

    // Fondo blanco explícito: un `<canvas>` recién creado es transparente, y
    // `page.render()` de pdfjs-dist no rellena fondo — solo dibuja el
    // contenido de la página (texto negro) sobre lo que ya haya. Sin este
    // fill, el PNG exportado (`canvas.toBlob`) queda con texto negro sobre
    // fondo TRANSPARENTE; en cualquier punto del pipeline de OCR que aplane
    // esa transparencia sin asumir blanco (p. ej. una conversión a JPEG, sin
    // canal alfa), el resultado es texto negro sobre negro — invisible para
    // Tesseract. Confirmado empíricamente: sin este fill, el Escenario 2
    // completaba OCR sin errores pero detectaba CERO entidades.
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);

    // pdfjs-dist@4.x tipa `canvas` como parte de `RenderParameters` (además
    // de `canvasContext`) desde v4.something; el genérico `build/pdf.min.mjs`
    // acepta el mismo shape que usa `render-engine` (Core) en su propio
    // `rasterizePage` — mismo patrón, sin necesidad de castear.
    await sourcePage.render({ canvasContext: context, viewport: renderViewport }).promise;

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`canvas.toBlob() falló para la página ${pageNumber}.`));
      }, "image/png");
    });
    const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

    const embeddedImage = await outDoc.embedPng(pngBytes);
    const outPage = outDoc.addPage([nativeViewport.width, nativeViewport.height]);
    outPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: nativeViewport.width,
      height: nativeViewport.height,
    });
  }

  const outBytes = await outDoc.save();
  return bytesToBase64(outBytes);
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
