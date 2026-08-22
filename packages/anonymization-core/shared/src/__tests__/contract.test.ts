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
  AnnotationKind,
  AVG_GLYPH_ADVANCE_RATIO,
  CancelledError,
  DEGRADED_FONT_RATIO,
  DetectionSource,
  EngineDisposedError,
  EngineError,
  EngineErrorCode,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
  estimateTokenWidth,
  EventChannel,
  InvalidInputError,
  isEngineErrorCode,
  WorkerCrashedError,
  makeTransferable,
  MAX_RENDER_SCALE,
  normalizeForComparison,
  PREVIEW_CACHE_MAX_BYTES,
  REPLACEMENT_FONT_HEIGHT_RATIO,
  ReplacementMode,
  sharesVerticalBand,
  synthesize,
  wordsInRect,
} from "../index.js";
import { isTransferable } from "../index.js";
import type {
  Annotation,
  BoundingBox,
  CoreRuntimeOptions,
  Document,
  EncodedPageImage,
  EngineConfig,
  EngineContext,
  EntityGroup,
  EntityGroupCreated,
  ExportOptions,
  ExportRequested,
  ExportSavePayload,
  GroupUpdateRequested,
  ICache,
  IEngine,
  IEventBus,
  ILogger,
  ManualEntityRequest,
  MarkerLegendEntry,
  MarkerLegendRow,
  Occurrence,
  OccurrenceRef,
  OcrRegion,
  Page,
  PageParsed,
  PersonGender,
  PersonGenderChoice,
  PreviewUpdated,
  RenderLegendPayload,
  RenderPagePayload,
  RenderRequested,
  Replacement,
  TextMatch,
  Word,
  WorkerFactory,
  WorkerLike,
  WorkerOutbound,
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

  describe("AnnotationKind.Degraded (ADR-058 §7)", () => {
    it("existe con el string 'degraded'", () => {
      expect(AnnotationKind.Degraded).toBe("degraded");
    });

    it("convive con los 4 kinds previos sin reemplazarlos", () => {
      expect(AnnotationKind.Highlight).toBe("highlight");
      expect(AnnotationKind.Replacement).toBe("replacement");
      expect(AnnotationKind.Redact).toBe("redact");
      expect(AnnotationKind.Conflict).toBe("conflict");
      expect(Object.values(AnnotationKind).sort()).toEqual(
        ["highlight", "replacement", "redact", "conflict", "degraded"].sort(),
      );
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
        // Generic (5)
        "ENGINE_NOT_INITIALIZED",
        "ENGINE_DISPOSED",
        "INVALID_INPUT",
        "CANCELLED",
        "WORKER_CRASHED", // ADR-077
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

    it("WorkerCrashedError tiene code WORKER_CRASHED y es retryable", () => {
      // ADR-077: `retryable: true` es la única razón de ser de la clase — el
      // worker de reemplazo arranca limpio, así que reintentar el mismo
      // payload es exactamente el caso de uso del backoff del pool.
      const err = new WorkerCrashedError("crash", { poolKey: "render", slot: 0 });
      expect(err.code).toBe(EngineErrorCode.WORKER_CRASHED);
      expect(err.engineId).toBe("core");
      expect(err.retryable).toBe(true);
      expect(err.details).toEqual({ poolKey: "render", slot: 0 });
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

    describe("isEngineErrorCode (ADR-049 §3)", () => {
      it("discrimina un error que YA cruzó el boundary, que es su única razón de ser", () => {
        // El caso que importa: `deserialize` devuelve siempre un
        // `DeserializedEngineError`, así que `instanceof InvalidInputError`
        // da `false` acá — y ese `false` es el bug que este helper existe
        // para evitar. Los tests que inyectan la subclase concreta no lo ven.
        const reconstructed = EngineError.deserialize(new InvalidInputError("test").serialize());

        expect(reconstructed instanceof InvalidInputError).toBe(false);
        expect(isEngineErrorCode(reconstructed, EngineErrorCode.INVALID_INPUT)).toBe(true);
      });

      it("distingue por code, no por ser un EngineError cualquiera", () => {
        const err = new InvalidInputError("test");
        expect(isEngineErrorCode(err, EngineErrorCode.INVALID_INPUT)).toBe(true);
        expect(isEngineErrorCode(err, EngineErrorCode.RENDER_FAILED)).toBe(false);
      });

      it("un Error que no es del Core nunca matchea", () => {
        expect(isEngineErrorCode(new Error("suelto"), EngineErrorCode.INVALID_INPUT)).toBe(false);
        expect(isEngineErrorCode(null, EngineErrorCode.INVALID_INPUT)).toBe(false);
        expect(
          isEngineErrorCode({ code: EngineErrorCode.INVALID_INPUT }, EngineErrorCode.INVALID_INPUT),
        ).toBe(false);
      });
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
        replacementValueUserSet: false,
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

    it("OcrRegion tiene pageIndex y bbox readonly (compile-time, ADR-065 §4)", () => {
      const region: OcrRegion = { pageIndex: 0, bbox: { x: 0, y: 0, width: 100, height: 50 } };
      const mutate = (): void => {
        // @ts-expect-error — pageIndex es readonly (ADR-008); assert de compile-time
        region.pageIndex = 1;
      };
      void mutate;
      expect(region.pageIndex).toBe(0);
    });
  });

  describe("EntityGroup.personGender (ADR-060 §2)", () => {
    const baseGroup: EntityGroup = {
      id: "g1",
      type: EntityType.Person,
      canonicalValue: "Juan Pérez",
      members: [],
      replacementMode: ReplacementMode.Placeholder,
      replacementValue: "[PERSONA 01]",
      indexInType: 1,
      enabled: true,
      aliases: ["Juan Pérez"],
      replacementValueUserSet: false,
      createdAt: 0,
      updatedAt: 0,
    };

    it("es opcional: un EntityGroup sin personGender sigue siendo válido (sin determinar)", () => {
      const group: EntityGroup = baseGroup;
      expect(group.personGender).toBeUndefined();
    });

    it("acepta los dos valores del léxico: 'f' y 'm'", () => {
      const female: EntityGroup = { ...baseGroup, personGender: "f" };
      const male: EntityGroup = { ...baseGroup, personGender: "m" };
      expect(female.personGender).toBe("f");
      expect(male.personGender).toBe("m");
      const values: ReadonlyArray<PersonGender> = ["f", "m"];
      expect(values).toEqual(["f", "m"]);
    });

    it("es readonly (compile-time, ADR-008)", () => {
      const group: EntityGroup = { ...baseGroup, personGender: "f" };
      const mutate = (): void => {
        // @ts-expect-error — personGender es readonly (ADR-008); assert de compile-time
        group.personGender = "m";
      };
      void mutate;
      expect(group.personGender).toBe("f");
    });

    it("EntityGroup con personGender sigue cumpliendo la inmutabilidad general de ADR-008 (aliases sigue siendo ReadonlyArray)", () => {
      const group: EntityGroup = { ...baseGroup, personGender: "f" };
      const mutate = (): void => {
        // @ts-expect-error — ReadonlyArray<string> no expone push (ADR-008)
        group.aliases.push("Juancito");
      };
      void mutate;
      expect(group.aliases).toEqual(["Juan Pérez"]);
    });

    it("no amplía su forma a PersonGenderChoice: 'neutral' no es un valor almacenable (ADR-069 §4)", () => {
      const group = (): EntityGroup => ({
        ...baseGroup,
        // @ts-expect-error — EntityGroup.personGender sigue siendo PersonGender ("f" | "m" | ausente); "neutral" no se almacena, es solo el valor de tránsito del patch (ADR-069 §4)
        personGender: "neutral",
      });
      void group;
    });
  });

  describe("PersonGenderChoice (ADR-069 §4)", () => {
    it("admite exactamente 'f' | 'm' | 'neutral'", () => {
      const values: ReadonlyArray<PersonGenderChoice> = ["f", "m", "neutral"];
      expect(values).toEqual(["f", "m", "neutral"]);

      const assertNoFourthValue = (): void => {
        // @ts-expect-error — PersonGenderChoice no admite un cuarto valor arbitrario; assert de compile-time
        const invalid: PersonGenderChoice = "other";
        void invalid;
      };
      void assertNoFourthValue;
    });

    it("GroupUpdateRequested.patch.personGender acepta los tres valores del selector y sigue readonly (ADR-069 §4)", () => {
      const female: GroupUpdateRequested = {
        documentId: "d1",
        groupId: "g1",
        patch: { personGender: "f" },
      };
      const male: GroupUpdateRequested = {
        documentId: "d1",
        groupId: "g1",
        patch: { personGender: "m" },
      };
      const neutral: GroupUpdateRequested = {
        documentId: "d1",
        groupId: "g1",
        patch: { personGender: "neutral" },
      };
      expect(female.patch.personGender).toBe("f");
      expect(male.patch.personGender).toBe("m");
      expect(neutral.patch.personGender).toBe("neutral");

      const mutate = (): void => {
        // @ts-expect-error — patch.personGender es readonly (ADR-008); assert de compile-time
        female.patch.personGender = "m";
      };
      void mutate;
    });

    it("GroupUpdateRequested.patch sigue aceptando los otros campos junto con personGender", () => {
      const payload: GroupUpdateRequested = {
        documentId: "d1",
        groupId: "g1",
        patch: { replacementMode: ReplacementMode.Mask, personGender: "neutral" },
      };
      expect(payload.patch.replacementMode).toBe(ReplacementMode.Mask);
      expect(payload.patch.personGender).toBe("neutral");
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
        replacementValueUserSet: false,
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

    it("RenderRequested.scale es opcional y viaja como escala absoluta pdfjs (ADR-037 §1)", () => {
      const withoutScale: RenderRequested = {
        documentId: "d1",
        pageIndices: [0, 1],
        mode: "preview",
        kind: "original",
      };
      const withScale: RenderRequested = {
        documentId: "d1",
        pageIndices: [0],
        mode: "preview",
        kind: "anonymized",
        scale: 2.5,
      };
      expect(withoutScale.scale).toBeUndefined();
      expect(withScale.scale).toBe(2.5);
    });

    it("RenderRequested.kind es requerido (ADR-056 §1)", () => {
      const payload: RenderRequested = {
        documentId: "d1",
        pageIndices: [0],
        mode: "preview",
        kind: "original",
      };
      expect(payload.kind).toBe("original");
      // @ts-expect-error ADR-056 §1: kind es requerido, no admite omitirse.
      const missingKind: RenderRequested = {
        documentId: "d1",
        pageIndices: [0],
        mode: "preview",
      };
      expect(missingKind).toBeDefined();
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
          includeMarkerLegend: false,
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

  describe("Constantes nombradas (ADR-037 §2/§3)", () => {
    it("MAX_RENDER_SCALE es 4 (Contracts.md §6)", () => {
      expect(MAX_RENDER_SCALE).toBe(4);
    });

    it("PREVIEW_CACHE_MAX_BYTES es 200 MB (Contracts.md §6)", () => {
      expect(PREVIEW_CACHE_MAX_BYTES).toBe(200 * 1024 * 1024);
    });
  });

  describe("Constantes de la escalera de abreviaturas y degradación (ADR-057 §5, ADR-058 §7)", () => {
    it("REPLACEMENT_FONT_HEIGHT_RATIO es 0.7 (Contracts.md §6)", () => {
      expect(REPLACEMENT_FONT_HEIGHT_RATIO).toBe(0.7);
    });

    it("AVG_GLYPH_ADVANCE_RATIO es 0.6 (Contracts.md §6)", () => {
      expect(AVG_GLYPH_ADVANCE_RATIO).toBe(0.6);
    });

    // ADR-086 §3: bajó de 0.6 a 0.5 cuando el criterio pasó a medir el ancho.
    // No es un ajuste fino del mismo número: el 0.6 medía el encogido vertical
    // de la fuente y el 0.5 mide cuánto se aplastó el texto a lo ancho. Con el
    // valor viejo, el criterio nuevo marcaría `[PERSONA 01]` en una caja
    // apretada (0.579) — un placeholder que se lee perfecto.
    it("DEGRADED_FONT_RATIO es 0.5 (Contracts.md §6, ADR-086 §3)", () => {
      expect(DEGRADED_FONT_RATIO).toBe(0.5);
    });
  });

  describe("estimateTokenWidth (ADR-057 §5, §9)", () => {
    it("es determinista: mismo (charCount, boxHeight) → mismo resultado", () => {
      const a = estimateTokenWidth(8, 12);
      const b = estimateTokenWidth(8, 12);
      expect(a).toBe(b);
    });

    it("es monótona no decreciente en charCount, a boxHeight fijo", () => {
      const boxHeight = 14;
      const widths = [0, 1, 2, 3, 5, 8, 13, 21].map((charCount) =>
        estimateTokenWidth(charCount, boxHeight),
      );
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] as number);
      }
    });

    it("es monótona no decreciente en boxHeight, a charCount fijo", () => {
      const charCount = 7;
      const widths = [0, 2, 4, 8, 10, 16, 24, 40].map((boxHeight) =>
        estimateTokenWidth(charCount, boxHeight),
      );
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1] as number);
      }
    });

    it("charCount=0 da ancho 0, independientemente de boxHeight", () => {
      expect(estimateTokenWidth(0, 12)).toBe(0);
      expect(estimateTokenWidth(0, 999)).toBe(0);
    });

    it("boxHeight=0 da ancho 0, independientemente de charCount", () => {
      expect(estimateTokenWidth(11, 0)).toBe(0);
    });

    it("aplica la fórmula exacta del ADR: charCount * (boxHeight * REPLACEMENT_FONT_HEIGHT_RATIO) * AVG_GLYPH_ADVANCE_RATIO", () => {
      const charCount = 11; // "[PERSONA 01]"
      const boxHeight = 12;
      const expected =
        charCount * (boxHeight * REPLACEMENT_FONT_HEIGHT_RATIO) * AVG_GLYPH_ADVANCE_RATIO;
      // toBeCloseTo, no toBe: la asociatividad de la multiplicación de punto
      // flotante no es exacta bit a bit entre esta expresión y la de la
      // implementación aunque sean la misma fórmula matemática.
      expect(estimateTokenWidth(charCount, boxHeight)).toBeCloseTo(expected, 10);
    });
  });

  describe("synthesize", () => {
    // Los tipos que SORTEAN, o sea todos menos Custom y el fallback, que
    // interpolan indexInType en vez de sortear (ADR-072 §3).
    const DRAWN_TYPES = [
      EntityType.DNI,
      EntityType.CUIT,
      EntityType.Phone,
      EntityType.Email,
      EntityType.IBAN,
      EntityType.CreditCard,
      EntityType.Date,
      EntityType.Person,
      EntityType.Organization,
      EntityType.Address,
      EntityType.License,
      EntityType.Plate,
    ] as const;

    const FEMALE_NAMES = ["María", "Ana", "Laura", "Sofía", "Elena", "Patricia", "Claudia"];
    const MALE_NAMES = [
      "Carlos",
      "Juan",
      "José",
      "Pedro",
      "Diego",
      "Andrés",
      "Fernando",
      "Ricardo",
    ];

    it("es determinista: mismo (type, groupId, seed) → mismo valor", () => {
      const req = { type: EntityType.DNI, groupId: "g-1", seed: "seed-x", indexInType: 1 };
      expect(synthesize(req)).toBe(synthesize(req));
    });

    it("diferentes seeds generan (casi siempre) diferentes valores", () => {
      const a = synthesize({
        type: EntityType.DNI,
        groupId: "g-1",
        seed: "seed-a",
        indexInType: 1,
      });
      const b = synthesize({
        type: EntityType.DNI,
        groupId: "g-1",
        seed: "seed-b",
        indexInType: 1,
      });
      // No garantiza 100% colisión cero por espacio finito, pero para tests alcanzamos !=.
      expect(a).not.toBe(b);
    });

    it("diferentes groupId generan (casi siempre) diferentes valores", () => {
      const a = synthesize({
        type: EntityType.DNI,
        groupId: "g-1",
        seed: "seed-x",
        indexInType: 1,
      });
      const b = synthesize({
        type: EntityType.DNI,
        groupId: "g-2",
        seed: "seed-x",
        indexInType: 1,
      });
      expect(a).not.toBe(b);
    });

    // ADR-072 §1, el test que define ese ADR: la semilla es la IDENTIDAD del
    // grupo, no su número. Sin esto, renumerar (ADR-028) o agregar una entidad
    // a mano (ADR-061) cambiaba el nombre falso de una persona que nadie tocó.
    it("cambiar indexInType con el mismo groupId NO cambia el valor (ADR-072 §1)", () => {
      for (const type of DRAWN_TYPES) {
        const base = { type, groupId: "g-estable", seed: "seed-072" };
        const conIndice3 = synthesize({ ...base, indexInType: 3 });
        const conIndice4 = synthesize({ ...base, indexInType: 4 });
        expect(conIndice4, `${type} cambió al renumerarse`).toBe(conIndice3);
      }
    });

    // ADR-072 §3: la contracara declarada. Custom interpola el número.
    it("Custom SÍ sigue el indexInType (ADR-072 §3)", () => {
      const base = { type: EntityType.Custom, groupId: "g-1", seed: "seed-x" };
      expect(synthesize({ ...base, indexInType: 3 })).toBe("custom-3");
      expect(synthesize({ ...base, indexInType: 4 })).toBe("custom-4");
    });

    it("DNI sintético tiene formato XX.XXX.XXX y no arranca en 0", () => {
      const v = synthesize({
        type: EntityType.DNI,
        groupId: "g-1",
        seed: "seed-dni",
        indexInType: 1,
      });
      expect(v).toMatch(/^\d{2}\.\d{3}\.\d{3}$/);
      expect(v.startsWith("0")).toBe(false);
    });

    it("CUIT sintético pasa el validador AFIP de dominio", () => {
      const v = synthesize({
        type: EntityType.CUIT,
        groupId: "g-1",
        seed: "seed-cuit",
        indexInType: 1,
      });
      expect(v).toMatch(/^\d{2}-\d{8}-\d$/);
      expect(isValidCuit(v)).toBe(true);
    });

    it("CUITs de 200 groupId distintos son todos válidos (nunca dv 10)", () => {
      for (let i = 1; i <= 200; i++) {
        const v = synthesize({
          type: EntityType.CUIT,
          groupId: `g-${i}`,
          seed: "seed-masivo",
          indexInType: i,
        });
        expect(isValidCuit(v), `CUIT inválido en groupId g-${i}: ${v}`).toBe(true);
      }
    });

    it("License sintético respeta el formato XX-XXXX-XX (ADR-012)", () => {
      const v = synthesize({
        type: EntityType.License,
        groupId: "g-1",
        seed: "seed-lic",
        indexInType: 1,
      });
      expect(v).toMatch(/^\d{2}-\d{4}-\d{2}$/);
    });

    it("CreditCard sintético pasa Luhn", () => {
      const v = synthesize({
        type: EntityType.CreditCard,
        groupId: "g-1",
        seed: "seed-cc",
        indexInType: 1,
      });
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
      const v = synthesize({
        type: EntityType.Email,
        groupId: "g-1",
        seed: "seed-email",
        indexInType: 1,
      });
      expect(v).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    });

    it("Person sintético es Nombre + Apellido", () => {
      const v = synthesize({
        type: EntityType.Person,
        groupId: "g-1",
        seed: "seed-person",
        indexInType: 1,
      });
      // Soporta acentos (Fernández, María, etc.)
      expect(v).toMatch(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/u);
    });

    // ADR-071 §5. Se barren 40 groupId para cubrir los dos pools enteros: de
    // paso, esto falla si alguno quedara vacío (`pick` lanza).
    it("personGender filtra el pool de nombres de pila (ADR-071 §5)", () => {
      for (let i = 0; i < 40; i++) {
        const base = { type: EntityType.Person, groupId: `g-${i}`, seed: "seed-genero" };

        const femenino = synthesize({ ...base, indexInType: 1, personGender: "f" });
        expect(FEMALE_NAMES, `femenino inesperado: ${femenino}`).toContain(
          femenino.split(" ")[0] ?? "",
        );

        const masculino = synthesize({ ...base, indexInType: 1, personGender: "m" });
        expect(MALE_NAMES, `masculino inesperado: ${masculino}`).toContain(
          masculino.split(" ")[0] ?? "",
        );
      }
    });

    // ADR-071 §5, no-regresión anclada a ADR-072. El enunciado del ADR era
    // "personGender ausente ≡ el mismo valor que sin el campo", que con
    // `exactOptionalPropertyTypes: true` no se puede ni escribir —pasar
    // `personGender: undefined` no compila— y sería una tautología. La
    // propiedad que sí hay que proteger es ésta: **sin género se sortea del
    // pool COMPLETO**, o sea que el caso neutro no quedó filtrado por
    // accidente y se comporta como antes de ADR-071.
    it("sin personGender se sortea del pool completo, no de uno filtrado (ADR-071 §5)", () => {
      const nombres = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const v = synthesize({
          type: EntityType.Person,
          groupId: `g-${i}`,
          seed: "seed-sin-genero",
          indexInType: 1,
        });
        nombres.add(v.split(" ")[0] ?? "");
      }
      expect([...nombres].some((n) => FEMALE_NAMES.includes(n))).toBe(true);
      expect([...nombres].some((n) => MALE_NAMES.includes(n))).toBe(true);
    });

    it("es determinista con personGender: mismo input → mismo valor", () => {
      const req = {
        type: EntityType.Person,
        groupId: "g-1",
        seed: "seed-x",
        indexInType: 1,
        personGender: "f",
      } as const;
      expect(synthesize(req)).toBe(synthesize(req));
    });

    // El género NO entra a la semilla (ADR-071 §5): solo elige de qué array
    // sortea `pick`. Sobre un tipo que no mira el campo, no puede cambiar nada.
    it("personGender no altera tipos distintos de Person", () => {
      const base = {
        type: EntityType.DNI,
        groupId: "g-1",
        seed: "seed-x",
        indexInType: 1,
      } as const;
      expect(synthesize({ ...base, personGender: "f" })).toBe(synthesize(base));
      expect(synthesize({ ...base, personGender: "m" })).toBe(synthesize(base));
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

    // ADR-074 §1: los tres tipos aceptan `fragments` ausente (compila sin el
    // campo, mismo patrón que `rotation`/`maskFormat` — `exactOptionalPropertyTypes`
    // impide escribir `fragments: undefined` explícito, así que la prueba de
    // "ausente" es no incluir la key, no asignarle undefined) y presente.
    it("Occurrence, OccurrenceRef y Replacement aceptan fragments ausente y presente (ADR-074 §1)", () => {
      const bboxA: BoundingBox = { x: 500, y: 100, width: 40, height: 12 };
      const bboxB: BoundingBox = { x: 10, y: 118, width: 90, height: 12 };
      const envelope: BoundingBox = { x: 10, y: 100, width: 530, height: 30 };

      const occurrenceWithoutFragments: Occurrence = {
        id: "o1",
        value: "Juan Pérez",
        normalizedValue: "juan perez",
        bbox: envelope,
        pageIndex: 0,
        source: DetectionSource.NER,
        confidence: 0.93,
        entityType: EntityType.Person,
      };
      expect(occurrenceWithoutFragments.fragments).toBeUndefined();

      const occurrenceWithFragments: Occurrence = {
        ...occurrenceWithoutFragments,
        fragments: [bboxA, bboxB],
      };
      expect(occurrenceWithFragments.fragments).toEqual([bboxA, bboxB]);

      const refWithoutFragments: OccurrenceRef = {
        occurrenceId: "o1",
        pageIndex: 0,
        bbox: envelope,
        source: DetectionSource.NER,
      };
      expect(refWithoutFragments.fragments).toBeUndefined();

      const refWithFragments: OccurrenceRef = { ...refWithoutFragments, fragments: [bboxA, bboxB] };
      expect(refWithFragments.fragments).toEqual([bboxA, bboxB]);

      const replacementWithoutFragments: Replacement = {
        groupId: "g1",
        occurrenceId: "o1",
        pageIndex: 0,
        bbox: envelope,
        originalValue: "Juan Pérez",
        replacementValue: "[PERSONA 01]",
        mode: ReplacementMode.Placeholder,
      };
      expect(replacementWithoutFragments.fragments).toBeUndefined();

      const replacementWithFragments: Replacement = {
        ...replacementWithoutFragments,
        fragments: [bboxA, bboxB],
      };
      expect(replacementWithFragments.fragments).toEqual([bboxA, bboxB]);
    });

    it("EncodedPageImage tipa bytes/format/dimensiones (ADR-034 §3)", () => {
      const encoded: EncodedPageImage = {
        bytes: new Uint8Array([1, 2, 3]).buffer,
        format: "jpeg",
        widthPx: 100,
        heightPx: 200,
      };
      expect(encoded.format).toBe("jpeg");
      expect(encoded.bytes.byteLength).toBe(3);
    });
  });

  describe("wordsInRect (ADR-061 §4)", () => {
    const wordHola: Word = {
      text: "Hola",
      bbox: { x: 0, y: 0, width: 40, height: 10 },
      pageIndex: 0,
      confidence: 1,
      source: "pdf",
    };
    const wordMundo: Word = {
      text: "Mundo",
      bbox: { x: 50, y: 0, width: 40, height: 10 },
      pageIndex: 0,
      confidence: 1,
      source: "pdf",
    };
    const wordOtraLinea: Word = {
      text: "Otra",
      bbox: { x: 0, y: 20, width: 40, height: 10 },
      pageIndex: 0,
      confidence: 1,
      source: "pdf",
    };
    const words: ReadonlyArray<Word> = [wordHola, wordMundo, wordOtraLinea];

    describe("Unit", () => {
      it("es pura: mismo input produce el mismo resultado y no muta `words`", () => {
        const rect: BoundingBox = { x: 0, y: 0, width: 40, height: 10 };
        const a = wordsInRect(words, rect);
        const b = wordsInRect(words, rect);
        expect(a).toEqual(b);
        expect(words).toHaveLength(3);
        expect(words[0]).toBe(wordHola);
        expect(words[1]).toBe(wordMundo);
        expect(words[2]).toBe(wordOtraLinea);
      });

      it("devuelve las palabras cuyo bbox intersecta la región, y ninguna otra", () => {
        // Cubre "Hola" y "Mundo" (misma línea), no "Otra" (línea distinta).
        const rect: BoundingBox = { x: 0, y: 0, width: 100, height: 10 };
        const result = wordsInRect(words, rect);
        expect(result).toEqual([wordHola, wordMundo]);
        // Son las mismas referencias, no copias: filtrado puro, sin clonar.
        expect(result[0]).toBe(wordHola);
        expect(result[1]).toBe(wordMundo);
      });

      it("preserva el orden original de `words`", () => {
        const rect: BoundingBox = { x: 0, y: 0, width: 200, height: 40 }; // cubre las tres
        expect(wordsInRect(words, rect)).toEqual([wordHola, wordMundo, wordOtraLinea]);
      });

      it("un rect que no toca ninguna palabra devuelve []", () => {
        const rect: BoundingBox = { x: 500, y: 500, width: 10, height: 10 };
        expect(wordsInRect(words, rect)).toEqual([]);
      });

      it("ignora el `rotation` del bbox: no cambia la geometría (ADR-066 §6)", () => {
        const rotatedWord: Word = { ...wordHola, bbox: { ...wordHola.bbox, rotation: 90 } };
        const rect: BoundingBox = { x: 0, y: 0, width: 40, height: 10, rotation: 180 };
        expect(wordsInRect([rotatedWord], rect)).toEqual([rotatedWord]);
      });
    });

    describe("Edge", () => {
      it("región vacía (width=0) no matchea nada, incluso cayendo dentro de una palabra", () => {
        const rect: BoundingBox = { x: 10, y: 5, width: 0, height: 0 };
        expect(wordsInRect(words, rect)).toEqual([]);
      });

      it("región vacía (height=0) no matchea nada", () => {
        const rect: BoundingBox = { x: 10, y: 5, width: 10, height: 0 };
        expect(wordsInRect(words, rect)).toEqual([]);
      });

      it("región fuera de la página no matchea nada", () => {
        const rect: BoundingBox = { x: 1000, y: 1000, width: 50, height: 50 };
        expect(wordsInRect(words, rect)).toEqual([]);
      });

      it("región que corta una palabra por la mitad la incluye igual", () => {
        // Mitad izquierda de "Hola" (bbox completo: x 0..40).
        const rect: BoundingBox = { x: 0, y: 0, width: 20, height: 10 };
        expect(wordsInRect(words, rect)).toEqual([wordHola]);
      });

      it("región que solo toca el borde, sin área compartida, no matchea", () => {
        // Arranca exactamente donde termina "Hola" (x=40): sin solapamiento real.
        const rect: BoundingBox = { x: 40, y: 0, width: 10, height: 10 };
        expect(wordsInRect(words, rect)).toEqual([]);
      });

      it("lista de palabras vacía siempre devuelve []", () => {
        const rect: BoundingBox = { x: 0, y: 0, width: 1000, height: 1000 };
        expect(wordsInRect([], rect)).toEqual([]);
      });
    });
  });

  describe("sharesVerticalBand (ADR-061 §2 errata)", () => {
    it("es simétrica y da true ante cualquier solapamiento en Y, sin umbral de proporción", () => {
      // Solapamiento mínimo: 1 unidad de Y en común.
      const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
      const bMinimal: BoundingBox = { x: 0, y: 9, width: 10, height: 10 };
      expect(sharesVerticalBand(a, bMinimal)).toBe(true);
      expect(sharesVerticalBand(bMinimal, a)).toBe(true);

      // Solapamiento total: mismo rango de Y.
      const bTotal: BoundingBox = { x: 50, y: 0, width: 10, height: 10 };
      expect(sharesVerticalBand(a, bTotal)).toBe(true);
      expect(sharesVerticalBand(bTotal, a)).toBe(true);
    });

    it("bandas que apenas se tocan por el borde exacto dan false (solapamiento estricto, no adyacencia)", () => {
      const a: BoundingBox = { x: 0, y: 0, width: 10, height: 10 };
      // b arranca exactamente donde termina a (a.y + a.height === b.y).
      const b: BoundingBox = { x: 0, y: 10, width: 10, height: 10 };
      expect(sharesVerticalBand(a, b)).toBe(false);
      expect(sharesVerticalBand(b, a)).toBe(false);
    });
  });

  describe("normalizeForComparison (ADR-061 §2 errata)", () => {
    it("colapsa mayúsculas, diacríticos y espacios repetidos", () => {
      expect(normalizeForComparison("  José   PÉREZ ")).toBe(normalizeForComparison("jose perez"));
      expect(normalizeForComparison("  José   PÉREZ ")).toBe("jose perez");
    });

    it("string vacío y string de solo espacios dan '', sin lanzar", () => {
      expect(() => normalizeForComparison("")).not.toThrow();
      expect(normalizeForComparison("")).toBe("");
      expect(() => normalizeForComparison("   ")).not.toThrow();
      expect(normalizeForComparison("   ")).toBe("");
    });
  });

  describe("ManualEntityRequest (ADR-061 §3/§6)", () => {
    it("tipa value y entityType", () => {
      const req: ManualEntityRequest = { value: "José Pérez", entityType: EntityType.Person };
      expect(req.value).toBe("José Pérez");
      expect(req.entityType).toBe(EntityType.Person);
    });

    it("es readonly (compile-time, ADR-008)", () => {
      const req: ManualEntityRequest = { value: "x", entityType: EntityType.DNI };
      const mutate = (): void => {
        // @ts-expect-error — value es readonly (ADR-008); assert de compile-time
        req.value = "y";
      };
      void mutate;
      expect(req.value).toBe("x");
    });
  });

  describe("TextMatch (ADR-061 §8)", () => {
    it("tipa pageIndex/bbox/text/wordSpan", () => {
      const match: TextMatch = {
        pageIndex: 2,
        bbox: { x: 10, y: 20, width: 30, height: 12 },
        text: "José Pérez",
        wordSpan: { startIndex: 4, endIndexExclusive: 6 },
      };
      expect(match.pageIndex).toBe(2);
      expect(match.text).toBe("José Pérez");
      expect(match.wordSpan.startIndex).toBe(4);
      expect(match.wordSpan.endIndexExclusive).toBe(6);
    });

    it("es readonly (compile-time, ADR-008)", () => {
      const match: TextMatch = {
        pageIndex: 0,
        bbox: { x: 0, y: 0, width: 10, height: 10 },
        text: "x",
        wordSpan: { startIndex: 0, endIndexExclusive: 1 },
      };
      const mutate = (): void => {
        // @ts-expect-error — pageIndex es readonly (ADR-008); assert de compile-time
        match.pageIndex = 1;
      };
      void mutate;
      expect(match.pageIndex).toBe(0);
    });
  });

  describe("RenderPagePayload.lineWords (ADR-058 §5)", () => {
    const baseWord: Word = {
      text: "Pérez",
      bbox: { x: 40, y: 100, width: 30, height: 10 },
      pageIndex: 0,
      confidence: 1,
      source: "pdf",
    };

    it("es opcional: un payload sin lineWords sigue siendo válido (caso normal, ADR-058 §5)", () => {
      const payload: RenderPagePayload = {
        documentId: "d1",
        pageIndex: 0,
        kind: "anonymized",
        mode: "full",
      };
      expect(payload.lineWords).toBeUndefined();
    });

    it("acepta un ReadonlyArray<Word>, incluidas palabras de OCR (source: 'ocr')", () => {
      const ocrWord: Word = { ...baseWord, source: "ocr" };
      const payload: RenderPagePayload = {
        documentId: "d1",
        pageIndex: 0,
        kind: "anonymized",
        mode: "full",
        lineWords: [baseWord, ocrWord],
      };
      expect(payload.lineWords).toHaveLength(2);
      expect(payload.lineWords?.[1]?.source).toBe("ocr");
    });
  });

  describe("Leyenda de marcadores del export (ADR-059 §3, §5)", () => {
    it("MarkerLegendEntry tipa type/prefixes/markerCount", () => {
      const entry: MarkerLegendEntry = {
        type: EntityType.Person,
        prefixes: ["PERSONA", "PERS", "PRS"],
        markerCount: 7,
      };
      expect(entry.markerCount).toBe(7);
      expect(entry.prefixes).toContain("PRS");
    });

    it("MarkerLegendEntry no transporta ningún campo capaz de llevar contenido del documento (ADR-059 §3)", () => {
      const entry: MarkerLegendEntry = {
        type: EntityType.DNI,
        prefixes: ["DNI"],
        markerCount: 3,
      };
      // Garantía por tipos: las únicas claves posibles son type/prefixes/markerCount.
      // Ni canonicalValue, ni originalValue, ni Document caben en este tipo.
      expect(Object.keys(entry).sort()).toEqual(["markerCount", "prefixes", "type"]);
    });

    it("MarkerLegendRow son strings ya compuestos, sin EntityType ni EntityGroup (ADR-059 §5)", () => {
      const row: MarkerLegendRow = {
        prefixes: "PERSONA, PERS, PRS",
        typeName: "Persona",
        countLabel: "7 marcadores",
      };
      expect(typeof row.prefixes).toBe("string");
      expect(typeof row.typeName).toBe("string");
      expect(typeof row.countLabel).toBe("string");
    });

    it("RenderLegendPayload no lleva documentId — no corresponde a ninguna página de ningún PDF (ADR-059 §5)", () => {
      const row: MarkerLegendRow = {
        prefixes: "DNI",
        typeName: "DNI",
        countLabel: "3 marcadores",
      };
      const payload: RenderLegendPayload = {
        rows: [row],
        pageWidthPt: 595,
        pageHeightPt: 842,
      };
      expect(payload.rows).toHaveLength(1);
      expect("documentId" in payload).toBe(false);
    });

    it("RenderLegendPayload.imageFormat es opcional", () => {
      const payload: RenderLegendPayload = {
        rows: [],
        pageWidthPt: 595,
        pageHeightPt: 842,
        imageFormat: "png",
      };
      expect(payload.imageFormat).toBe("png");
    });
  });

  describe("ExportSavePayload extendido con la leyenda (ADR-059 §6)", () => {
    it("legendImage/legendPageWidthPt/legendPageHeightPt son opcionales (caso sin leyenda)", () => {
      const payload: ExportSavePayload = {
        documentId: "d1",
        metadata: {
          producer: "Anonly",
          creator: "Anonly",
          creationDate: new Date(0),
        },
      };
      expect(payload.legendImage).toBeUndefined();
      expect(payload.legendPageWidthPt).toBeUndefined();
      expect(payload.legendPageHeightPt).toBeUndefined();
    });

    it("acepta legendImage ya rasterizada junto a sus dimensiones en puntos PDF", () => {
      const legendImage: EncodedPageImage = {
        bytes: new Uint8Array([9, 9]).buffer,
        format: "png",
        widthPx: 595,
        heightPx: 842,
      };
      const payload: ExportSavePayload = {
        documentId: "d1",
        metadata: {
          producer: "Anonly",
          creator: "Anonly",
          creationDate: new Date(0),
        },
        legendImage,
        legendPageWidthPt: 595,
        legendPageHeightPt: 842,
      };
      expect(payload.legendImage?.format).toBe("png");
      expect(payload.legendPageWidthPt).toBe(595);
      expect(payload.legendPageHeightPt).toBe(842);
    });
  });

  describe("ExportOptions.includeMarkerLegend (ADR-059 §1)", () => {
    it("default documentado es false y el campo es requerido, no opcional", () => {
      const options: ExportOptions = {
        imageFormat: "png",
        jpegQuality: 0.85,
        dpi: 150,
        includeOriginalMetadata: false,
        filename: "anonimizado.pdf",
        includeMarkerLegend: false,
      };
      expect(options.includeMarkerLegend).toBe(false);
    });

    it("acepta true cuando el usuario pide la leyenda", () => {
      const options: ExportOptions = {
        imageFormat: "png",
        jpegQuality: 0.85,
        dpi: 150,
        includeOriginalMetadata: false,
        filename: "anonimizado.pdf",
        includeMarkerLegend: true,
      };
      expect(options.includeMarkerLegend).toBe(true);
    });

    it("es requerido: omitirlo no tipa (ADR-059 §1, campo no opcional)", () => {
      // @ts-expect-error ADR-059 §1: includeMarkerLegend es requerido, no admite omitirse.
      const missingFlag: ExportOptions = {
        imageFormat: "png",
        jpegQuality: 0.85,
        dpi: 150,
        includeOriginalMetadata: false,
        filename: "anonimizado.pdf",
      };
      expect(missingFlag).toBeDefined();
    });
  });

  describe("Transporte de Web Workers reales (Hito 10, ADR-036 §2/§3, Contracts.md §3.5)", () => {
    it("WorkerLike es estructural: un objeto plano con postMessage/addEventListener/terminate lo satisface", () => {
      const calls: string[] = [];
      const worker: WorkerLike = {
        postMessage: (message) => {
          calls.push(String(message));
        },
        addEventListener: () => {},
        terminate: () => {
          calls.push("terminate");
        },
      };
      worker.postMessage("x");
      worker.terminate();
      expect(calls).toEqual(["x", "terminate"]);
    });

    it("WorkerFactory es () => WorkerLike", () => {
      const factory: WorkerFactory = () => ({
        postMessage: () => {},
        addEventListener: () => {},
        terminate: () => {},
      });
      expect(typeof factory().postMessage).toBe("function");
    });

    it("CoreRuntimeOptions.workers admite un subconjunto parcial de los 5 WorkerEntryKind", () => {
      const stub: WorkerLike = {
        postMessage: () => {},
        addEventListener: () => {},
        terminate: () => {},
      };
      const runtime: CoreRuntimeOptions = {
        workers: {
          pdf: () => stub,
          export: () => stub,
        },
      };
      expect(Object.keys(runtime.workers ?? {}).sort()).toEqual(["export", "pdf"]);
    });

    it("CoreRuntimeOptions sin workers es válido (createCore in-process, comportamiento de hoy)", () => {
      const runtime: CoreRuntimeOptions = {};
      expect(runtime.workers).toBeUndefined();
    });

    it("WorkerOutbound admite la variante EVENT (ADR-036 §3)", () => {
      const message: WorkerOutbound = {
        type: "EVENT",
        channel: EventChannel.Pdf,
        event: EngineEvents.PAGE_PARSED,
        payload: { documentId: "d1", pageIndex: 0, wordCount: 1, requiresOCR: false },
      };
      expect(message.type).toBe("EVENT");
      expect(message.channel).toBe(EventChannel.Pdf);
      expect(message.event).toBe(EngineEvents.PAGE_PARSED);
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
          maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
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

  describe("PreviewUpdated.degraded (ADR-062 §1-§2)", () => {
    const anotacion: Annotation = {
      id: "occ-1",
      groupId: "g-1",
      pageIndex: 3,
      bbox: { x: 10, y: 20, width: 40, height: 12 },
      kind: AnnotationKind.Degraded,
    };

    // ADR-062 §2: el campo es opcional A PROPÓSITO, y no por descuido. Es lo
    // que permite que `shared` mergee antes que `render-engine` sin romperle
    // la compilación, o sea el split por módulo que R-1 exige.
    it("es opcional: un payload sin degraded sigue siendo válido", () => {
      const payload: PreviewUpdated = {
        documentId: "d1",
        pageIndex: 0,
        kind: "anonymized",
        canvasBlobUrl: "blob:x",
      };
      expect(payload.degraded).toBeUndefined();
    });

    it("acepta el campo poblado, y el elemento es un Annotation", () => {
      const payload: PreviewUpdated = {
        documentId: "d1",
        pageIndex: 3,
        kind: "anonymized",
        canvasBlobUrl: "blob:x",
        degraded: [anotacion],
      };
      expect(payload.degraded).toHaveLength(1);
      expect(payload.degraded?.[0]?.kind).toBe(AnnotationKind.Degraded);
      expect(payload.degraded?.[0]?.groupId).toBe("g-1");
    });

    // "Ausente ≡ vacío" (ADR-062 §2) es una regla del CONSUMIDOR, y lo que la
    // hace escribible es que las dos formas sean tipables. Si el vacío no
    // tipara, el emisor tendría que omitir el campo y `?? []` dejaría de ser
    // equivalente a leer el array.
    it("el array vacío es una forma válida, distinta de la ausencia solo en la forma", () => {
      const vacio: PreviewUpdated = {
        documentId: "d1",
        pageIndex: 0,
        kind: "anonymized",
        canvasBlobUrl: "blob:x",
        degraded: [],
      };
      const ausente: PreviewUpdated = {
        documentId: "d1",
        pageIndex: 0,
        kind: "anonymized",
        canvasBlobUrl: "blob:x",
      };
      expect(vacio.degraded ?? []).toEqual(ausente.degraded ?? []);
    });

    it("es de solo lectura: ni el array ni sus elementos se mutan (R-11)", () => {
      const payload: PreviewUpdated = {
        documentId: "d1",
        pageIndex: 0,
        kind: "anonymized",
        canvasBlobUrl: "blob:x",
        degraded: [anotacion],
      };
      // @ts-expect-error ADR-062 §1: `degraded` es ReadonlyArray, no admite push.
      payload.degraded?.push(anotacion);
      // @ts-expect-error R-11: todo dato público es readonly.
      payload.degraded = [];
      expect(payload.degraded).toBeDefined();
    });
  });
});
