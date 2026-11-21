/**
 * `REGEX_FINISHED.skippedFormats` → `pipeline.store.skippedFormats` (ADR-220 §6,
 * ADR-229 §7, `React_Client.md` §3.11): lo escribe el bridge, un `reanalyze` lo
 * reemplaza, un documento nuevo y `reset()` lo vacían, y no bloquea la
 * exportación.
 */
import {
  ConflictReason,
  createEventBus,
  DetectionSource,
  EngineEvents,
  EntityType,
  EventChannel,
  type ILogger,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import { exportBlockReason } from "../components/toolbar/exportBlockReason.js";
import { subscribe, type Stores } from "../core-adapter/bus-bridge.js";
import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useSettingsStore } from "../store/settings.store.js";
import { useUnreadableInkStore } from "../store/unreadableInk.store.js";
import { useViewerStore } from "../store/viewer.store.js";

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };

const stores: Stores = {
  document: useDocumentStore,
  entities: useEntitiesStore,
  rules: useRulesStore,
  pipeline: usePipelineStore,
  viewer: useViewerStore,
  settings: useSettingsStore,
  unreadableInk: useUnreadableInkStore,
};

function open(bus: ReturnType<typeof createEventBus>, documentId = "doc-1"): void {
  bus.emit(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, {
    documentId,
    name: "a.pdf",
    sizeBytes: 100,
  });
}

function regexFinished(
  bus: ReturnType<typeof createEventBus>,
  skippedFormats?: ReadonlyArray<{ formatId: string; pageIndices: ReadonlyArray<number> }>,
  documentId = "doc-1",
): void {
  bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
    documentId,
    occurrenceCount: 0,
    durationMs: 1,
    ...(skippedFormats !== undefined ? { skippedFormats } : {}),
  });
}

describe("skippedFormats en pipeline.store", () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useEntitiesStore.getState().reset();
    usePipelineStore.getState().reset();
  });

  it("arranca vacío: es el caso sano", () => {
    expect(usePipelineStore.getState().skippedFormats).toEqual([]);
  });

  it("REGEX_FINISHED lo escribe con el formato y sus páginas", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);
    open(bus);

    regexFinished(bus, [{ formatId: "fmt:cbu", pageIndices: [2, 3] }]);

    expect(usePipelineStore.getState().skippedFormats).toEqual([
      { formatId: "fmt:cbu", pageIndices: [2, 3] },
    ]);
    unsubscribe();
  });

  it("ausente equivale a ninguno: un reanalyze que ya no falla apaga el aviso", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);
    open(bus);
    regexFinished(bus, [{ formatId: "fmt:cbu", pageIndices: [2] }]);

    regexFinished(bus);

    expect(usePipelineStore.getState().skippedFormats).toEqual([]);
    unsubscribe();
  });

  it("un reanalyze lo reemplaza, no lo suma", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);
    open(bus);
    regexFinished(bus, [{ formatId: "fmt:cbu", pageIndices: [2] }]);

    regexFinished(bus, [{ formatId: "fmt:cliente", pageIndices: [0, 1] }]);

    expect(usePipelineStore.getState().skippedFormats).toEqual([
      { formatId: "fmt:cliente", pageIndices: [0, 1] },
    ]);
    unsubscribe();
  });

  it("DOCUMENT_IMPORTED y reset() lo vacían", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);
    open(bus);
    regexFinished(bus, [{ formatId: "fmt:cbu", pageIndices: [2] }]);

    open(bus, "doc-2");
    expect(usePipelineStore.getState().skippedFormats).toEqual([]);

    regexFinished(bus, [{ formatId: "fmt:cbu", pageIndices: [2] }], "doc-2");
    usePipelineStore.getState().reset();
    expect(usePipelineStore.getState().skippedFormats).toEqual([]);
    unsubscribe();
  });

  it("ignora el evento de otro documento", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);
    open(bus);

    regexFinished(bus, [{ formatId: "fmt:cbu", pageIndices: [2] }], "otro-documento");

    expect(usePipelineStore.getState().skippedFormats).toEqual([]);
    unsubscribe();
  });

  it("no participa de exportBlockReason: no bloquea la exportación", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);
    open(bus);
    regexFinished(bus, [{ formatId: "fmt:cbu", pageIndices: [2] }]);

    // Sin conflictos sin resolver no hay razón de bloqueo, haya o no formatos salteados.
    expect(exportBlockReason(useEntitiesStore.getState().conflicts)).toBeNull();
    unsubscribe();
  });

  it("un conflicto entre formatos que nace resuelto tampoco bloquea (ADR-222 §4)", () => {
    expect(
      exportBlockReason([
        {
          id: "c1",
          groupId: "g1",
          reason: ConflictReason.Overlap,
          candidates: [
            {
              source: DetectionSource.Regex,
              entityType: EntityType.CUIT,
              confidence: 1,
              value: "20-12345678-9",
              formatId: "cuit-ar",
            },
            {
              source: DetectionSource.Regex,
              entityType: EntityType.DNI,
              confidence: 1,
              value: "20-12345678-9",
              formatId: "fmt:cli",
            },
          ],
          resolved: true,
          resolvedType: EntityType.DNI,
        },
      ]),
    ).toBeNull();
  });
});
