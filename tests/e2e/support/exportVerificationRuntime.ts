import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import type { ExportFixture, FixtureTarget } from "./exportVerificationFixtures.js";
import { convertPdfRectsToRegions } from "./scannedPdf.js";

export type GeometryExportOptions = {
  readonly mode: "redact" | "placeholder" | "mask" | "synthetic";
  readonly dpi: number;
  readonly imageFormat: "jpeg" | "png";
  readonly jpegQuality: number;
};

type GeometryRuntimeOptions = GeometryExportOptions & {
  readonly documentId: string;
  readonly pdfBase64: string;
  readonly pageSizes: ExportFixture["pageSizes"];
  readonly sourceKind: ExportFixture["sourceKind"];
  readonly targets: ExportFixture["targets"];
  readonly presentedTargets: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
};

export async function exportThroughRealEngines(
  page: Page,
  fixture: ExportFixture,
  options: GeometryExportOptions,
): Promise<Buffer> {
  const presentedTargets = await convertPdfRectsToRegions(
    page,
    fixture.bytes,
    fixture.targets.map((target) => ({
      pageIndex: target.pageIndex,
      x0: target.rectPdf.x,
      y0: target.rectPdf.y,
      x1: target.rectPdf.x + target.rectPdf.width,
      y1: target.rectPdf.y + target.rectPdf.height,
    })),
  );
  const args: GeometryRuntimeOptions = {
    ...options,
    documentId: `adr148-${fixture.id}-${randomUUID()}`,
    pdfBase64: Buffer.from(fixture.bytes).toString("base64"),
    pageSizes: fixture.pageSizes,
    sourceKind: fixture.sourceKind,
    targets: fixture.targets,
    presentedTargets,
  };
  const output = await page.evaluate(async (input) => {
    type Box = {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    type Target = {
      readonly id: string;
      readonly value: string;
      readonly pageIndex: number;
      readonly rectPdf: Box;
      readonly source: "pdf" | "ocr";
      readonly geometryOnly?: boolean;
    };
    type EngineContext = { readonly abortSignal: AbortSignal };
    type RuntimeEngine = {
      readonly ctx?: EngineContext;
      loadDocument?(documentId: string, bytes: ArrayBuffer): Promise<void>;
      unloadDocument?(documentId: string): Promise<void>;
      renderPage?(
        request: {
          readonly documentId: string;
          readonly pageIndex: number;
          readonly kind: "anonymized";
          readonly mode: "full";
          readonly replacements: ReadonlyArray<{
            readonly groupId: string;
            readonly occurrenceId: string;
            readonly pageIndex: number;
            readonly bbox: Box;
            readonly originalValue: string;
            readonly replacementValue: string;
            readonly mode: string;
          }>;
          readonly scale: number;
          readonly imageFormat: "jpeg" | "png";
        },
        context: EngineContext,
      ): Promise<{
        readonly encoded?: {
          readonly bytes: ArrayBuffer;
          readonly widthPx: number;
          readonly heightPx: number;
        };
      }>;
      export?(
        request: {
          readonly documentId: string;
          readonly document: {
            readonly id: string;
            readonly name: string;
            readonly pageCount: number;
            readonly pages: ReadonlyArray<{
              readonly index: number;
              readonly width: number;
              readonly height: number;
              readonly words: ReadonlyArray<never>;
              readonly text: string;
              readonly requiresOCR: boolean;
              readonly ocrCompleted: boolean;
            }>;
            readonly metadata: {
              readonly pdfVersion: string;
              readonly encrypted: boolean;
              readonly hasForms: boolean;
            };
            readonly sourceKind: "text" | "scanned" | "mixed";
            readonly importedAt: number;
          };
          readonly groups: ReadonlyArray<{
            readonly id: string;
            readonly type: "DNI";
            readonly canonicalValue: string;
            readonly members: ReadonlyArray<{
              readonly occurrenceId: string;
              readonly value: string;
              readonly pageIndex: number;
              readonly bbox: Box;
              readonly source: "pdf" | "ocr";
            }>;
            readonly replacementMode: string;
            readonly replacementValue: string;
            readonly indexInType: number;
            readonly enabled: boolean;
            readonly aliases: ReadonlyArray<string>;
            readonly replacementValueUserSet: boolean;
            readonly needsReview: boolean;
            readonly replacementPreviews: {
              readonly placeholder: string;
              readonly mask: string;
              readonly synthetic: string;
              readonly placeholderLadder: ReadonlyArray<string>;
            };
            readonly createdAt: number;
            readonly updatedAt: number;
          }>;
          readonly rules: ReadonlyArray<never>;
          readonly options: {
            readonly imageFormat: "jpeg" | "png";
            readonly jpegQuality: number;
            readonly dpi: number;
            readonly includeOriginalMetadata: false;
            readonly filename: string;
            readonly includeMarkerLegend: false;
          };
          readonly renderPageProvider: {
            renderFull(
              pageIndex: number,
              replacements: ReadonlyArray<{
                readonly groupId: string;
                readonly occurrenceId: string;
                readonly pageIndex: number;
                readonly bbox: Box;
                readonly originalValue: string;
                readonly replacementValue: string;
                readonly mode: string;
              }>,
              signal: AbortSignal,
            ): Promise<{
              readonly bytes: ArrayBuffer;
              readonly format: "jpeg" | "png";
              readonly widthPx: number;
              readonly heightPx: number;
            }>;
            renderLegend(): Promise<never>;
          };
        },
        context: EngineContext,
      ): Promise<{ readonly buffer: ArrayBuffer }>;
    };
    type Core = {
      readonly bus: {
        on(channel: string, event: string, callback: (payload: unknown) => void): () => void;
      };
      readonly engines: { readonly render: RuntimeEngine; readonly export: RuntimeEngine };
    };
    const core = (window as typeof window & { __anonlyCore?: Core }).__anonlyCore;
    if (core === undefined) throw new Error("__anonlyCore no está disponible.");
    const render = core.engines.render;
    const exporter = core.engines.export;
    const renderContext = render.ctx;
    const exportContext = exporter.ctx;
    if (
      renderContext === undefined ||
      exportContext === undefined ||
      render.loadDocument === undefined ||
      render.renderPage === undefined ||
      exporter.export === undefined ||
      render.unloadDocument === undefined
    ) {
      throw new Error("Los motores reales no exponen el contexto o las operaciones requeridas.");
    }
    const inputBytes = Uint8Array.from(atob(input.pdfBase64), (character) =>
      character.charCodeAt(0),
    );
    const sourceBuffer = inputBytes.buffer.slice(
      inputBytes.byteOffset,
      inputBytes.byteOffset + inputBytes.byteLength,
    );
    const abort = new AbortController();
    let emittedBlobUrl: string | undefined;
    const unlisten = core.bus.on("export", "EXPORT_FINISHED", (payload) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "blobUrl" in payload &&
        typeof payload.blobUrl === "string"
      )
        emittedBlobUrl = payload.blobUrl;
    });
    let documentLoaded = false;
    try {
      await render.loadDocument(input.documentId, sourceBuffer);
      documentLoaded = true;
      const targets = input.targets.map((target: Target, index) => ({
        ...target,
        rectPresented: input.presentedTargets[index],
      }));
      const documentPages = input.pageSizes.map((size, index) => ({
        index,
        width: size.width,
        height: size.height,
        words: [] as never[],
        text: "",
        requiresOCR: false,
        ocrCompleted: false,
      }));
      const groups = targets.map((target, index) => ({
        id: `adr148-${target.id}`,
        type: "DNI" as const,
        canonicalValue: target.value,
        members: [
          {
            occurrenceId: `occ-${target.id}`,
            value: target.value,
            pageIndex: target.pageIndex,
            bbox: target.rectPresented!,
            source: target.source,
          },
        ],
        replacementMode: target.geometryOnly ? "redact" : input.mode,
        replacementValue:
          target.geometryOnly || input.mode === "redact"
            ? ""
            : input.mode === "placeholder"
              ? `[DNI ${String(index + 1).padStart(2, "0")}]`
              : input.mode === "mask"
                ? "XX.XXX.XXX"
                : index === 0
                  ? "79.406.215"
                  : "85.170.269",
        indexInType: index + 1,
        enabled: true,
        aliases: [],
        replacementValueUserSet: false,
        needsReview: false,
        replacementPreviews: {
          placeholder: `[DNI ${String(index + 1).padStart(2, "0")}]`,
          mask: "XX.XXX.XXX",
          synthetic: index === 0 ? "79.406.215" : "85.170.269",
          placeholderLadder: [`[DNI ${String(index + 1).padStart(2, "0")}]`],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
      const document = {
        id: input.documentId,
        name: `${input.documentId}.pdf`,
        pageCount: documentPages.length,
        pages: documentPages,
        metadata: { pdfVersion: "1.7", encrypted: false, hasForms: false },
        sourceKind: input.sourceKind,
        importedAt: Date.now(),
      };
      const output = await exporter.export(
        {
          documentId: input.documentId,
          document,
          groups,
          rules: [],
          options: {
            imageFormat: input.imageFormat,
            jpegQuality: input.jpegQuality,
            dpi: input.dpi,
            includeOriginalMetadata: false,
            filename: `${input.documentId}.pdf`,
            includeMarkerLegend: false,
          },
          renderPageProvider: {
            renderFull: async (pageIndex, replacements, signal) => {
              if (signal.aborted) throw new Error("Render cancelado.");
              const rendered = await render.renderPage!(
                {
                  documentId: input.documentId,
                  pageIndex,
                  kind: "anonymized",
                  mode: "full",
                  replacements,
                  scale: input.dpi / 72,
                  imageFormat: input.imageFormat,
                },
                { ...renderContext, abortSignal: signal },
              );
              if (rendered.encoded === undefined)
                throw new Error(
                  `RenderPage no devolvió bytes codificados para página ${pageIndex + 1}.`,
                );
              return { ...rendered.encoded, format: input.imageFormat };
            },
            renderLegend: async () => {
              throw new Error("La leyenda está desactivada en este gate.");
            },
          },
        },
        { ...exportContext, abortSignal: abort.signal },
      );
      let binary = "";
      for (const byte of new Uint8Array(output.buffer)) binary += String.fromCharCode(byte);
      return btoa(binary);
    } finally {
      unlisten();
      if (emittedBlobUrl !== undefined) URL.revokeObjectURL(emittedBlobUrl);
      abort.abort();
      if (documentLoaded) await render.unloadDocument(input.documentId);
    }
  }, args);
  return Buffer.from(output, "base64");
}

export function fixtureTargetIdentifiers(
  targets: ReadonlyArray<FixtureTarget>,
  includeGeometryOnly = false,
): ReadonlyArray<string> {
  return targets
    .filter((target) => includeGeometryOnly || !target.geometryOnly)
    .map((target) => target.value.replaceAll(/[^0-9]/gu, ""));
}
