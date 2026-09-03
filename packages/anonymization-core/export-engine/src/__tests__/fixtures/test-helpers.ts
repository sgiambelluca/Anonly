/**
 * Mocks y builders compartidos por los tests de @anonly/export-engine.
 *
 * `vi.mock("pdf-lib", ...)` NO vive acá: por el hoisting de Vitest, cada
 * archivo de test debe declarar su propio `vi.mock` en su propio módulo
 * (mismo motivo documentado en render-engine/src/__tests__/fixtures/test-helpers.ts
 * y pdf-engine/src/__tests__/fixtures/test-helpers.ts). Este archivo solo
 * unifica los helpers de construcción de mocks (Code_Standards.md §10;
 * ADR-021 §5; precedente: `mockGetDocumentResult` en pdf-engine/render-engine).
 *
 * Los tests security/* usan `pdf-lib` REAL (no este mock) — ver
 * tests/security/security.test.ts.
 */
import { DetectionSource, EntityType, ReplacementMode, type Document, type DocumentMetadata, type EntityGroup, type ExportOptions, type MarkerLegendRow, type Page, type Replacement } from "@anonly/shared";
import type { EngineConfig, EngineContext } from "@anonly/shared";
import { createEngineContext as sharedCreateEngineContext, createMockConfig as sharedCreateMockConfig } from "@anonly/test-utils";
import type { PDFDocument } from "pdf-lib";
import { vi } from "vitest";


import type { EncodedPageImage, ExportEngineInput, RenderPageProvider } from "../../export.types.js";


/*
 * ADR-129: los dobles genéricos viven en `@anonly/test-utils`. Se re-exportan
 * acá para que cada suite siga importando de un solo lugar.
 */
export {
  createMockBus,
  createMockCache,
  createMockLogger,
} from "@anonly/test-utils";

// ─── Cast de frontera pdf-lib (Code_Standards.md §10) ───

export interface MockPdfPage {
  readonly width: number;
  readonly height: number;
  readonly drawImage: ReturnType<typeof vi.fn>;
}

export interface MockPdfLibDocumentOptions {
  readonly saveBytes?: Uint8Array;
  readonly saveError?: Error;
  /** Cuántos intentos de save() fallan antes de resolver (0 = nunca falla). */
  readonly saveFailTimes?: number;
  readonly embedError?: Error;
  /** Cuántos intentos de embedJpg/embedPng fallan antes de resolver (0 = nunca falla). */
  readonly embedFailTimes?: number;
  readonly drawImageError?: Error;
  /** Cuántos intentos de drawImage fallan (lanzan síncrono) antes de resolver (0 = nunca falla). */
  readonly drawImageFailTimes?: number;
}

const PDF_HEADER_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const MOCK_SAVE_BASE_OVERHEAD = 200;

/**
 * Mock estructural de `PDFDocument` (pdf-lib). Expone `pages` para que los
 * tests inspeccionen qué se dibujó, sin castear por su cuenta — solo
 * `asPdfDocument` cruza la frontera de tipos.
 *
 * `save()` (sin `saveBytes` explícito) devuelve un buffer cuyo tamaño es
 * `overhead + suma(bytes embebidos)`: permite que los tests de tamaño (DPI
 * 300 vs 150, PNG vs JPEG — spec §14) controlen el tamaño de
 * `EncodedPageImage.bytes` que entregan vía el `RenderPageProvider` mockeado
 * y observen que `ExportEngineOutput.sizeBytes` escala en consecuencia, sin
 * depender de un códec de imagen real (fuera de alcance de Export: el
 * tamaño real de una imagen a 300 vs 150 DPI lo determina el
 * `RenderPageProvider`, no este motor — Export solo empaqueta los bytes que
 * recibe).
 *
 * Métodos extra (`addJavaScript`, `getForm`, `copyPages`, `embedPdf`,
 * `attach`) son spies sin comportamiento: `export.engine.ts` nunca los llama
 * (checklist §15.10, spec §13 casos 8-10); los tests unit los usan para
 * verificarlo explícitamente.
 */
export function createMockPdfLibDocument(options?: MockPdfLibDocumentOptions): Record<string, unknown> {
  const pages: MockPdfPage[] = [];
  let saveAttempts = 0;
  let embedAttempts = 0;
  let embeddedBytesTotal = 0;
  let drawImageAttempts = 0;
  const saveFailTimes = options?.saveFailTimes ?? 0;
  const embedFailTimes = options?.embedFailTimes ?? 0;
  const drawImageFailTimes = options?.drawImageFailTimes ?? 0;

  function embed(bytes: ArrayBuffer | Uint8Array | string): Promise<{ width: number; height: number }> {
    embedAttempts++;
    if (embedAttempts <= embedFailTimes) {
      return Promise.reject(options?.embedError ?? new Error("embed failed"));
    }
    embeddedBytesTotal += typeof bytes === "string" ? bytes.length : bytes.byteLength;
    return Promise.resolve({ width: 100, height: 100 });
  }

  return {
    addPage: vi.fn((size: [number, number]) => {
      const page: MockPdfPage = {
        width: size[0],
        height: size[1],
        drawImage: vi.fn(() => {
          drawImageAttempts++;
          if (drawImageAttempts <= drawImageFailTimes) {
            throw options?.drawImageError ?? new Error("drawImage failed");
          }
        }),
      };
      pages.push(page);
      return page;
    }),
    removePage: vi.fn((index: number) => {
      pages.splice(index, 1);
    }),
    getPageCount: vi.fn(() => pages.length),
    embedJpg: vi.fn((bytes: ArrayBuffer | Uint8Array | string) => embed(bytes)),
    embedPng: vi.fn((bytes: ArrayBuffer | Uint8Array | string) => embed(bytes)),
    addJavaScript: vi.fn(),
    getForm: vi.fn(),
    copyPages: vi.fn(),
    embedPdf: vi.fn(),
    attach: vi.fn(),
    setProducer: vi.fn(),
    setCreator: vi.fn(),
    setCreationDate: vi.fn(),
    setTitle: vi.fn(),
    save: vi.fn(() => {
      saveAttempts++;
      if (saveAttempts <= saveFailTimes) {
        return Promise.reject(options?.saveError ?? new Error("save failed"));
      }
      if (options?.saveBytes) return Promise.resolve(options.saveBytes);
      const result = new Uint8Array(PDF_HEADER_BYTES.length + MOCK_SAVE_BASE_OVERHEAD + embeddedBytesTotal);
      result.set(PDF_HEADER_BYTES, 0);
      return Promise.resolve(result);
    }),
    pages,
  };
}

/**
 * Cast de frontera contra pdf-lib — permitido solo en este helper
 * (Code_Standards.md §10; precedente `mockGetDocumentResult`/`asLoadingTask`
 * en render-engine/pdf-engine): `PDFDocument` es una clase con decenas de
 * miembros que un mock estructural no puede satisfacer honestamente. Los
 * tests construyen el mock vía `createMockPdfLibDocument` y nunca castean
 * por su cuenta.
 */
export function asPdfDocument(doc: Record<string, unknown>): PDFDocument {
  return doc as unknown as PDFDocument;
}

// ─── Puerto interno ExportJobPool (ADR-047 §2) — fake estructural para tests ───

export interface ExportPoolDispatchParams<T> {
  readonly run: () => Promise<T>;
  readonly signal: AbortSignal;
  readonly priority?: number;
  readonly payload?: unknown;
  readonly maxRetriesOverride?: number;
}

export interface ExportDispatchCall {
  readonly payload: unknown;
  readonly maxRetriesOverride: number | undefined;
}

export interface TrackingExportPool {
  readonly dispatch: <T>(params: ExportPoolDispatchParams<T>) => Promise<T>;
  readonly calls: ExportDispatchCall[];
}

/**
 * Pool estructural mínima (ADR-047 §2, espejo de `TrackingOcrPool`/
 * `TrackingNerPool`) que registra cada dispatch y delega en `params.run()` —
 * usada por los tests que necesitan inspeccionar los parámetros de despacho
 * (`maxRetriesOverride`, `payload`) sin depender de un `WorkerPool` real.
 * `ExportJobPool` no se exporta desde `export.engine.ts` (detalle de wiring
 * interno, mismo criterio que `OcrJobPool`/`NerJobPool`); esta interfaz
 * estructuralmente compatible alcanza sin importarlo — TypeScript acepta
 * pasar esta pool a `new ExportEngine(pool)` por duck typing.
 */
export function createTrackingExportPool(): TrackingExportPool {
  const calls: ExportDispatchCall[] = [];
  return {
    calls,
    dispatch: <T>(params: ExportPoolDispatchParams<T>): Promise<T> => {
      calls.push({ payload: params.payload, maxRetriesOverride: params.maxRetriesOverride });
      return params.run();
    },
  };
}

/**
 * Pool estructural que **ignora `params.run()`** y resuelve directo con
 * `resolvedValue` (ADR-055 §5 / Code_Standards.md §7 "Test obligatorio por
 * motor"): a diferencia de `createTrackingExportPool` (arriba), que delega en
 * `run()` —el camino in-process— y por lo tanto **nunca cruza el sobre**
 * `COMPLETED.result`, este es el único fake de este paquete que reproduce lo
 * que un `ExportJobPool` real resolvería tras un `postMessage`. Mismo
 * precedente que `createResolvedOcrPool` (ocr-engine, D1) /
 * `createResolvedRenderDispatchPool`/`createResolvedRenderBroadcastPool`
 * (render-engine, D2).
 *
 * Usado solo para ejercitar `decodeSaveResult` (save): `append-page` no tiene
 * decoder que probar (ver la nota "ADR-055" de cabecera de `export.engine.ts`
 * — el resultado nunca se consume), así que los tests de `append-page` no
 * necesitan discriminar por forma de payload, a diferencia de
 * `createShapeAwareExportPool` (más abajo), que sí resuelve cada operación
 * con un valor distinto.
 */
export function createResolvedExportPool(resolvedValue: unknown): {
  readonly dispatch: (params: ExportPoolDispatchParams<unknown>) => Promise<unknown>;
} {
  return {
    dispatch: (): Promise<unknown> => Promise.resolve(resolvedValue),
  };
}

/**
 * Pool estructural que discrimina por forma del payload (mismo criterio que
 * `worker/entry.ts#isExportPagePayload`: `"pageImage" in payload` →
 * append-page; si no → save) para resolver cada operación con un valor
 * distinto — necesario para ejercitar el decoder de `save` en el flujo
 * completo de `export()` (que primero despacha N `append-page` y luego un
 * `save`) sin que la forma de basura de `save` contamine también los
 * despachos de `append-page` anteriores en el mismo loop. `appendResolvedValue`
 * default `null` (la forma que postea `worker/entry.ts` para append-page,
 * ADR-055 — sin impacto: `exportPage` nunca lee este valor).
 */
export function createShapeAwareExportPool(options: {
  readonly saveResolvedValue: unknown;
  readonly appendResolvedValue?: unknown;
}): {
  readonly dispatch: (params: ExportPoolDispatchParams<unknown>) => Promise<unknown>;
} {
  return {
    dispatch: (params: ExportPoolDispatchParams<unknown>): Promise<unknown> => {
      const payload = params.payload;
      const isAppendPage =
        typeof payload === "object" && payload !== null && "pageImage" in payload;
      return Promise.resolve(
        isAppendPage ? (options.appendResolvedValue ?? null) : options.saveResolvedValue,
      );
    },
  };
}

// ─── Mock de RenderPageProvider ───

export interface MockRenderPageProviderOptions {
  readonly bytes?: ArrayBuffer;
  readonly format?: "png" | "jpeg";
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly error?: Error;
  readonly neverResolves?: boolean;
  readonly perPageImage?: (pageIndex: number) => EncodedPageImage;
  // ─── ADR-059 §5/§8 — renderLegend ───
  readonly legendImage?: EncodedPageImage;
  readonly legendError?: Error;
}

/**
 * Intersección con los dos `vi.fn()` concretos (no solo `RenderPageProvider`):
 * permite a los callers hacer `expect(provider.renderLegend).toHaveBeenCalled()`
 * directo, sin el cast `as unknown as ReturnType<typeof vi.fn>` que necesitaría
 * un acceso tipado solo por la interfaz.
 */
export type MockRenderPageProvider = RenderPageProvider & {
  readonly renderFull: ReturnType<typeof vi.fn>;
  readonly renderLegend: ReturnType<typeof vi.fn>;
};

export function createMockRenderPageProvider(
  options?: MockRenderPageProviderOptions,
): MockRenderPageProvider {
  const renderFull = vi.fn(
    (pageIndex: number, _replacements: ReadonlyArray<Replacement>, _abortSignal: AbortSignal) => {
      if (options?.neverResolves === true) {
        return new Promise<EncodedPageImage>(() => undefined);
      }
      if (options?.error) {
        return Promise.reject(options.error);
      }
      if (options?.perPageImage) {
        return Promise.resolve(options.perPageImage(pageIndex));
      }
      return Promise.resolve<EncodedPageImage>({
        bytes: options?.bytes ?? new Uint8Array([1, 2, 3, 4]).buffer,
        format: options?.format ?? "jpeg",
        widthPx: options?.widthPx ?? 100,
        heightPx: options?.heightPx ?? 100,
      });
    },
  );
  const renderLegend = vi.fn(
    (_rows: ReadonlyArray<MarkerLegendRow>, _abortSignal: AbortSignal) => {
      if (options?.legendError) {
        return Promise.reject(options.legendError);
      }
      return Promise.resolve<EncodedPageImage>(
        options?.legendImage ?? {
          bytes: new Uint8Array([9, 9, 9, 9]).buffer,
          format: "png",
          widthPx: 50,
          heightPx: 50,
        },
      );
    },
  );
  return { renderFull, renderLegend };
}

// ─── EngineContext / config mocks (mismo patrón que render-engine) ───

// ─── Builders de dominio ───

export function createPage(overrides?: Partial<Page>): Page {
  return {
    index: 0,
    width: 595,
    height: 842,
    words: [],
    text: "",
    requiresOCR: false,
    ocrCompleted: false,
    ...overrides,
  };
}

export function createDocumentMetadata(overrides?: Partial<DocumentMetadata>): DocumentMetadata {
  return {
    pdfVersion: "1.7",
    encrypted: false,
    hasForms: false,
    ...overrides,
  };
}

export function createDocument(overrides?: Partial<Document>): Document {
  const base: Document = {
    id: "doc-1",
    name: "test.pdf",
    pageCount: 1,
    pages: [createPage({ index: 0 })],
    metadata: createDocumentMetadata(),
    sourceKind: "text",
    importedAt: Date.now(),
  };
  return { ...base, ...overrides };
}

export function createDocumentWithPageCount(
  pageCount: number,
  pageSize?: { readonly width: number; readonly height: number },
): Document {
  const width = pageSize?.width ?? 100;
  const height = pageSize?.height ?? 100;
  return createDocument({
    pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => createPage({ index, width, height })),
  });
}

export function createEntityGroup(overrides?: Partial<EntityGroup>): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.DNI,
    canonicalValue: "34.567.891",
    members: [
      {
        occurrenceId: "occ-1",
        value: "valor",
        pageIndex: 0,
        bbox: { x: 10, y: 20, width: 100, height: 14 },
        source: DetectionSource.Regex,
      },
    ],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[DNI 01]",
    indexInType: 1,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    needsReview: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createExportOptions(overrides?: Partial<ExportOptions>): ExportOptions {
  return {
    imageFormat: "jpeg",
    jpegQuality: 0.85,
    dpi: 150,
    includeOriginalMetadata: false,
    filename: "anonimizado.pdf",
    includeMarkerLegend: false,
    ...overrides,
  };
}

export function createExportEngineInput(overrides?: Partial<ExportEngineInput>): ExportEngineInput {
  return {
    documentId: "doc-1",
    document: createDocument(),
    groups: [createEntityGroup()],
    rules: [],
    options: createExportOptions(),
    renderPageProvider: createMockRenderPageProvider(),
    ...overrides,
  };
}

/*
 * ADR-129: el `workerPool` —idéntico en los seis motores— sale del doble
 * compartido; acá quedan **solo** los campos que este motor necesita distintos,
 * con los mismos valores que tenía su copia propia.
 */
export function createMockConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return sharedCreateMockConfig({
    render: { previewScale: 1, fullScale: 2.08, jpegQuality: 0.85, cachePages: 16 },
    export: { defaultDpi: 150, defaultImageFormat: "jpeg", defaultJpegQuality: 0.85 },
    ...overrides,
  });
}

/*
 * El `EngineContext` compartido arma su config internamente, así que hay que
 * pasarle la de este motor: si no, `ctx.config` sale con los defaults genéricos
 * y no con los que sus tests necesitan (ADR-129).
 */
export function createEngineContext(overrides?: Partial<EngineContext>): EngineContext {
  return sharedCreateEngineContext({ config: createMockConfig(), ...overrides });
}
