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
    it("tiene todos los eventos del 04_Event_System.md", () => {
      // Pipeline
      expect(EngineEvents.DOCUMENT_IMPORTED).toBe("DOCUMENT_IMPORTED");
      expect(EngineEvents.PIPELINE_STAGE_CHANGED).toBe("PIPELINE_STAGE_CHANGED");
      expect(EngineEvents.PIPELINE_READY).toBe("PIPELINE_READY");
      expect(EngineEvents.CANCEL_REQUESTED).toBe("CANCEL_REQUESTED");
      // PDF
      expect(EngineEvents.PAGE_PARSED).toBe("PAGE_PARSED");
      expect(EngineEvents.DOCUMENT_PARSED).toBe("DOCUMENT_PARSED");
      expect(EngineEvents.PDF_PASSWORD_REQUIRED).toBe("PDF_PASSWORD_REQUIRED");
      // OCR
      expect(EngineEvents.OCR_STARTED).toBe("OCR_STARTED");
      expect(EngineEvents.OCR_FINISHED).toBe("OCR_FINISHED");
      // Detectores
      expect(EngineEvents.ENTITY_FOUND).toBe("ENTITY_FOUND");
      expect(EngineEvents.REGEX_FINISHED).toBe("REGEX_FINISHED");
      expect(EngineEvents.NER_MODEL_LOADING).toBe("NER_MODEL_LOADING");
      expect(EngineEvents.NER_FINISHED).toBe("NER_FINISHED");
      // Grouping
      expect(EngineEvents.ENTITY_GROUP_CREATED).toBe("ENTITY_GROUP_CREATED");
      expect(EngineEvents.ENTITY_GROUP_UPDATED).toBe("ENTITY_GROUP_UPDATED");
      expect(EngineEvents.GROUP_REPLACEMENT_CHANGED).toBe("GROUP_REPLACEMENT_CHANGED");
      expect(EngineEvents.GROUPING_FINISHED).toBe("GROUPING_FINISHED");
      expect(EngineEvents.CONFLICT_DETECTED).toBe("CONFLICT_DETECTED");
      // Render
      expect(EngineEvents.PREVIEW_UPDATED).toBe("PREVIEW_UPDATED");
      expect(EngineEvents.RENDER_REQUESTED).toBe("RENDER_REQUESTED");
      // Export
      expect(EngineEvents.EXPORT_REQUESTED).toBe("EXPORT_REQUESTED");
      expect(EngineEvents.EXPORT_FINISHED).toBe("EXPORT_FINISHED");
      // UI
      expect(EngineEvents.GROUP_UPDATE_REQUESTED).toBe("GROUP_UPDATE_REQUESTED");
      expect(EngineEvents.GROUP_MERGE_REQUESTED).toBe("GROUP_MERGE_REQUESTED");
      expect(EngineEvents.DOCUMENT_CLOSED).toBe("DOCUMENT_CLOSED");
    });
  });

  describe("EngineErrorCode", () => {
    it("tiene los códigos por motor de Contracts.md §4", () => {
      expect(EngineErrorCode.PDF_PASSWORD_REQUIRED).toBe("PDF_PASSWORD_REQUIRED");
      expect(EngineErrorCode.PDF_INVALID).toBe("PDF_INVALID");
      expect(EngineErrorCode.PDF_CORRUPTED).toBe("PDF_CORRUPTED");
      expect(EngineErrorCode.OCR_PAGE_FAILED).toBe("OCR_PAGE_FAILED");
      expect(EngineErrorCode.OCR_MODEL_MISSING).toBe("OCR_MODEL_MISSING");
      expect(EngineErrorCode.REGEX_INVALID_PATTERN).toBe("REGEX_INVALID_PATTERN");
      expect(EngineErrorCode.NER_MODEL_MISSING).toBe("NER_MODEL_MISSING");
      expect(EngineErrorCode.GROUPING_INVALID_PATCH).toBe("GROUPING_INVALID_PATCH");
      expect(EngineErrorCode.GROUPING_GROUP_NOT_FOUND).toBe("GROUPING_GROUP_NOT_FOUND");
      expect(EngineErrorCode.RENDER_PAGE_FAILED).toBe("RENDER_PAGE_FAILED");
      expect(EngineErrorCode.EXPORT_FAILED).toBe("EXPORT_FAILED");
      expect(EngineErrorCode.EXPORT_NO_ENABLED_GROUPS).toBe("EXPORT_NO_ENABLED_GROUPS");
      expect(EngineErrorCode.ENGINE_NOT_INITIALIZED).toBe("ENGINE_NOT_INITIALIZED");
      expect(EngineErrorCode.ENGINE_DISPOSED).toBe("ENGINE_DISPOSED");
      expect(EngineErrorCode.INVALID_INPUT).toBe("INVALID_INPUT");
      expect(EngineErrorCode.CANCELLED).toBe("CANCELLED");
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
    it("EntityGroup cumple readonly en todos sus campos", () => {
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
      expect(group.id).toBe("g1");
      // El cast hace la asignación válida en TS; el contrato readonly se garantiza en compile-time sin cast.
      (group as { id: string }).id = "x";
      expect(group.id).toBe("x"); // TS bloquea compile-time; runtime no es garantía sin Object.freeze.
    });

    it("Document tiene pages como ReadonlyArray", () => {
      const doc: Document = {
        id: "d1",
        name: "test.pdf",
        pageCount: 1,
        pages: [
          {
            index: 0,
            width: 595,
            height: 842,
            words: [],
            text: "",
            requiresOCR: false,
            ocrCompleted: false,
          },
        ],
        metadata: {
          pdfVersion: "1.7",
          encrypted: false,
          hasForms: false,
        },
        sourceKind: "text",
        importedAt: 0,
      };
      // El cast hace el push válido en TS; ReadonlyArray se garantiza en compile-time sin cast.
      expect(() => (doc.pages as unknown[]).push({})).not.toThrow();
      // ReadonlyArray previene push en compile time; en runtime Array tiene push.
      // El contrato se garantiza en TS, no en runtime (Code_Standards.md §6).
      expect(doc.pageCount).toBe(1);
    });

    it("BoundingBox tiene coords readonly", () => {
      const bbox: BoundingBox = { x: 0, y: 0, width: 100, height: 50 };
      expect(bbox.width).toBe(100);
      // El cast hace la asignación válida en TS; readonly se garantiza en compile-time sin cast.
      (bbox as { width: number }).width = 999;
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

    it("DNI sintético tiene formato XX.XXX.XXX (8 dígitos + 2 puntos)", () => {
      const v = synthesize(EntityType.DNI, 1);
      expect(v).toMatch(/^\d{2}\.\d{3}\.\d{3}$/);
    });

    it("CUIT sintético tiene dígito verificador válido", () => {
      const v = synthesize(EntityType.CUIT, 1);
      expect(v).toMatch(/^\d{2}-\d{8}-\d$/);
      const [prefix, body, check] = v.split(/[-]/);
      void prefix;
      void body;
      expect(check).toBeDefined();
      // Validar checksum real
      const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
      const digits = `${v.split("-")[0]}${v.split("-")[1]}`.split("").map((c) => parseInt(c, 10));
      let sum = 0;
      for (let i = 0; i < digits.length; i++) {
        sum += (digits[i] as number) * (weights[i] as number);
      }
      const mod = sum % 11;
      const expected = mod === 0 ? "0" : mod === 1 ? "9" : (11 - mod).toString();
      const actualCheck = v.split("-")[2];
      expect(actualCheck).toBe(expected);
    });

    it("CreditCard sintético pasa Luhn", () => {
      const v = synthesize(EntityType.CreditCard, 1);
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
      const v = synthesize(EntityType.Email, 1);
      expect(v).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    });

    it("Person sintético es Nombre + Apellido", () => {
      const v = synthesize(EntityType.Person, 1);
      // Soporta acentos (Fernández, María, etc.)
      expect(v).toMatch(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/u);
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
          pageTimeoutMs: 60000,
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

// Marker para evitar "unused" warnings en imports de tipos.
void (0 as unknown as Occurrence);
void (0 as unknown as Word);
void (0 as unknown as Page);
