import {
  createEventBus,
  EngineErrorCode,
  EngineEvents,
  EventChannel,
  PipelineStage,
  type ILogger,
  type SerializedEngineError,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  describeImportFailure,
  isImportFailure,
  recordImportFailure,
  resolveFailedAtStage,
  resolveScanExit,
  clearImportFailure,
  peekImportFailure,
} from "../components/screens/importFailure.js";
import { subscribe, type Stores } from "../core-adapter/bus-bridge.js";
import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useSettingsStore } from "../store/settings.store.js";
import { useViewerStore } from "../store/viewer.store.js";

// ADR-168 §4: un fallo de importación vuelve a la zona de carga.

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };

const stores: Stores = {
  document: useDocumentStore,
  entities: useEntitiesStore,
  rules: useRulesStore,
  pipeline: usePipelineStore,
  viewer: useViewerStore,
  settings: useSettingsStore,
};

function pdfInvalid(): SerializedEngineError {
  return {
    code: EngineErrorCode.PDF_INVALID,
    engineId: "core",
    message: "internal parser message",
    retryable: false,
    details: {},
  };
}

const TERMINAL_ELAPSED = { elapsedMs: 0, firstPagePreviewReady: false, elapsedSinceReadyMs: null };

describe("isImportFailure", () => {
  it("es fallo de importación si la última etapa fue Importing o Extracting", () => {
    expect(isImportFailure(PipelineStage.Failed, PipelineStage.Importing)).toBe(true);
    expect(isImportFailure(PipelineStage.Failed, PipelineStage.Extracting)).toBe(true);
  });

  it("no lo es si ya había páginas que revisar (OCRing, Detecting, Grouping)", () => {
    expect(isImportFailure(PipelineStage.Failed, PipelineStage.OCRing)).toBe(false);
    expect(isImportFailure(PipelineStage.Failed, PipelineStage.Detecting)).toBe(false);
    expect(isImportFailure(PipelineStage.Failed, PipelineStage.Grouping)).toBe(false);
  });

  it("sin etapa registrada cae al caso conservador (banner en ②b)", () => {
    expect(isImportFailure(PipelineStage.Failed, null)).toBe(false);
  });

  it("solo aplica en Failed", () => {
    expect(isImportFailure(PipelineStage.Cancelled, PipelineStage.Extracting)).toBe(false);
    expect(isImportFailure(PipelineStage.Extracting, PipelineStage.Extracting)).toBe(false);
  });
});

describe("resolveFailedAtStage", () => {
  it("registra la etapa que había antes del fallo", () => {
    expect(resolveFailedAtStage(PipelineStage.Extracting, null)).toBe(PipelineStage.Extracting);
  });

  it("un segundo aviso de Failed conserva lo ya registrado", () => {
    expect(resolveFailedAtStage(PipelineStage.Failed, PipelineStage.Extracting)).toBe(
      PipelineStage.Extracting,
    );
    expect(resolveFailedAtStage(PipelineStage.Failed, null)).toBeNull();
  });
});

describe("resolveScanExit", () => {
  it("fallo de importación → vuelve a ①", () => {
    expect(
      resolveScanExit({
        stage: PipelineStage.Failed,
        failedAtStage: PipelineStage.Extracting,
        ...TERMINAL_ELAPSED,
      }),
    ).toBe("load");
  });

  it("fallo posterior → pasa a ②b de inmediato, como antes (ADR-150)", () => {
    expect(
      resolveScanExit({
        stage: PipelineStage.Failed,
        failedAtStage: PipelineStage.Detecting,
        ...TERMINAL_ELAPSED,
      }),
    ).toBe("work");
  });

  it("Cancelled → ②b", () => {
    expect(
      resolveScanExit({
        stage: PipelineStage.Cancelled,
        failedAtStage: null,
        ...TERMINAL_ELAPSED,
      }),
    ).toBe("work");
  });

  it("una etapa en curso → se queda", () => {
    expect(
      resolveScanExit({
        stage: PipelineStage.Detecting,
        failedAtStage: null,
        ...TERMINAL_ELAPSED,
      }),
    ).toBe("stay");
  });
});

describe("describeImportFailure", () => {
  it("usa el mensaje de pipelineErrorPresentation y conserva el nombre del archivo", () => {
    expect(describeImportFailure("informe.pdf", pdfInvalid())).toEqual({
      fileName: "informe.pdf",
      message: "El archivo no es un PDF válido. Probá con otro documento.",
    });
  });

  it("sin error serializado da un motivo genérico, nunca vacío", () => {
    const failure = describeImportFailure(null, null);
    expect(failure.fileName).toBeNull();
    expect(failure.message.length).toBeGreaterThan(0);
  });
});

describe("buzón del error para la DropZone", () => {
  it("leer no consume (StrictMode invoca dos veces el inicializador); vaciar sí", () => {
    recordImportFailure({ fileName: "a.pdf", message: "m" });
    expect(peekImportFailure()).toEqual({ fileName: "a.pdf", message: "m" });
    expect(peekImportFailure()).toEqual({ fileName: "a.pdf", message: "m" });
    clearImportFailure();
    expect(peekImportFailure()).toBeNull();
  });

  it("vacío devuelve null", () => {
    clearImportFailure();
    expect(peekImportFailure()).toBeNull();
  });
});

describe("bus-bridge: failedAtStage y visitedStages (pipeline.store, ADR-168 §4/§5)", () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    usePipelineStore.getState().reset();
  });

  it("PIPELINE_FAILED registra la etapa en la que estaba el pipeline", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);

    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, {
      documentId: "doc-1",
      stage: PipelineStage.Extracting,
      progress: 0,
    });
    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, {
      documentId: "doc-1",
      error: pdfInvalid(),
    });

    const state = usePipelineStore.getState();
    expect(state.stage).toBe(PipelineStage.Failed);
    expect(state.failedAtStage).toBe(PipelineStage.Extracting);
    expect(isImportFailure(state.stage, state.failedAtStage)).toBe(true);
    unsubscribe();
  });

  it("un fallo en Detecting no es de importación", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);

    for (const stage of [
      PipelineStage.Importing,
      PipelineStage.Extracting,
      PipelineStage.Detecting,
    ]) {
      bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, {
        documentId: "doc-1",
        stage,
        progress: 0,
      });
    }
    bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_FAILED, {
      documentId: "doc-1",
      error: pdfInvalid(),
    });

    const state = usePipelineStore.getState();
    expect(state.failedAtStage).toBe(PipelineStage.Detecting);
    expect(isImportFailure(state.stage, state.failedAtStage)).toBe(false);
    unsubscribe();
  });

  it("PIPELINE_STAGE_CHANGED acumula las etapas atravesadas", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);

    for (const stage of [
      PipelineStage.Importing,
      PipelineStage.Extracting,
      PipelineStage.Detecting,
    ]) {
      bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_STAGE_CHANGED, {
        documentId: "doc-1",
        stage,
        progress: 0,
      });
    }

    const visited = usePipelineStore.getState().visitedStages;
    expect([...visited]).toEqual([
      PipelineStage.Importing,
      PipelineStage.Extracting,
      PipelineStage.Detecting,
    ]);
    expect(visited.has(PipelineStage.OCRing)).toBe(false);
    unsubscribe();
  });

  it("DOCUMENT_IMPORTED vacía el mapa y la etapa del fallo del documento anterior", () => {
    const bus = createEventBus({ logger });
    const unsubscribe = subscribe(bus, stores);
    usePipelineStore.setState({
      failedAtStage: PipelineStage.Extracting,
      visitedStages: new Set([PipelineStage.Importing, PipelineStage.OCRing]),
    });

    bus.emit(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, {
      documentId: "doc-2",
      name: "otro.pdf",
      sizeBytes: 10,
    });

    expect(usePipelineStore.getState().failedAtStage).toBeNull();
    expect(usePipelineStore.getState().visitedStages.size).toBe(0);
    unsubscribe();
  });

  it("reset() los devuelve a su estado inicial", () => {
    usePipelineStore.setState({
      failedAtStage: PipelineStage.Importing,
      visitedStages: new Set([PipelineStage.Importing]),
    });
    usePipelineStore.getState().reset();
    expect(usePipelineStore.getState().failedAtStage).toBeNull();
    expect(usePipelineStore.getState().visitedStages.size).toBe(0);
  });
});
