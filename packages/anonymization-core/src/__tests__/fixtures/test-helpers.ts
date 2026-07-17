/**
 * Mocks y builders compartidos por los tests de `@anonly/anonymization-core`
 * (el Orchestrator).
 *
 * Los motores se mockean instanciando la clase **real** de cada uno
 * (`new PdfEngine()`, etc.) y usando `vi.spyOn(instance, "method")` para
 * controlar su comportamiento por test — no un objeto estructural casteado.
 * Code_Standards.md §10 reserva los casts de frontera (`as unknown as X`)
 * para tipos de **librerías externas** mockeadas; para tipos **propios**
 * (las clases de motor, tipadas literalmente en `Contracts.md` §3.5:
 * `IAnonymizationCore.engines.pdf: PdfEngine`, no una interfaz), instanciar
 * la clase real + `vi.spyOn` es la herramienta correcta: type-safe sin
 * casts, y las clases de motor no hacen ningún trabajo pesado ni de red en
 * el constructor ni en métodos no espiados (los tests nunca llaman `init()`
 * real de un motor mockeado; los métodos que el Orchestrator invoca siempre
 * están espiados).
 *
 * La integración con motores reales vive en `tests/integration/` (Hito 9).
 */
import { createEventBus, type EventBus } from "@anonly/event-system";
import { ExportEngine } from "@anonly/export-engine";
import { GroupingEngine } from "@anonly/grouping-engine";
import { NerEngine } from "@anonly/ner-engine";
import { OcrEngine } from "@anonly/ocr-engine";
import { PdfEngine } from "@anonly/pdf-engine";
import type { PdfEngineOutput } from "@anonly/pdf-engine";
import { RegexEngine } from "@anonly/regex-engine";
import { RenderEngine } from "@anonly/render-engine";
import type { RenderPageOutput } from "@anonly/render-engine";
import {
  EngineEvents,
  EntityType,
  EventChannel,
  ReplacementMode,
  type Document,
  type DocumentMetadata,
  type EngineConfig,
  type EntityGroup,
  type IEventBus,
  type ILogger,
  type Page,
  type Rule,
} from "@anonly/shared";
import { vi } from "vitest";

import { mergeEngineConfig } from "../../config.js";
import type { AnonymizationCoreEngines, ImportDocumentInput } from "../../types.js";

export function createMockLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/**
 * Devuelve el tipo concreto `EventBus` (no solo `IEventBus`): los tests de
 * la matriz (contract.test.ts) necesitan `subscriberCount`/`channelCount`,
 * utilidades de solo lectura de la clase `EventBus` que no forman parte del
 * contrato `IEventBus` (04_Event_System.md §13). `EventBus` sigue siendo
 * asignable donde se espera `IEventBus`.
 */
export function createRealBus(logger?: ILogger): EventBus {
  return createEventBus({ logger: logger ?? createMockLogger() });
}

export function createEngineConfig(overrides?: Partial<EngineConfig>): EngineConfig {
  return mergeEngineConfig(overrides, {});
}

/** Instancias reales (no casteadas) de los 7 motores; ver nota de cabecera. */
export function createMockEngines(): AnonymizationCoreEngines {
  return {
    pdf: new PdfEngine(),
    ocr: new OcrEngine(),
    regex: new RegexEngine(),
    ner: new NerEngine(),
    grouping: new GroupingEngine(),
    render: new RenderEngine(),
    export: new ExportEngine(),
  };
}

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
  return { pdfVersion: "1.7", encrypted: false, hasForms: false, ...overrides };
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

export function createPdfEngineOutput(overrides?: Partial<PdfEngineOutput>): PdfEngineOutput {
  const document = overrides?.document ?? createDocument();
  return {
    document,
    pageCount: document.pageCount,
    textlessPages: [],
    sourceKind: document.sourceKind,
    ...overrides,
  };
}

export function createImportInput(overrides?: Partial<ImportDocumentInput>): ImportDocumentInput {
  return {
    documentId: "doc-1",
    name: "test.pdf",
    buffer: new Uint8Array([1, 2, 3, 4]).buffer,
    ...overrides,
  };
}

export function createRenderPageOutput(overrides?: Partial<RenderPageOutput>): RenderPageOutput {
  return {
    documentId: "doc-1",
    pageIndex: 0,
    kind: "anonymized",
    imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: "srgb" },
    durationMs: 1,
    encoded: { bytes: new Uint8Array([1, 2, 3]).buffer, format: "jpeg", widthPx: 1, heightPx: 1 },
    ...overrides,
  };
}

export function createImageData(width = 10, height = 10): ImageData {
  return { data: new Uint8ClampedArray(width * height * 4), width, height, colorSpace: "srgb" };
}

export function createEntityGroup(overrides?: Partial<EntityGroup>): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.DNI,
    canonicalValue: "34.567.891",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[DNI 01]",
    indexInType: 1,
    enabled: true,
    aliases: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createRule(overrides?: Partial<Rule>): Rule {
  return {
    id: "rule-1",
    scope: "global",
    target: { kind: "global" },
    mode: ReplacementMode.Redact,
    priority: 1,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Cablea los spies "happy path" de los 7 motores mockeados: cada llamada que
 * el Orchestrator hace resuelve con un resultado válido mínimo y, cuando el
 * motor real emitiría un evento síncronamente (Regex/NER emiten
 * `*_FINISHED`; Grouping emite `GROUPING_FINISHED` desde `finishSession`),
 * el spy lo reproduce sobre `bus` — mismo efecto observable que el motor
 * real, sin su lógica interna (que ya tiene su propia suite de tests por
 * motor). Tests individuales pueden sobreescribir cualquier spy después de
 * llamar a este helper.
 */
export function wireHappyPathSpies(
  engines: AnonymizationCoreEngines,
  bus: IEventBus,
  options?: {
    readonly pdfOutput?: PdfEngineOutput;
    readonly nerEnabled?: boolean;
  },
): void {
  const pdfOutput = options?.pdfOutput ?? createPdfEngineOutput();
  const documentId = pdfOutput.document.id;

  vi.spyOn(engines.pdf, "process").mockResolvedValue(pdfOutput);
  vi.spyOn(engines.pdf, "fuseOcrPage").mockResolvedValue(pdfOutput.document);
  vi.spyOn(engines.pdf, "releaseDocument").mockImplementation(() => undefined);
  vi.spyOn(engines.pdf, "dispose").mockResolvedValue(undefined);

  vi.spyOn(engines.ocr, "processPages").mockImplementation((inputs) =>
    Promise.resolve(
      inputs.map((input) => ({
        documentId: input.documentId,
        pageIndex: input.pageIndex,
        words: [],
        confidence: 0.9,
        durationMs: 1,
      })),
    ),
  );
  vi.spyOn(engines.ocr, "dispose").mockResolvedValue(undefined);

  vi.spyOn(engines.regex, "process").mockImplementation((input) => {
    bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: input.document.id,
      occurrenceCount: 0,
      durationMs: 1,
    });
    return Promise.resolve({ documentId: input.document.id, occurrenceCount: 0, durationMs: 1 });
  });
  vi.spyOn(engines.regex, "dispose").mockResolvedValue(undefined);

  vi.spyOn(engines.ner, "processPages").mockImplementation(async (inputs) => {
    bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId,
      occurrenceCount: 0,
      durationMs: 1,
    });
    if (options?.nerEnabled !== false) {
      // Simula el auto-finish real de Grouping (ambos *_FINISHED) sin
      // reimplementar su lógica interna acá (ver nota de cabecera).
      await engines.grouping.finishSession(documentId);
    }
    return inputs.map((input) => ({
      documentId: input.documentId,
      pageIndex: input.pageIndex,
      occurrences: [],
      durationMs: 1,
    }));
  });
  vi.spyOn(engines.ner, "dispose").mockResolvedValue(undefined);

  vi.spyOn(engines.grouping, "startSession").mockImplementation(() => undefined);
  vi.spyOn(engines.grouping, "finishSession").mockImplementation((docId) => {
    bus.emit(EventChannel.Grouping, EngineEvents.GROUPING_FINISHED, {
      documentId: docId,
      groupCount: 0,
      conflictCount: 0,
      durationMs: 1,
    });
    return Promise.resolve();
  });
  vi.spyOn(engines.grouping, "getSnapshot").mockImplementation((docId) => ({
    documentId: docId,
    groups: [],
    conflicts: [],
    rules: [],
  }));
  vi.spyOn(engines.grouping, "dispose").mockResolvedValue(undefined);

  vi.spyOn(engines.render, "loadDocument").mockResolvedValue(undefined);
  vi.spyOn(engines.render, "unloadDocument").mockResolvedValue(undefined);
  vi.spyOn(engines.render, "rasterizePage").mockResolvedValue(createImageData());
  vi.spyOn(engines.render, "renderPage").mockImplementation((input) =>
    Promise.resolve(
      createRenderPageOutput({ documentId: input.documentId, pageIndex: input.pageIndex, kind: input.kind }),
    ),
  );
  vi.spyOn(engines.render, "dispose").mockResolvedValue(undefined);

  vi.spyOn(engines.export, "export").mockImplementation((input) => {
    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
      documentId: input.documentId,
      blobUrl: "blob:mock-export",
      sizeBytes: 10,
      durationMs: 1,
    });
    return Promise.resolve({
      documentId: input.documentId,
      buffer: new Uint8Array([1]).buffer,
      sizeBytes: 10,
      durationMs: 1,
    });
  });
  vi.spyOn(engines.export, "dispose").mockResolvedValue(undefined);
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
