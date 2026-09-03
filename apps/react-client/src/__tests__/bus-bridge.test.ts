import {
  AnnotationKind,
  ConflictReason,
  createEventBus,
  DetectionSource,
  EngineErrorCode,
  EngineEvents,
  EntityType,
  EventChannel,
  PipelineStage,
  ReplacementMode,
  type Annotation,
  type Conflict,
  type EntityGroup,
  type ILogger,
  type SerializedEngineError,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import { subscribe, subscribePasswordRequired, type Stores } from "../core-adapter/bus-bridge.js";
import { selectGroupIsDegraded, useDegradedStore } from "../store/degraded.store.js";
import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useSettingsStore } from "../store/settings.store.js";
import { useViewerStore } from "../store/viewer.store.js";

function createTestLogger(): ILogger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

const stores: Stores = {
  document: useDocumentStore,
  entities: useEntitiesStore,
  rules: useRulesStore,
  pipeline: usePipelineStore,
  viewer: useViewerStore,
  settings: useSettingsStore,
};

function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSON 01]",
    indexInType: 1,
    enabled: true,
    aliases: ["Juan Pérez"],
    replacementValueUserSet: false,
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "conflict-1",
    groupId: "group-1",
    reason: ConflictReason.Overlap,
    candidates: [
      { source: DetectionSource.Regex, entityType: EntityType.DNI, confidence: 0.9, value: "123" },
    ],
    resolved: false,
    ...overrides,
  };
}

function makeSerializedError(
  overrides: Partial<SerializedEngineError> = {},
): SerializedEngineError {
  return {
    code: EngineErrorCode.PDF_INVALID,
    engineId: "core",
    message: "boom",
    retryable: false,
    details: {},
    ...overrides,
  };
}

describe("bus-bridge", () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useEntitiesStore.getState().reset();
    useRulesStore.getState().reset();
    usePipelineStore.getState().reset();
    useViewerStore.getState().reset();
  });

  it("DOCUMENT_IMPORTED sets id/name immediately, leaving pageCount/sourceKind at defaults", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, {
      documentId: "doc-1",
      name: "a.pdf",
      sizeBytes: 100,
    });

    expect(useDocumentStore.getState().id).toBe("doc-1");
    expect(useDocumentStore.getState().name).toBe("a.pdf");
    expect(useDocumentStore.getState().pageCount).toBe(0);
    expect(useDocumentStore.getState().sourceKind).toBeNull();

    unsubscribe();
  });

  it("DOCUMENT_PARSED fills pageCount/sourceKind without clobbering id/name", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, {
      documentId: "doc-1",
      name: "a.pdf",
      sizeBytes: 100,
    });
    bus.emit(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, {
      documentId: "doc-1",
      pageCount: 12,
      textlessPages: [],
      sourceKind: "text",
    });

    expect(useDocumentStore.getState()).toMatchObject({
      id: "doc-1",
      name: "a.pdf",
      pageCount: 12,
      sourceKind: "text",
    });

    unsubscribe();
  });

  it("PIPELINE_STAGE_CHANGED updates stage/progress", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, {
      documentId: "doc-1",
      stage: PipelineStage.Detecting,
      progress: 0.4,
    });

    expect(usePipelineStore.getState().stage).toBe(PipelineStage.Detecting);
    expect(usePipelineStore.getState().progress).toBe(0.4);

    unsubscribe();
  });

  it("PIPELINE_PROGRESS updates current/total", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, {
      documentId: "doc-1",
      stage: PipelineStage.OCRing,
      current: 3,
      total: 10,
    });

    expect(usePipelineStore.getState().current).toBe(3);
    expect(usePipelineStore.getState().total).toBe(10);

    unsubscribe();
  });

  it("PIPELINE_READY sets stage Ready with group/conflict counts", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, {
      documentId: "doc-1",
      groupCount: 5,
      conflictCount: 1,
    });

    expect(usePipelineStore.getState()).toMatchObject({
      stage: PipelineStage.Ready,
      groupCount: 5,
      conflictCount: 1,
    });

    unsubscribe();
  });

  it("PIPELINE_CANCELLED sets stage Cancelled", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_CANCELLED, {
      documentId: "doc-1",
      reason: "user requested",
    });

    expect(usePipelineStore.getState().stage).toBe(PipelineStage.Cancelled);

    unsubscribe();
  });

  it("PIPELINE_FAILED sets stage Failed with the serialized error", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);
    const error = makeSerializedError({ message: "PDF invalid" });

    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, {
      documentId: "doc-1",
      error,
    });

    expect(usePipelineStore.getState().stage).toBe(PipelineStage.Failed);
    expect(usePipelineStore.getState().error).toEqual(error);

    unsubscribe();
  });

  it("NER_MODEL_LOADING sets modelLoading, NER_MODEL_READY clears it", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Ner, EngineEvents.NER_MODEL_LOADING, {
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
      progress: 0.5,
    });
    expect(usePipelineStore.getState().modelLoading).toEqual({
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
      progress: 0.5,
    });

    bus.emit(EventChannel.Ner, EngineEvents.NER_MODEL_READY, {
      modelId: "Xenova/bert-base-multilingual-cased-ner-hrl",
    });
    expect(usePipelineStore.getState().modelLoading).toBeNull();

    unsubscribe();
  });

  it("ENTITY_GROUP_CREATED adds a group to the right type bucket", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);
    const group = makeGroup();

    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: "doc-1",
      group,
    });

    expect(useEntitiesStore.getState().groupsByType.get(EntityType.Person)).toEqual([group]);

    unsubscribe();
  });

  it("ENTITY_GROUP_UPDATED replaces the group in place", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);
    const group = makeGroup();
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: "doc-1",
      group,
    });

    const updated = makeGroup({ enabled: false });
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_UPDATED, {
      documentId: "doc-1",
      group: updated,
      changes: ["enabled"],
    });

    expect(useEntitiesStore.getState().groupsByType.get(EntityType.Person)).toEqual([updated]);

    unsubscribe();
  });

  it("ENTITY_GROUP_REMOVED removes the group", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);
    const group = makeGroup();
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: "doc-1",
      group,
    });

    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_REMOVED, {
      documentId: "doc-1",
      groupId: group.id,
    });

    expect(useEntitiesStore.getState().groupsByType.get(EntityType.Person)).toEqual([]);

    unsubscribe();
  });

  it("GROUP_REPLACEMENT_CHANGED updates mode/value on the matching group", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);
    const group = makeGroup();
    bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
      documentId: "doc-1",
      group,
    });

    bus.emit(EventChannel.Grouping, EngineEvents.GROUP_REPLACEMENT_CHANGED, {
      documentId: "doc-1",
      groupId: group.id,
      mode: ReplacementMode.Redact,
      value: "[REDACTED]",
    });

    const [updated] = useEntitiesStore.getState().groupsByType.get(EntityType.Person) ?? [];
    expect(updated?.replacementMode).toBe(ReplacementMode.Redact);
    expect(updated?.replacementValue).toBe("[REDACTED]");

    unsubscribe();
  });

  it("CONFLICT_DETECTED adds a conflict, CONFLICT_RESOLVED marks it resolved", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);
    const conflict = makeConflict();

    bus.emit(EventChannel.Grouping, EngineEvents.CONFLICT_DETECTED, {
      documentId: "doc-1",
      conflict,
    });
    expect(useEntitiesStore.getState().conflicts).toEqual([conflict]);

    bus.emit(EventChannel.Grouping, EngineEvents.CONFLICT_RESOLVED, {
      documentId: "doc-1",
      conflictId: conflict.id,
      entityType: EntityType.Organization,
    });
    expect(useEntitiesStore.getState().conflicts[0]?.resolved).toBe(true);

    unsubscribe();
  });

  it("PREVIEW_UPDATED stores the blob URL by page/kind", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: "doc-1",
      pageIndex: 2,
      kind: "original",
      canvasBlobUrl: "blob:original-2",
    });

    expect(useViewerStore.getState().previewByPage.original.get(2)).toBe("blob:original-2");
    expect(useViewerStore.getState().previewByPage.anonymized.get(2)).toBeUndefined();

    unsubscribe();
  });

  it("PREVIEW_UPDATED for one kind doesn't change the other kind's Map reference", () => {
    // Regresión: previewByPage es por panel (viewer.store.ts) precisamente
    // para que un PdfViewer no se re-renderice cuando el otro panel recibe
    // un preview nuevo. Si esto rompe, la referencia de "anonymized" cambia
    // aunque solo se haya actualizado "original".
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    const anonymizedMapBefore = useViewerStore.getState().previewByPage.anonymized;

    bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
      documentId: "doc-1",
      pageIndex: 2,
      kind: "original",
      canvasBlobUrl: "blob:original-2",
    });

    expect(useViewerStore.getState().previewByPage.anonymized).toBe(anonymizedMapBefore);

    unsubscribe();
  });

  // ADR-062: el veredicto de "el reemplazo no entró y se encogió" viaja
  // adentro de PREVIEW_UPDATED. Estos tres tests fijan las tres reglas del
  // §2/§3 que son fáciles de romper sin que se note en pantalla.
  describe("PREVIEW_UPDATED.degraded (ADR-062)", () => {
    function degradedAnnotation(groupId: string, pageIndex: number): Annotation {
      return {
        id: `ann-${groupId}`,
        groupId,
        pageIndex,
        bbox: { x: 0, y: 0, width: 40, height: 12 },
        kind: AnnotationKind.Degraded,
      };
    }

    beforeEach(() => {
      useDegradedStore.getState().reset();
      // El puente descarta los eventos de OTRO documento (ADR-062 §3, "por
      // documento"): sin un documento activo que coincida, no hay veredicto
      // que sembrar. Es la precondición del filtro, no un detalle del setup.
      useDocumentStore.setState({ id: "doc-1" });
    });

    it("el veredicto del panel anonimizado llega al store", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
        documentId: "doc-1",
        pageIndex: 2,
        kind: "anonymized",
        canvasBlobUrl: "blob:anon-2",
        degraded: [degradedAnnotation("g1", 2)],
      });

      expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(true);

      unsubscribe();
    });

    // ADR-062 §3. El panel original se renderiza SIN reemplazos, así que su
    // `degraded` es vacío por construcción. Si el puente no lo descartara,
    // hacer scroll por el panel izquierdo apagaría las marcas que el panel
    // derecho acaba de encender — un bug que en pantalla parece
    // "las advertencias parpadean solas".
    it("el panel original NO borra el veredicto del anonimizado", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
        documentId: "doc-1",
        pageIndex: 2,
        kind: "anonymized",
        canvasBlobUrl: "blob:anon-2",
        degraded: [degradedAnnotation("g1", 2)],
      });
      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
        documentId: "doc-1",
        pageIndex: 2,
        kind: "original",
        canvasBlobUrl: "blob:original-2",
      });

      expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(true);

      unsubscribe();
    });

    // ADR-062 §3 dice "por documento". El Orchestrator documenta que un
    // PREVIEW_UPDATED puede llegar tarde: si un evento rezagado del documento
    // anterior pasara el filtro, sembraría marcas de un documento muerto sobre
    // el recién abierto — advertencias sobre grupos que el usuario no tiene.
    it("un evento de OTRO documento no siembra el veredicto", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
        documentId: "doc-viejo",
        pageIndex: 2,
        kind: "anonymized",
        canvasBlobUrl: "blob:anon-2",
        degraded: [degradedAnnotation("g1", 2)],
      });

      expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(false);

      unsubscribe();
    });

    // ADR-062 §2: ausente ≡ vacío. Un re-render limpio (el usuario acortó el
    // texto) llega sin la clave, y eso significa "ya no hay problema" — no
    // "no sé, dejá la marca como estaba".
    it("un re-render sin `degraded` apaga la marca", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
        documentId: "doc-1",
        pageIndex: 2,
        kind: "anonymized",
        canvasBlobUrl: "blob:anon-2",
        degraded: [degradedAnnotation("g1", 2)],
      });
      bus.emit(EventChannel.Render, EngineEvents.PREVIEW_UPDATED, {
        documentId: "doc-1",
        pageIndex: 2,
        kind: "anonymized",
        canvasBlobUrl: "blob:anon-2b",
      });

      expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(false);

      unsubscribe();
    });
  });

  it("EXPORT_PROGRESS/EXPORT_FINISHED/EXPORT_FAILED update pipeline store", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, {
      documentId: "doc-1",
      current: 1,
      total: 4,
    });
    expect(usePipelineStore.getState().exportProgress).toEqual({ current: 1, total: 4 });

    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
      documentId: "doc-1",
      blobUrl: "blob:export-1",
      sizeBytes: 1024,
      durationMs: 500,
    });
    expect(usePipelineStore.getState().exportResult).toEqual({
      blobUrl: "blob:export-1",
      sizeBytes: 1024,
    });
    // bug #7 del Escenario 1 E2E (React_Client.md §2.2): EXPORT_FINISHED
    // limpia exportProgress — si no, PipelineStatus queda mostrando
    // "Exportando página N de N…" para siempre.
    expect(usePipelineStore.getState().exportProgress).toBeNull();

    const error = makeSerializedError({ code: EngineErrorCode.EXPORT_FAILED });
    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, { documentId: "doc-1", error });
    expect(usePipelineStore.getState().error).toEqual(error);

    unsubscribe();
  });

  it("EXPORT_FAILED clears exportProgress (bug #7 del Escenario 1 E2E, React_Client.md §2.2)", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Export, EngineEvents.EXPORT_PROGRESS, {
      documentId: "doc-1",
      current: 3,
      total: 10,
    });
    expect(usePipelineStore.getState().exportProgress).toEqual({ current: 3, total: 10 });

    const error = makeSerializedError({ code: EngineErrorCode.EXPORT_FAILED });
    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, { documentId: "doc-1", error });

    expect(usePipelineStore.getState().error).toEqual(error);
    expect(usePipelineStore.getState().exportProgress).toBeNull();

    unsubscribe();
  });

  it("the returned unsubscribe stops further store updates", () => {
    const bus = createEventBus({ logger: createTestLogger() });
    const unsubscribe = subscribe(bus, stores);

    unsubscribe();

    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, {
      documentId: "doc-1",
      groupCount: 9,
      conflictCount: 9,
    });

    expect(usePipelineStore.getState().stage).toBe(PipelineStage.Idle);
    expect(usePipelineStore.getState().groupCount).toBe(0);
  });

  describe("fallos que NO tumban el pipeline (WORKER_JOB_FAILED / OCR_PAGE_FAILED)", () => {
    /*
     * El agujero que cierra este bloque: un worker caído rechaza su job pero
     * el pipeline sigue hasta `Ready`. Antes de este cableado nada de eso
     * llegaba a un store, así que la toolbar decía "Listo" sobre un documento
     * en el que no se detectó nada. `OCR_PAGE_FAILED` no estaba suscrito a
     * ningún store, y era un gap anotado desde el PR5 del Hito 10.
     */
    function crashedError(): SerializedEngineError {
      return makeSerializedError({
        code: EngineErrorCode.WORKER_CRASHED,
        message: "WorkerPool(ner): worker (slot 0) emitió un error de transporte.",
      });
    }

    it("un job fallido se cuenta bajo el tipo con el que fue despachado", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_DISPATCHED, {
        jobId: "ner-page-3",
        workerId: "ner-pool",
        type: "ner-page",
      });
      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_FAILED, {
        jobId: "ner-page-3",
        error: crashedError(),
      });

      expect(usePipelineStore.getState().failedJobs).toEqual({ "ner-page": 1 });
      unsubscribe();
    });

    it("acumula por tipo: los 11 jobs de NER de la pericia real", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      for (let i = 0; i < 11; i++) {
        bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_DISPATCHED, {
          jobId: `ner-page-${i}`,
          workerId: "ner-pool",
          type: "ner-page",
        });
        bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_FAILED, {
          jobId: `ner-page-${i}`,
          error: crashedError(),
        });
      }

      expect(usePipelineStore.getState().failedJobs).toEqual({ "ner-page": 11 });
      unsubscribe();
    });

    it("un job que completa bien no cuenta como fallo", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_DISPATCHED, {
        jobId: "render-page-1",
        workerId: "render-pool",
        type: "render-page",
      });
      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_COMPLETED, {
        jobId: "render-page-1",
        result: null,
      });

      expect(usePipelineStore.getState().failedJobs).toEqual({});
      unsubscribe();
    });

    it("un fallo sin despacho previo no se atribuye a ningún motor", () => {
      // Inventar una etiqueta sería peor que no contarlo: el aviso al usuario
      // nombraría un motor que quizá ni corrió.
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_FAILED, {
        jobId: "huerfano-1",
        error: crashedError(),
      });

      expect(usePipelineStore.getState().failedJobs).toEqual({});
      unsubscribe();
    });

    it("una página que el OCR no pudo leer también cuenta", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FAILED, {
        documentId: "doc-1",
        pageIndex: 4,
        error: makeSerializedError({ code: EngineErrorCode.OCR_PAGE_FAILED }),
      });

      expect(usePipelineStore.getState().failedJobs).toEqual({ "ocr-page": 1 });
      unsubscribe();
    });

    it("un documento nuevo arranca con la cuenta en cero", () => {
      // Sin esto, el aviso de un análisis viejo sobrevive al siguiente y acusa
      // a un documento que no tuvo el problema.
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribe(bus, stores);

      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_DISPATCHED, {
        jobId: "ner-page-1",
        workerId: "ner-pool",
        type: "ner-page",
      });
      bus.emit(EventChannel.Workers, EngineEvents.WORKER_JOB_FAILED, {
        jobId: "ner-page-1",
        error: crashedError(),
      });
      expect(usePipelineStore.getState().failedJobs).toEqual({ "ner-page": 1 });

      bus.emit(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, {
        documentId: "doc-2",
        name: "otro.pdf",
        sizeBytes: 10,
      });

      expect(usePipelineStore.getState().failedJobs).toEqual({});
      unsubscribe();
    });
  });

  describe("subscribePasswordRequired", () => {
    it("invokes the handler with the documentId on PDF_PASSWORD_REQUIRED", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const received: string[] = [];
      const unsubscribe = subscribePasswordRequired(bus, (documentId) => {
        received.push(documentId);
      });

      bus.emit(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, { documentId: "doc-1" });
      bus.emit(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, { documentId: "doc-1" });

      expect(received).toEqual(["doc-1", "doc-1"]);

      unsubscribe();
    });

    it("stops notifying after unsubscribe", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const received: string[] = [];
      const unsubscribe = subscribePasswordRequired(bus, (documentId) => {
        received.push(documentId);
      });

      unsubscribe();
      bus.emit(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, { documentId: "doc-1" });

      expect(received).toEqual([]);
    });

    it("does not touch any Zustand store (no mutation side effects)", () => {
      const bus = createEventBus({ logger: createTestLogger() });
      const unsubscribe = subscribePasswordRequired(bus, () => {});

      bus.emit(EventChannel.Pdf, EngineEvents.PDF_PASSWORD_REQUIRED, { documentId: "doc-1" });

      expect(usePipelineStore.getState().stage).toBe(PipelineStage.Idle);
      expect(useDocumentStore.getState().id).toBeNull();

      unsubscribe();
    });
  });
});
