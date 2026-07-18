import {
  ConflictReason,
  createEventBus,
  DetectionSource,
  EngineErrorCode,
  EngineEvents,
  EntityType,
  EventChannel,
  PipelineStage,
  ReplacementMode,
  type Conflict,
  type EntityGroup,
  type ILogger,
  type SerializedEngineError,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import { subscribe, subscribePasswordRequired, type Stores } from "../core-adapter/bus-bridge.js";
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
      mode: ReplacementMode.Mask,
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

    expect(useViewerStore.getState().previewByPage.get(2)).toEqual({
      original: "blob:original-2",
    });

    unsubscribe();
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

    const error = makeSerializedError({ code: EngineErrorCode.EXPORT_FAILED });
    bus.emit(EventChannel.Export, EngineEvents.EXPORT_FAILED, { documentId: "doc-1", error });
    expect(usePipelineStore.getState().error).toEqual(error);

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
