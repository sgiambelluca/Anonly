import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const PDFJS_PATH = fileURLToPath(
  new URL("../../../node_modules/pdfjs-dist/build/pdf.min.mjs", import.meta.url),
);
const PDFJS_WORKER_PATH = fileURLToPath(
  new URL("../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
);

export interface PdfFidelityPage {
  readonly pageNumber: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly sourceMarkerPresent: boolean;
  readonly sourceNeighborPresent: boolean;
  readonly sourceMarkerDarkPixels: number;
  readonly sourceNeighborDarkPixels: number;
  readonly outputMarkerDarkPixels: number;
  readonly outputNeighborDarkPixels: number;
  readonly markerInkRatio: number | null;
  readonly neighborInkRatio: number | null;
  readonly rendered: boolean;
}

export interface PdfFidelityResult {
  readonly valid: boolean;
  readonly pageCount: number;
  readonly pages: ReadonlyArray<PdfFidelityPage>;
  readonly failures: ReadonlyArray<string>;
  readonly method: "pdfjs-dist-render-scale-1-source-text-and-output-roi-comparison";
  readonly tolerancePt: 1;
}

export async function validateExportPdf(
  sourcePdfBytes: Uint8Array,
  pdfBytes: Uint8Array,
  expectedPageCount: number,
  profile: "C0" | "H1" | "H2",
): Promise<PdfFidelityResult> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    const pdfjsSource = await readFile(PDFJS_PATH, "utf8");
    const workerSource = await readFile(PDFJS_WORKER_PATH, "utf8");
    const sourceBase64 = Buffer.from(sourcePdfBytes).toString("base64");
    const base64 = Buffer.from(pdfBytes).toString("base64");
    const urls = await page.evaluate(
      ({ source, worker }) => ({
        moduleUrl: URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
        workerUrl: URL.createObjectURL(new Blob([worker], { type: "text/javascript" })),
      }),
      { source: pdfjsSource, worker: workerSource },
    );
    await page.addScriptTag({
      type: "module",
      content: `const lib = await import(${JSON.stringify(urls.moduleUrl)}); lib.GlobalWorkerOptions.workerSrc = ${JSON.stringify(urls.workerUrl)}; window.__heavyPdfJs = lib;`,
    });
    await page.waitForFunction(
      () => (window as unknown as { __heavyPdfJs?: unknown }).__heavyPdfJs !== undefined,
      { timeout: 30_000 },
    );
    const inspected = await page.evaluate(
      async ({
        base64: encoded,
        sourceEncoded,
        profile: profileName,
        expectedControlText,
        expectedNeighborText,
      }) => {
        type PdfPage = {
          getViewport(args: { scale: number }): { width: number; height: number };
          render(args: {
            canvasContext: CanvasRenderingContext2D;
            viewport: { width: number; height: number };
          }): { promise: Promise<void> };
          getTextContent(): Promise<{ items: ReadonlyArray<{ str?: string }> }>;
        };
        const pdfjs = (
          window as unknown as {
            __heavyPdfJs: {
              getDocument(args: { data: Uint8Array }): {
                promise: Promise<{ numPages: number; getPage(page: number): Promise<PdfPage> }>;
              };
            };
          }
        ).__heavyPdfJs;
        const sourceBytes = Uint8Array.from(atob(sourceEncoded), (character) =>
          character.charCodeAt(0),
        );
        const sourceDocument = await pdfjs.getDocument({ data: sourceBytes }).promise;
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        const document = await pdfjs.getDocument({ data: bytes }).promise;
        const pages: Array<{
          pageNumber: number;
          widthPt: number;
          heightPt: number;
          sourceMarkerPresent: boolean;
          sourceNeighborPresent: boolean;
          sourceMarkerDarkPixels: number;
          sourceNeighborDarkPixels: number;
          outputMarkerDarkPixels: number;
          outputNeighborDarkPixels: number;
          markerInkRatio: number | null;
          neighborInkRatio: number | null;
          rendered: boolean;
        }> = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const pdfPage = await document.getPage(pageNumber);
          const viewport = pdfPage.getViewport({ scale: 1 });
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context === null) throw new Error("No se pudo crear canvas de validación");
          await pdfPage.render({ canvasContext: context, viewport }).promise;
          const sourcePage = await sourceDocument.getPage(pageNumber);
          const sourceViewport = sourcePage.getViewport({ scale: 1 });
          const sourceCanvas = window.document.createElement("canvas");
          sourceCanvas.width = Math.ceil(sourceViewport.width);
          sourceCanvas.height = Math.ceil(sourceViewport.height);
          const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
          if (sourceContext === null) throw new Error("No se pudo crear canvas de fuente");
          await sourcePage.render({ canvasContext: sourceContext, viewport: sourceViewport })
            .promise;
          const sourceText = (await sourcePage.getTextContent()).items
            .map((item: { str?: string }) => item.str ?? "")
            .join(" ");
          const sourceMarker =
            profileName === "C0"
              ? (expectedControlText[pageNumber - 1] ?? "")
              : `MARCA SINTETICA PAGINA ${pageNumber}`;
          const sourceNeighbor =
            profileName === "C0"
              ? (expectedNeighborText[pageNumber - 1] ?? "")
              : `informe ficticio ${pageNumber}`;
          const countDarkPixels = (data: Uint8ClampedArray): number => {
            let count = 0;
            for (let offset = 0; offset < data.length; offset += 4) {
              if (
                (data[offset] ?? 255) < 220 &&
                (data[offset + 1] ?? 255) < 220 &&
                (data[offset + 2] ?? 255) < 220
              )
                count += 1;
            }
            return count;
          };
          const countRegionDarkPixels = (
            target: CanvasRenderingContext2D,
            region: readonly [number, number, number, number],
          ): number =>
            countDarkPixels(target.getImageData(region[0], region[1], region[2], region[3]).data);
          const markerRegion =
            profileName === "C0"
              ? ([0, 0, canvas.width, canvas.height] as const)
              : ([24, canvas.height - 75, canvas.width - 48, 20] as const);
          const neighborRegion =
            profileName === "C0"
              ? markerRegion
              : ([24, canvas.height - 53, canvas.width - 48, 20] as const);
          const sourceMarkerRegion =
            profileName === "C0"
              ? ([0, 0, sourceCanvas.width, sourceCanvas.height] as const)
              : ([24, sourceCanvas.height - 75, sourceCanvas.width - 48, 20] as const);
          const sourceNeighborRegion =
            profileName === "C0"
              ? sourceMarkerRegion
              : ([24, sourceCanvas.height - 53, sourceCanvas.width - 48, 20] as const);
          const sourceMarkerDarkPixels = countRegionDarkPixels(sourceContext, sourceMarkerRegion);
          const sourceNeighborDarkPixels = countRegionDarkPixels(
            sourceContext,
            sourceNeighborRegion,
          );
          const outputMarkerDarkPixels = countRegionDarkPixels(context, markerRegion);
          const outputNeighborDarkPixels = countRegionDarkPixels(context, neighborRegion);
          pages.push({
            pageNumber,
            widthPt: viewport.width,
            heightPt: viewport.height,
            sourceMarkerPresent: sourceText.includes(sourceMarker),
            sourceNeighborPresent: sourceText
              .toLocaleLowerCase()
              .includes(sourceNeighbor.toLocaleLowerCase()),
            sourceMarkerDarkPixels,
            sourceNeighborDarkPixels,
            outputMarkerDarkPixels,
            outputNeighborDarkPixels,
            markerInkRatio:
              sourceMarkerDarkPixels === 0 ? null : outputMarkerDarkPixels / sourceMarkerDarkPixels,
            neighborInkRatio:
              sourceNeighborDarkPixels === 0
                ? null
                : outputNeighborDarkPixels / sourceNeighborDarkPixels,
            rendered: canvas.width > 0 && canvas.height > 0,
          });
          canvas.width = 0;
          canvas.height = 0;
          sourceCanvas.width = 0;
          sourceCanvas.height = 0;
        }
        return { pageCount: document.numPages, pages };
      },
      {
        base64,
        sourceEncoded: sourceBase64,
        profile,
        expectedControlText: [
          "Juan Pérez",
          "María Gómez",
          "Carlos López",
          ...Array.from({ length: 7 }, (_, index) => `Página ${index + 4}`),
        ],
        expectedNeighborText: [
          "Belgrano 1234",
          "Rivadavia 455",
          "ES00 1234",
          ...Array.from({ length: 7 }, () => "sin datos sensibles"),
        ],
      },
    );
    const failures: string[] = [];
    if (inspected.pageCount !== expectedPageCount)
      failures.push(`page-count:${inspected.pageCount}/${expectedPageCount}`);
    inspected.pages.forEach((result, index) => {
      if (!result.rendered) failures.push(`page-${index + 1}:render-failed`);
      if (Math.abs(result.widthPt - 595) > 1 || Math.abs(result.heightPt - 842) > 1) {
        failures.push(`page-${index + 1}:dimensions:${result.widthPt}x${result.heightPt}`);
      }
      if (!result.sourceMarkerPresent) failures.push(`page-${index + 1}:source-marker-missing`);
      if (!result.sourceNeighborPresent) failures.push(`page-${index + 1}:source-neighbor-missing`);
      if (result.outputMarkerDarkPixels < 20)
        failures.push(`page-${index + 1}:output-marker-region-not-visually-legible`);
      if (result.outputNeighborDarkPixels < 10)
        failures.push(`page-${index + 1}:output-neighbor-region-not-visually-legible`);
      if (
        result.markerInkRatio === null ||
        result.markerInkRatio < 0.35 ||
        result.markerInkRatio > 4
      )
        failures.push(`page-${index + 1}:marker-ink-differs-from-source:${result.markerInkRatio}`);
      if (
        result.neighborInkRatio === null ||
        result.neighborInkRatio < 0.35 ||
        result.neighborInkRatio > 4
      )
        failures.push(
          `page-${index + 1}:neighbor-ink-differs-from-source:${result.neighborInkRatio}`,
        );
    });
    return {
      valid: failures.length === 0,
      pageCount: inspected.pageCount,
      pages: inspected.pages,
      failures,
      method: "pdfjs-dist-render-scale-1-source-text-and-output-roi-comparison",
      tolerancePt: 1,
    };
  } finally {
    await browser.close();
  }
}
