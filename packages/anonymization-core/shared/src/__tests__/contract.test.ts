/**
 * Tests contractuales de @anonly/shared.
 *
 * Validan que el paquete cumple los contratos declarados en:
 * - docs/core/Contracts.md
 * - docs/architecture/03_Data_Model.md
 * - docs/ai/Code_Standards.md §6 (inmutabilidad), §7 (errores)
 * - docs/adr/ADR-008-Immutability.md
 */

import { describe, it, expect } from "vitest";

import {
  CancelledError,
  DetectionSource,
  EngineDisposedError,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
  EventChannel,
  InvalidInputError,
  makeTransferable,
  ReplacementMode,
  synthesize,
} from "../index.js";
import { isTransferable } from "../index.js";
import type {
  BoundingBox,
  Document,
  EngineConfig,
  EngineContext,
  EntityGroup,
  ExportRequested,
  GroupUpdateRequested,
  EntityGroupCreated,
  ICache,
  IEngine,
  IEventBus,
  ILogger,
  Occurrence,
  Page,
  PageParsed,
  Word,
} from "../index.js";

/**
 * Validador de CUIT de dominio (AFIP, módulo 11), independiente de la
 * implementación del sintetizador: dv = 11 - (suma ponderada % 11); si el
 * resto es 0 el dv es 0; si el resto es 1 (dv 10) el CUIT no existe.
 */
function isValidCuit(cuit: string): boolean {
  const match = /^(\d{2})-(\d{8})-(\d)$/.exec(cuit);
  if (!match) return false;
  const [, prefix, body, dvRaw] = match;
  if (!prefix || !body || !dvRaw) return false;
  const digits = `${prefix}${body}`.split("").map((c) => parseInt(c, 10));
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (digits[i] ?? 0) * (weights[i] ?? 0);
  }
  const mod = sum % 11;
  if (mod === 1) return false;
  const dv = (11 - mod) % 11;
  return dv === parseInt(dvRaw, 10);
}

describe("@anonly/shared — Contracts", () => {
  describe("EngineId", () => {
    it("tiene los 7 engines del TAD", () => {
      expect(EngineId.Pdf).toBe("pdf");
      expect(EngineId.Ocr).toBe("ocr");
      expect(EngineId.Regex).toBe("regex");
      expect(EngineId.Ner).toBe("ner");
      expect(EngineId.Grouping).toBe("grouping");
      expect(EngineId.Render).toBe("render");
      expect(EngineId.Export).toBe("export");
    });

    it("tiene exactamente 7 valores", () => {
      expect(Object.values(EngineId)).toHaveLength(7);
    });
  });

  describe("EventChannel", () => {
    it("tiene los 10 canales definidos", () => {
      expect(EventChannel.Pipeline).toBe("pipeline");
      expect(EventChannel.UI).toBe("ui");
      expect(EventChannel.Pdf).toBe("pdf");
      expect(EventChannel.Ocr).toBe("ocr");
      expect(EventChannel.Regex).toBe("regex");
      expect(EventChannel.Ner).toBe("ner");
      expect(EventChannel.Grouping).toBe("grouping");
      expect(EventChannel.Render).toBe("render");
      expect(EventChannel.Export).toBe("export");
      expect(EventChannel.Workers).toBe("workers");
      expect(Object.values(EventChannel)).toHaveLength(10);
    });
  });

  describe("EntityType", () => {
    it("tiene los 13 tipos del TAD", () => {
      const expected = [
        "PERSON",
        "ORGANIZATION",
        "ADDRESS",
        "DNI",
        "CUIT",
        "PHONE",
        "EMAIL",
        "IBAN",
        "CREDIT_CARD",
        "DATE",
        "LICENSE",
        "PLATE",
        "CUSTOM",
      ];
      expect(Object.values(EntityType).sort()).toEqual([...expected].sort());
    });
  });

  describe("ReplacementMode", () => {
    it("tiene los 4 modos de ADR-012", () => {
      expect(ReplacementMode.Mask).toBe("mask");
      expect(ReplacementMode.Synthetic).toBe("synthetic");
      expect(ReplacementMode.Placeholder).toBe("placeholder");
      expect(ReplacementMode.Redact).toBe("redact");
      expect(Object.values(ReplacementMode)).toHaveLength(4);
    });
  });

  describe("DetectionSource", () => {
    it("tiene las 4 fuentes", () => {
      expect(DetectionSource.Regex).toBe("regex");
      expect(DetectionSource.NER).toBe("ner");
      expect(DetectionSource.OCR).toBe("ocr");
      expect(DetectionSource.Manual).toBe("manual");
    });
  });

  describe("EngineEvents", () => {
    it("tiene exactamente el set completo de eventos de 04_Event_System.md", () => {
      const expected = [
        // Pipeline (7)
        "DOCUMENT_IMPORTED",
        "PIPELINE_STAGE_CHANGED",
        "PIPELINE_PROGRESS",
        "PIPELINE_READY",
        "PIPELINE_CANCELLED",
        "PIPELINE_FAILED",
        "CANCEL_REQUESTED",
        // PDF (4)
        "PAGE_PARSED",
        "DOCUMENT_PARSED",
        "PDF_PASSWORD_REQUIRED",
        "PDF_INVALID",
        // OCR (4)
        "OCR_STARTED",
        "OCR_PAGE_FINISHED",
        "OCR_FINISHED",
        "OCR_PAGE_FAILED",
        // Detectores (7)
        "ENTITY_FOUND",
        "REGEX_FINISHED",
        "NER_STARTED",
        "NER_MODEL_LOADING",
        "NER_MODEL_READY",
        "NER_PAGE_FINISHED",
        "NER_FINISHED",
        // Grouping (8)
        "ENTITY_GROUP_CREATED",
        "ENTITY_GROUP_UPDATED",
        "ENTITY_GROUP_REMOVED",
        "GROUP_REPLACEMENT_CHANGED",
        "GROUP_TOGGLED",
        "CONFLICT_DETECTED",
        "CONFLICT_RESOLVED",
        "GROUPING_FINISHED",
        // Render (5)
        "PREVIEW_UPDATED",
        "PREVIEW_PAGE_FAILED",
        "RENDER_REQUESTED",
        "RENDER_FINISHED",
        "RENDER_FAILED",
        // Export (5)
        "EXPORT_REQUESTED",
        "EXPORT_STARTED",
        "EXPORT_PROGRESS",
        "EXPORT_FINISHED",
        "EXPORT_FAILED",
        // Workers (6)
        "WORKER_JOB_DISPATCHED",
        "WORKER_JOB_COMPLETED",
        "WORKER_JOB_FAILED",
        "WORKER_JOB_CANCELLED",
        "WORKER_JOB_TIMEOUT",
        "WORKER_POOL_SATURATED",
        // UI (8)
        "GROUP_UPDATE_REQUESTED",
        "GROUP_MERGE_REQUESTED",
        "GROUP_SPLIT_REQUESTED",
        "RULE_CREATED",
        "RULE_UPDATED",
        "RULE_DELETED",
        "CONFLICT_RESOLVE_REQUESTED",
        "DOCUMENT_CLOSED",
      ];
      // Igualdad exacta de conjuntos: un evento agregado o borrado sin pasar
      // por Contracts.md/04_Event_System.md rompe este test (R-19).
      expect(Object.values(EngineEvents).sort()).toEqual([...expected].sort());
    });
  });

  describe("EngineErrorCode", () => {
    it("tiene exactamente el set completo de códigos de Contracts.md §4", () => {
      const expected = [
        // PDF (4)
        "PDF_PASSWORD_REQUIRED",
        "PDF_INVALID",
        "PDF_CORRUPTED",
        "PDF_TIMEOUT",
        // OCR (3)
        "OCR_PAGE_FAILED",
        "OCR_TIMEOUT",
        "OCR_MODEL_MISSING",
        // Regex (1)
        "REGEX_INVALID_PATTERN",
        // NER (4)
        "NER_MODEL_MISSING",
        "NER_MODEL_LOAD_FAILED",
        "NER_TIMEOUT",
        "NER_PAGE_FAILED",
        // Grouping (2)
        "GROUPING_INVALID_PATCH",
        "GROUPING_GROUP_NOT_FOUND",
        // Render (3)
        "RENDER_PAGE_FAILED",
        "RENDER_TIMEOUT",
        "RENDER_FAILED", // fatal de batch (ADR-031)
        // Export (3)
        "EXPORT_FAILED",
        "EXPORT_NO_ENABLED_GROUPS",
        "EXPORT_TIMEOUT",
        // Generic (4)
        "ENGINE_NOT_INITIALIZED",
        "ENGINE_DISPOSED",
        "INVALID_INPUT",
        "CANCELLED",
      ];
      // Igualdad exacta de conjuntos: un código agregado o borrado sin pasar
      // por Contracts.md §4 rompe este test (R-19).
      expect(Object.values(EngineErrorCode).sort()).toEqual([...expected].sort());
    });
  });

  describe("EngineError", () => {
    it("EngineError es abstract (no se puede instanciar directo)", () => {
      // EngineError tiene un guard en el constructor que lanza TypeError si
      // se instancia directo (new.target === EngineError). TS también lo bloquea
      // en compile-time (abstract class).
      // @ts-expect-error — EngineError es abstract, no se puede instanciar
      expect(() => new EngineError("x", false)).toThrow();
    });

    it("EngineNotInitializedError tiene code, engineId y retryable correctos", () => {
      const err = new EngineNotInitializedError(EngineId.Pdf);
      expect(err.code).toBe(EngineErrorCode.ENGINE_NOT_INITIALIZED);
      expect(err.engineId).toBe("core");
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("pdf");
      expect(err.name).toBe("EngineNotInitializedError");
    });

    it("EngineDisposedError tiene code y retryable=false", () => {
      const err = new EngineDisposedError(EngineId.Ner);
      expect(err.code).toBe(EngineErrorCode.ENGINE_DISPOSED);
      expect(err.retryable).toBe(false);
    });

    it("InvalidInputError acepta mensaje y details custom", () => {
      const err = new InvalidInputError("input null", { field: "buffer" });
      expect(err.code).toBe(EngineErrorCode.INVALID_INPUT);
      expect(err.retryable).toBe(false);
      expect(err.details).toEqual({ field: "buffer" });
    });

    it("CancelledError tiene code CANCELLED", () => {
      const err = new CancelledError("job-123");
      expect(err.code).toBe(EngineErrorCode.CANCELLED);
      expect(err.details).toEqual({ jobId: "job-123" });
    });

    it("details es inmutable (Object.freeze)", () => {
      const err = new InvalidInputError("test", { field: "x" });
      expect(Object.isFrozen(err.details)).toBe(true);
      expect(() => {
        (err.details as Record<string, unknown>).field = "y";
      }).toThrow();
    });

    it("serialize/deserialize roundtrip", () => {
      const err = new InvalidInputError("test", { field: "x" });
      const serialized = err.serialize();
      expect(serialized.code).toBe(EngineErrorCode.INVALID_INPUT);
      expect(serialized.message).toBe("test");
      expect(serialized.retryable).toBe(false);

      const reconstructed = EngineError.deserialize(serialized);
      expect(reconstructed.code).toBe(EngineErrorCode.INVALID_INPUT);
      expect(reconstructed.message).toBe("test");
      expect(reconstructed.retryable).toBe(false);
    });
  });

  describe("Inmutabilidad de tipos (ADR-008)", () => {
    // La garantía es de compile-time (readonly/ReadonlyArray, sin Object.freeze
    // en runtime — Code_Standards.md §6). Los asserts usan @ts-expect-error
    // sobre funciones que no se ejecutan: si TS dejara de marcar el error
    // (se perdió un readonly), el typecheck de este archivo falla.
    it("EntityGroup no admite asignación a props readonly (compile-time)", () => {
      const group: EntityGroup = {
        id: "g1",
        type: EntityType.DNI,
        canonicalValue: "34.567.891",
        members: [],
        replacementMode: ReplacementMode.Placeholder,
        replacementValue: "[DNI 01]",
        indexInType: 1,
        enabled: true,
        aliases: ["34.567.891", "34567891"],
        createdAt: 0,
        updatedAt: 0,
      };
      const mutate = (): void => {
        // @ts-expect-error — id es readonly (ADR-008); assert de compile-time
        group.id = "x";
      };
      void mutate;
      expect(group.id).toBe("g1");
    });

    it("Document.pages es ReadonlyArray (sin push, compile-time)", () => {
      const page: Page = {
        index: 0,
        width: 595,
        height: 842,
        words: [],
        text: "",
        requiresOCR: false,
        ocrCompleted: false,
      };
      const doc: Document = {
        id: "d1",
        name: "test.pdf",
        pageCount: 1,
        pages: [page],
        metadata: {
          pdfVersion: "1.7",
          encrypted: false,
          hasForms: false,
        },
        sourceKind: "text",
        importedAt: 0,
      };
      const mutate = (): void => {
        // @ts-expect-error — ReadonlyArray<Page> no expone push (ADR-008)
        doc.pages.push(page);
      };
      void mutate;
      expect(doc.pageCount).toBe(1);
    });

    it("BoundingBox tiene coords readonly (compile-time)", () => {
      const bbox: BoundingBox = { x: 0, y: 0, width: 100, height: 50 };
      const mutate = (): void => {
        // @ts-expect-error — width es readonly (ADR-008); assert de compile-time
        bbox.width = 999;
      };
      void mutate;
      expect(bbox.width).toBe(100);
    });
  });

  describe("EventPayloads", () => {
    it("PageParsed tiene los campos esperados", () => {
      const p: PageParsed = {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      };
      expect(p.wordCount).toBe(10);
    });

    it("EntityGroupCreated lleva el grupo completo", () => {
      const group: EntityGroup = {
        id: "g1",
        type: EntityType.Person,
        canonicalValue: "Juan",
        members: [],
        replacementMode: ReplacementMode.Placeholder,
        replacementValue: "[PERSONA 01]",
        indexInType: 1,
        enabled: true,
        aliases: ["Juan"],
        createdAt: 0,
        updatedAt: 0,
      };
      const payload: EntityGroupCreated = {
        documentId: "d1",
        group,
      };
      expect(payload.group.canonicalValue).toBe("Juan");
    });

    it("GroupUpdateRequested patch solo permite campos seguros", () => {
      const payload: GroupUpdateRequested = {
        documentId: "d1",
        groupId: "g1",
        patch: { replacementMode: ReplacementMode.Mask },
      };
      expect(payload.patch.replacementMode).toBe(ReplacementMode.Mask);
      // `patch` es Partial<Pick<EntityGroup, ...>> sin `id`. Verificado por typecheck.
    });

    it("ExportRequested options.includeOriginalMetadata debe ser false", () => {
      const payload: ExportRequested = {
        documentId: "d1",
        options: {
          imageFormat: "jpeg",
          jpegQuality: 0.85,
          dpi: 150,
          includeOriginalMetadata: false,
          filename: "out.pdf",
        },
      };
      expect(payload.options.includeOriginalMetadata).toBe(false);
      // `includeOriginalMetadata: false` es literal por tipo. Verificado por typecheck.
    });
  });

  describe("Transferable", () => {
    it("makeTransferable crea un wrapper con consume()", () => {
      const buf = new ArrayBuffer(10);
      const t = makeTransferable(buf);
      expect(isTransferable(t)).toBe(true);
      const consumed = t.consume();
      expect(consumed).toBe(buf);
    });

    it("consume() lanza si ya fue consumido", () => {
      const buf = new ArrayBuffer(10);
      const t = makeTransferable(buf);
      t.consume();
      expect(() => t.consume()).toThrow(/consumido/);
    });

    it("buffer lanza si se accede después de consume()", () => {
      const buf = new ArrayBuffer(10);
      const t = makeTransferable(buf);
      expect(t.buffer).toBe(buf);
      t.consume();
      expect(() => t.buffer).toThrow(/consumido/);
    });

    it("isTransferable devuelve false para no-transferables", () => {
      expect(isTransferable({})).toBe(false);
      expect(isTransferable(null)).toBe(false);
      expect(isTransferable(new ArrayBuffer(10))).toBe(false);
    });
  });

  describe("synthesize", () => {
    it("es determinista: mismo (type, index, seed) → mismo valor", () => {
      const a = synthesize(EntityType.DNI, 1, "seed-x");
      const b = synthesize(EntityType.DNI, 1, "seed-x");
      expect(a).toBe(b);
    });

    it("diferentes seeds generan (casi siempre) diferentes valores", () => {
      const a = synthesize(EntityType.DNI, 1, "seed-a");
      const b = synthesize(EntityType.DNI, 1, "seed-b");
      // No garantiza 100% colisión cero por espacio finito, pero para tests alcanzamos !=.
      expect(a).not.toBe(b);
    });

    it("DNI sintético tiene formato XX.XXX.XXX y no arranca en 0", () => {
      const v = synthesize(EntityType.DNI, 1, "seed-dni");
      expect(v).toMatch(/^\d{2}\.\d{3}\.\d{3}$/);
      expect(v.startsWith("0")).toBe(false);
    });

    it("CUIT sintético pasa el validador AFIP de dominio", () => {
      const v = synthesize(EntityType.CUIT, 1, "seed-cuit");
      expect(v).toMatch(/^\d{2}-\d{8}-\d$/);
      expect(isValidCuit(v)).toBe(true);
    });

    it("CUITs de 200 índices distintos son todos válidos (nunca dv 10)", () => {
      for (let i = 1; i <= 200; i++) {
        const v = synthesize(EntityType.CUIT, i, "seed-masivo");
        expect(isValidCuit(v), `CUIT inválido en índice ${i}: ${v}`).toBe(true);
      }
    });

    it("License sintético respeta el formato XX-XXXX-XX (ADR-012)", () => {
      const v = synthesize(EntityType.License, 1, "seed-lic");
      expect(v).toMatch(/^\d{2}-\d{4}-\d{2}$/);
    });

    it("CreditCard sintético pasa Luhn", () => {
      const v = synthesize(EntityType.CreditCard, 1, "seed-cc");
      const digits = v
        .replace(/\s/g, "")
        .split("")
        .map((c) => parseInt(c, 10));
      let sum = 0;
      let double = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let d = digits[i] as number;
        if (double) {
          d *= 2;
          if (d > 9) d -= 9;
        }
        sum += d;
        double = !double;
      }
      expect(sum % 10).toBe(0);
    });

    it("Email sintético tiene formato válido", () => {
      const v = synthesize(EntityType.Email, 1, "seed-email");
      expect(v).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    });

    it("Person sintético es Nombre + Apellido", () => {
      const v = synthesize(EntityType.Person, 1, "seed-person");
      // Soporta acentos (Fernández, María, etc.)
      expect(v).toMatch(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/u);
    });
  });

  describe("Tipos internos del pipeline", () => {
    it("Word y Occurrence tipan sus campos requeridos", () => {
      const word: Word = {
        text: "Juan",
        bbox: { x: 0, y: 0, width: 40, height: 12 },
        pageIndex: 0,
        confidence: 1,
        source: "pdf",
      };
      const occurrence: Occurrence = {
        id: "o1",
        value: "Juan Pérez",
        normalizedValue: "juan perez",
        bbox: word.bbox,
        pageIndex: word.pageIndex,
        source: DetectionSource.NER,
        confidence: 0.93,
        entityType: EntityType.Person,
      };
      expect(occurrence.entityType).toBe(EntityType.Person);
      expect(word.source).toBe("pdf");
    });
  });

  describe("Interfaces base — firmas", () => {
    it("IEngine tiene id, init, dispose", () => {
      const engine: IEngine = {
        id: EngineId.Pdf,
        async init(_ctx: EngineContext): Promise<void> {},
        async dispose(): Promise<void> {},
      };
      expect(engine.id).toBe(EngineId.Pdf);
    });

    it("IEventBus tiene on, once, off, emit, emitAsync", () => {
      const bus: IEventBus = {
        on: () => () => {},
        once: () => () => {},
        off: () => {},
        emit: () => {},
        emitAsync: async () => {},
      };
      expect(typeof bus.on).toBe("function");
      expect(typeof bus.emit).toBe("function");
    });

    it("ILogger tiene debug/info/warn/error", () => {
      const logger: ILogger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };
      expect(typeof logger.debug).toBe("function");
    });

    it("ICache tiene get/set/delete/clear + size/bytes", () => {
      const cache: ICache = {
        get: () => undefined,
        set: () => {},
        delete: () => {},
        clear: () => {},
        size: 0,
        bytes: 0,
      };
      expect(cache.size).toBe(0);
    });
  });

  describe("Sin `any` exportado", () => {
    it("ningún tipo exportado es `any` (validado por typecheck)", () => {
      // Test de tipo: si algún export fuera `any`, el typecheck del paquete falla.
      // Este test es un placeholder; la verificación real es `pnpm typecheck`.
      const _check: EngineConfig = {
        workerPool: {
          pdfPoolSize: 2,
          ocrPoolSize: 1,
          nerPoolSize: 1,
          renderPoolSize: 2,
          maxQueuePerPool: 32,
          timeouts: {
            "pdf-parse": 30000,
            "ocr-page": 60000,
            "ner-page": 20000,
            "render-page": 10000,
            "export-page": 30000,
          },
          maxRetries: {
            "pdf-parse": 1,
            "ocr-page": 2,
            "ner-page": 1,
            "render-page": 1,
            "export-page": 1,
          },
          baseRetryDelayMs: 250,
          maxRetryDelayMs: 2000,
          cancelSlaMs: 200,
          idleDisposeMs: 60000,
        },
        pdf: { maxPageCount: 10000 },
        ner: {
          modelId: "Xenova/bert-base-NER",
          quantization: "q8",
          confidenceThreshold: 0.7,
          batchSize: 256,
          enabled: true,
        },
        ocr: {
          languages: ["spa", "eng"],
          dpi: 300,
        },
        grouping: {
          similarityThreshold: 0.88,
          minAliasFrequency: 1,
        },
        render: {
          previewScale: 1.0,
          fullScale: 2.08,
          jpegQuality: 0.85,
          cachePages: 16,
        },
        export: {
          defaultDpi: 150,
          defaultImageFormat: "jpeg",
          defaultJpegQuality: 0.85,
        },
      };
      expect(_check).toBeDefined();
    });
  });
});
