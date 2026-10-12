import {
  ConflictReason,
  createEventBus,
  EngineEvents,
  EngineErrorCode,
  EngineId,
  EntityType,
  EventChannel,
  PipelineStage,
  ReplacementMode,
  type Rule,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { subscribe } from "../core-adapter/bus-bridge.js";
import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useSettingsStore } from "../store/settings.store.js";
import { useUnreadableInkStore } from "../store/unreadableInk.store.js";
import { useViewerStore } from "../store/viewer.store.js";

const emit = vi.fn();
const importDocument = vi.fn().mockResolvedValue(undefined);
const retryWithPassword = vi.fn().mockResolvedValue(undefined);
const reanalyze = vi.fn().mockResolvedValue(undefined);
const addManualEntity = vi.fn();
const getPageWords = vi.fn();
const getPageSize = vi.fn();
const findText = vi.fn();
const previewEdit = vi.fn();
const createEditCheckpoint = vi.fn();
const restoreEditCheckpoint = vi.fn();
const discardEditCheckpoints = vi.fn();
const getSnapshot = vi.fn();
let stageChanged: ((payload: { documentId: string; stage: PipelineStage }) => void) | undefined;
const subscribeBus = vi.fn(
  (
    _channel: EventChannel,
    _event: EngineEvents,
    handler: (payload: { documentId: string; stage: PipelineStage }) => void,
  ) => {
    stageChanged = handler;
    return () => {
      stageChanged = undefined;
    };
  },
);

vi.mock("../core-adapter/index.js", () => {
  const getCore = () => ({
    bus: {
      emit,
      on: subscribeBus,
      once: vi.fn(),
      off: vi.fn(),
      emitAsync: vi.fn(),
    },
    orchestrator: {
      importDocument,
      retryWithPassword,
      reanalyze,
      addManualEntity,
      getPageWords,
      getPageSize,
      findText,
      previewEdit,
      createEditCheckpoint,
      restoreEditCheckpoint,
      discardEditCheckpoints,
      cancel: vi.fn(),
      closeDocument: vi.fn(),
      getState: vi.fn(),
      dispose: vi.fn(),
    },
    engines: { grouping: { getSnapshot } },
  });
  return {
    getCore,
    getCoreWhenReady: async () => getCore(),
    recreateCoreIfOverridesChanged: vi.fn(),
  };
});

const { actions } = await import("../core-adapter/actions.js");
const { useHistoryStore } = await import("../core-adapter/history.js");

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    scope: "type",
    target: { kind: "type" },
    mode: ReplacementMode.Mask,
    priority: 0,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("actions", () => {
  beforeEach(() => {
    emit.mockClear();
    subscribeBus.mockClear();
    stageChanged = undefined;
    subscribeBus.mockImplementation((_channel, _event, handler) => {
      stageChanged = handler;
      return () => {
        stageChanged = undefined;
      };
    });
    importDocument.mockClear();
    retryWithPassword.mockClear();
    reanalyze.mockReset().mockResolvedValue(undefined);
    addManualEntity.mockClear();
    getPageWords.mockClear();
    getPageSize.mockClear();
    findText.mockClear();
    // vitest.config.ts tiene mockReset: true — resetea la implementación de
    // todos los mocks antes de cada test, así que hay que reaplicar el
    // resolved value acá (a diferencia de los demás mocks de este archivo,
    // que devuelven `undefined` y son indistinguibles del reset default).
    addManualEntity.mockResolvedValue({ occurrenceCount: 1 });
    getPageWords.mockReturnValue([]);
    getPageSize.mockReturnValue({ width: 612, height: 792 });
    findText.mockReturnValue([]);
    useDocumentStore.getState().reset();
    useEntitiesStore.getState().reset();
    useRulesStore.getState().reset();
    useViewerStore.getState().reset();
    usePipelineStore.getState().reset();
  });

  it("importDocument generates a documentId and forwards name/buffer to the orchestrator", async () => {
    const content = new TextEncoder().encode("dummy pdf");
    const file = new File([content], "report.pdf", { type: "application/pdf" });

    await actions.importDocument(file);

    expect(importDocument).toHaveBeenCalledTimes(1);
    const call = importDocument.mock.calls[0]?.[0] as { documentId: string; name: string };
    expect(call.name).toBe("report.pdf");
    expect(typeof call.documentId).toBe("string");
    expect(call.documentId.length).toBeGreaterThan(0);
  });

  it("actions requiring an active document no-op when none is open", () => {
    actions.updateGroup("group-1", { enabled: false });
    actions.mergeGroups("group-1", "group-2");
    actions.splitGroup("group-1", ["occ-1"]);
    actions.createRule(makeRule());
    actions.updateRule("rule-1", { enabled: false });
    actions.deleteRule("rule-1");
    actions.resolveConflict("conflict-1", { entityType: EntityType.Organization });
    actions.requestRender([0, 1], "original", "preview", 1);
    actions.requestExport({
      imageFormat: "png",
      jpegQuality: 0.9,
      dpi: 150,
      includeOriginalMetadata: false,
      filename: "out.pdf",
      includeMarkerLegend: false,
    });
    actions.cancel();
    actions.closeDocument();

    expect(emit).not.toHaveBeenCalled();
  });

  it("getPageWords/getPageSize/findText return their empty defaults when none is open", () => {
    expect(actions.getPageWords(0)).toEqual([]);
    expect(actions.getPageSize(0)).toBeNull();
    expect(actions.findText("test")).toEqual([]);
    expect(getPageWords).not.toHaveBeenCalled();
    expect(getPageSize).not.toHaveBeenCalled();
    expect(findText).not.toHaveBeenCalled();
  });

  it("actions requiring an active document no-op when none is open (async orchestrator calls)", async () => {
    await actions.reanalyze({ ner: { enabled: false } });
    await actions.retryWithPassword("secret");
    const result = await actions.addManualEntity({
      value: "José Pérez",
      entityType: EntityType.Person,
    });

    expect(reanalyze).not.toHaveBeenCalled();
    expect(retryWithPassword).not.toHaveBeenCalled();
    expect(addManualEntity).not.toHaveBeenCalled();
    // ADR-061 §6 errata: `null` es el único valor que significa "no hay
    // documento activo" — nunca se colapsa con `{ occurrenceCount: 0 }`.
    expect(result).toBeNull();
  });

  describe("with an active document", () => {
    beforeEach(() => {
      useDocumentStore.setState({ id: "doc-1", name: "a.pdf" });
    });

    it("updateGroup emits GROUP_UPDATE_REQUESTED with the patch", () => {
      actions.updateGroup("group-1", { enabled: false });
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
        documentId: "doc-1",
        groupId: "group-1",
        patch: { enabled: false },
      });
    });

    // ADR-060 §6 / ADR-069 §4: lo que `PersonGenderToggle` emite por cada uno
    // de sus tres estados. "neutral" viaja como valor explícito, nunca como
    // ausencia de la clave (ver el comentario en `actions.ts` junto al patch).
    // ADR-071 cambió la forma del control, **no** el wire: este test es la
    // no-regresión de eso.
    it.each([
      ["f", { personGender: "f" }],
      ["m", { personGender: "m" }],
      ["neutral", { personGender: "neutral" }],
    ] as const)(
      "updateGroup with personGender %s emits GROUP_UPDATE_REQUESTED with the patch",
      (choice, expectedPatch) => {
        actions.updateGroup("group-1", { personGender: choice });
        expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
          documentId: "doc-1",
          groupId: "group-1",
          patch: expectedPatch,
        });
      },
    );

    it("mergeGroups emits GROUP_MERGE_REQUESTED", () => {
      actions.mergeGroups("source-1", "target-1");
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_MERGE_REQUESTED, {
        documentId: "doc-1",
        sourceGroupId: "source-1",
        targetGroupId: "target-1",
      });
    });

    it("splitGroup emits GROUP_SPLIT_REQUESTED", () => {
      actions.splitGroup("group-1", ["occ-1", "occ-2"]);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_SPLIT_REQUESTED, {
        documentId: "doc-1",
        groupId: "group-1",
        occurrenceIds: ["occ-1", "occ-2"],
      });
    });

    it("createRule/updateRule/deleteRule emit their RULE_* events and sync rules.store", () => {
      const rule = makeRule();
      actions.createRule(rule);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RULE_CREATED, {
        documentId: "doc-1",
        rule,
      });
      // rules.store no tiene ningún evento Core→UI que lo alimente
      // (04_Event_System.md: RULE_* son UI→Grouping Engine, sin evento de
      // vuelta) — estas acciones son su única fuente de verdad.
      expect(useRulesStore.getState().rules).toEqual([rule]);

      actions.updateRule("rule-1", { enabled: false });
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RULE_UPDATED, {
        documentId: "doc-1",
        ruleId: "rule-1",
        patch: { enabled: false },
      });
      expect(useRulesStore.getState().rules[0]?.enabled).toBe(false);

      actions.deleteRule("rule-1");
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RULE_DELETED, {
        documentId: "doc-1",
        ruleId: "rule-1",
      });
      expect(useRulesStore.getState().rules).toEqual([]);
    });

    it("createRule/updateRule/deleteRule do not touch rules.store when no document is open", () => {
      useDocumentStore.getState().reset();
      const rule = makeRule();

      actions.createRule(rule);
      actions.updateRule("rule-1", { enabled: false });
      actions.deleteRule("rule-1");

      expect(useRulesStore.getState().rules).toEqual([]);
    });

    it("resolveConflict emits CONFLICT_RESOLVE_REQUESTED con el tipo elegido", () => {
      actions.resolveConflict("conflict-1", { entityType: EntityType.Organization });
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
        documentId: "doc-1",
        conflictId: "conflict-1",
        entityType: EntityType.Organization,
      });
    });

    // ADR-083 §4: sin tipo elegido, el campo NO viaja — el motor aplica su
    // default (mayor confidence), que coincide con la clasificación vigente.
    it("resolveConflict sin tipo omite entityType del payload", () => {
      actions.resolveConflict("conflict-1");
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
        documentId: "doc-1",
        conflictId: "conflict-1",
      });
    });

    // ADR-174 §3: `winner` solo tiene sentido en un conflicto con
    // `heldManual` (`ManualOverlapDialog`), pero `actions.resolveConflict` no
    // lo valida — eso es responsabilidad del motor (rechazo con `warn`). Acá
    // solo se prueba que el campo viaja cuando se pasa.
    it("resolveConflict con winner lo incluye en el payload", () => {
      actions.resolveConflict("conflict-1", { winner: "manual" });
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
        documentId: "doc-1",
        conflictId: "conflict-1",
        winner: "manual",
      });
    });

    it("resolveConflict con entityType y winner manda los dos", () => {
      actions.resolveConflict("conflict-1", {
        entityType: EntityType.Person,
        winner: "detected",
      });
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
        documentId: "doc-1",
        conflictId: "conflict-1",
        entityType: EntityType.Person,
        winner: "detected",
      });
    });

    it("requestRender omits scale for a full render when it is not provided", () => {
      actions.requestRender([0, 1], "original", "full");
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
        documentId: "doc-1",
        pageIndices: [0, 1],
        kind: "original",
        mode: "full",
      });
    });

    it("requestRender requires the scale of a preview request by types (ADR-213 §6)", () => {
      // @ts-expect-error — omitir la escala de un preview no compila.
      const missingScale = (): void => actions.requestRender([0], "original", "preview");
      // @ts-expect-error — ni dejando el modo por defecto.
      const missingMode = (): void => actions.requestRender([0], "original");
      expect(typeof missingScale).toBe("function");
      expect(typeof missingMode).toBe("function");
    });

    it("requestRender notes the scale of a preview request per kind in the viewer store (ADR-213 §2)", () => {
      actions.requestRender([0], "anonymized", "preview", 1.3);
      expect(useViewerStore.getState().requestedPreviewScale).toEqual({
        original: 1,
        anonymized: 1.3,
      });
      actions.requestRender([0], "original", "preview", 2);
      expect(useViewerStore.getState().requestedPreviewScale).toEqual({
        original: 2,
        anonymized: 1.3,
      });
    });

    it("requestRender does not note the scale of a full render (the export never moves it)", () => {
      actions.requestRender([0], "anonymized", "full", 2.5);
      expect(useViewerStore.getState().requestedPreviewScale.anonymized).toBe(1);
    });

    it("requestRender includes scale when provided", () => {
      actions.requestRender([0], "anonymized", "full", 2.5);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
        documentId: "doc-1",
        pageIndices: [0],
        kind: "anonymized",
        mode: "full",
        scale: 2.5,
      });
    });

    it("requestRender includes the kind received in the emitted payload (ADR-056 §1)", () => {
      actions.requestRender([2, 3], "anonymized", "preview", 1);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
        documentId: "doc-1",
        pageIndices: [2, 3],
        kind: "anonymized",
        mode: "preview",
        scale: 1,
      });
    });

    it("reanalyze forwards the patch to orchestrator.reanalyze", async () => {
      await actions.reanalyze({ ocr: { languages: ["spa"] } });
      expect(reanalyze).toHaveBeenCalledWith("doc-1", { ocr: { languages: ["spa"] } });
    });

    describe("reanalyzeInFlight (React_Client §2.2 regla 2)", () => {
      const inFlight = (): boolean => usePipelineStore.getState().reanalyzeInFlight;

      it("is true during the call and false once it resolves", async () => {
        let seenDuring: boolean | undefined;
        reanalyze.mockImplementation(() => {
          seenDuring = inFlight();
          return Promise.resolve();
        });

        await actions.reanalyze({ ocr: { languages: ["spa"] } });

        expect(seenDuring).toBe(true);
        expect(inFlight()).toBe(false);
      });

      it("is false again when the call rejects", async () => {
        let seenDuring: boolean | undefined;
        reanalyze.mockImplementation(() => {
          seenDuring = inFlight();
          return Promise.reject(new Error("boom"));
        });

        await expect(actions.reanalyze({ ocr: { languages: ["spa"] } })).rejects.toThrow("boom");

        expect(seenDuring).toBe(true);
        expect(inFlight()).toBe(false);
      });

      it("invalidates export content on the first effective transition, before awaiting Core", async () => {
        useDocumentStore.setState({ id: "doc-1" });
        useViewerStore.getState().setPreview(0, "anonymized", "blob:anon", {
          revision: 0,
          scale: 1,
          wordPositions: [],
          coveredRegions: [],
        });
        let versionAtTransition = -1;
        reanalyze.mockImplementation(() => {
          stageChanged?.({ documentId: "doc-1", stage: PipelineStage.OCRing });
          versionAtTransition = usePipelineStore.getState().currentVersion;
          return Promise.resolve();
        });

        await actions.reanalyze({ ocr: { languages: ["spa"] } });

        expect(versionAtTransition).toBe(1);
        expect(usePipelineStore.getState().currentVersion).toBe(1);
        expect(useViewerStore.getState().interactionGeometryByPage.size).toBe(0);
      });

      it("does not invalidate a no-op reanalysis that emits no transition", async () => {
        useDocumentStore.setState({ id: "doc-1" });
        await actions.reanalyze({ ocr: { languages: ["spa"] } });
        expect(usePipelineStore.getState().currentVersion).toBe(0);
      });

      it("a PIPELINE_CANCELLED emitted during the reanalysis leaves the stage in Ready (real bridge)", async () => {
        const bus = createEventBus({
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
        const unsubscribe = subscribe(bus, {
          document: useDocumentStore,
          entities: useEntitiesStore,
          rules: useRulesStore,
          pipeline: usePipelineStore,
          viewer: useViewerStore,
          settings: useSettingsStore,
          unreadableInk: useUnreadableInkStore,
        });
        reanalyze.mockImplementation(() => {
          bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_CANCELLED, {
            documentId: "doc-1",
            reason: "user requested",
          });
          return Promise.resolve();
        });

        await actions.reanalyze({ ocr: { languages: ["spa"] } });

        expect(usePipelineStore.getState().stage).toBe(PipelineStage.Ready);
        unsubscribe();
      });
    });

    it("retryWithPassword forwards the password to orchestrator.retryWithPassword", async () => {
      await actions.retryWithPassword("secret");
      expect(retryWithPassword).toHaveBeenCalledWith("doc-1", "secret");
    });

    it("addManualEntity forwards the request and returns the orchestrator's result", async () => {
      const request = { value: "José Pérez", entityType: EntityType.Person };
      const result = await actions.addManualEntity(request);
      expect(addManualEntity).toHaveBeenCalledWith("doc-1", request);
      expect(result).toEqual({ occurrenceCount: 1 });
    });

    it("getPageWords forwards the pageIndex and returns the orchestrator's words", () => {
      const words = [{ text: "hola", bbox: { x: 0, y: 0, width: 10, height: 10 } }];
      getPageWords.mockReturnValue(words);
      expect(actions.getPageWords(3)).toBe(words);
      expect(getPageWords).toHaveBeenCalledWith("doc-1", 3);
    });

    it("getPageSize forwards the pageIndex and returns the orchestrator's size", () => {
      getPageSize.mockReturnValue({ width: 100, height: 200 });
      expect(actions.getPageSize(3)).toEqual({ width: 100, height: 200 });
      expect(getPageSize).toHaveBeenCalledWith("doc-1", 3);
    });

    it("findText forwards the query and returns the orchestrator's matches", () => {
      const matches = [{ pageIndex: 0, bbox: { x: 0, y: 0, width: 1, height: 1 }, text: "ana" }];
      findText.mockReturnValue(matches);
      expect(actions.findText("ana")).toBe(matches);
      expect(findText).toHaveBeenCalledWith("doc-1", "ana");
    });

    it("requestExport emits EXPORT_REQUESTED with the options", () => {
      const options = {
        imageFormat: "jpeg" as const,
        jpegQuality: 0.8,
        dpi: 300,
        includeOriginalMetadata: false as const,
        filename: "out.pdf",
        includeMarkerLegend: false,
      };
      usePipelineStore.setState({
        error: {
          code: EngineErrorCode.EXPORT_FAILED,
          engineId: EngineId.Export,
          message: "previous failure",
          retryable: true,
          details: {},
        },
      });
      actions.requestExport(options);
      expect(usePipelineStore.getState().error).toBeNull();
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, {
        documentId: "doc-1",
        options,
      });
    });

    it("clears a failed export and accepts the subsequent successful result", () => {
      useDocumentStore.setState({ id: "doc-1" });
      usePipelineStore.setState({
        currentVersion: 6,
        error: {
          code: EngineErrorCode.EXPORT_FAILED,
          engineId: EngineId.Export,
          message: "first attempt failed",
          retryable: true,
          details: {},
        },
      });
      const options = {
        imageFormat: "jpeg" as const,
        jpegQuality: 0.8,
        dpi: 300,
        includeOriginalMetadata: false as const,
        filename: "retry.pdf",
        includeMarkerLegend: false,
      };

      expect(actions.requestExport(options)).toBe(true);
      expect(usePipelineStore.getState()).toMatchObject({
        exportingVersion: 6,
        exportResult: null,
        exportProgress: null,
        error: null,
      });

      const bus = createEventBus({ logger: { debug() {}, info() {}, warn() {}, error() {} } });
      const unsubscribe = subscribe(bus, {
        document: useDocumentStore,
        entities: useEntitiesStore,
        rules: useRulesStore,
        pipeline: usePipelineStore,
        viewer: useViewerStore,
        settings: useSettingsStore,
        unreadableInk: useUnreadableInkStore,
      });
      bus.emit(EventChannel.Export, EngineEvents.EXPORT_FINISHED, {
        documentId: "doc-1",
        blobUrl: "blob:retry",
        sizeBytes: 321,
        durationMs: 10,
      });
      expect(usePipelineStore.getState()).toMatchObject({
        exportedVersion: 6,
        exportingVersion: null,
        exportResult: { blobUrl: "blob:retry", sizeBytes: 321 },
        error: null,
      });
      unsubscribe();
    });

    it("cancel emits CANCEL_REQUESTED on the pipeline channel", () => {
      actions.cancel();
      expect(emit).toHaveBeenCalledWith(EventChannel.Pipeline, EngineEvents.CANCEL_REQUESTED, {
        documentId: "doc-1",
      });
    });

    it("closeDocument emits DOCUMENT_CLOSED and resets all stores", () => {
      useEntitiesStore.getState().addConflict({
        id: "conflict-1",
        groupId: "group-1",
        reason: ConflictReason.Overlap,
        candidates: [],
        resolved: false,
      });
      usePipelineStore.setState({ groupCount: 3 });

      actions.closeDocument();

      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.DOCUMENT_CLOSED, {
        documentId: "doc-1",
      });
      expect(useDocumentStore.getState().id).toBeNull();
      expect(useEntitiesStore.getState().conflicts).toEqual([]);
      expect(usePipelineStore.getState().groupCount).toBe(0);
    });
  });
});

describe("actions.previewEdit (ADR-170 §2)", () => {
  beforeEach(() => {
    previewEdit.mockReset();
    useDocumentStore.getState().reset();
  });

  it("sin documento no consulta y devuelve null", () => {
    expect(actions.previewEdit({ kind: "type", groupId: "g", type: EntityType.DNI })).toBeNull();
    expect(previewEdit).not.toHaveBeenCalled();
  });

  it("delega en el orchestrator con el documento activo", () => {
    useDocumentStore.setState({ id: "doc-1" });
    const preview = { groups: [] };
    previewEdit.mockReturnValue(preview);
    const request = { kind: "merge", sourceGroupId: "a", targetGroupIds: ["b"] } as const;
    expect(actions.previewEdit(request)).toBe(preview);
    expect(previewEdit).toHaveBeenCalledWith("doc-1", request);
  });

  it("un pedido que el Core rechaza (InvalidInputError) no rompe el diálogo: null", () => {
    useDocumentStore.setState({ id: "doc-1" });
    previewEdit.mockImplementation(() => {
      throw new Error("InvalidInputError");
    });
    expect(actions.previewEdit({ kind: "split", groupId: "g", occurrenceIds: ["o"] })).toBeNull();
  });
});

describe("actions.removeGroup (ADR-171 §5)", () => {
  beforeEach(() => {
    emit.mockClear();
    useDocumentStore.getState().reset();
    useRulesStore.getState().reset();
  });

  it("sin documento no emite nada", () => {
    actions.removeGroup("g1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("sin regla de grupo, solo pide la eliminación", () => {
    useDocumentStore.setState({ id: "doc-1" });
    useRulesStore.getState().addRule(makeRule({ id: "r-type", scope: "type" }));
    actions.removeGroup("g1");
    expect(emit.mock.calls).toEqual([
      [
        EventChannel.UI,
        EngineEvents.GROUP_REMOVE_REQUESTED,
        { documentId: "doc-1", groupId: "g1" },
      ],
    ]);
    expect(useRulesStore.getState().rules.map((rule) => rule.id)).toEqual(["r-type"]);
  });

  it("borra primero la regla de grupo (no queda huérfana) y después pide la eliminación", () => {
    useDocumentStore.setState({ id: "doc-1" });
    useRulesStore
      .getState()
      .addRule(makeRule({ id: "r-g1", scope: "group", target: { kind: "group", groupId: "g1" } }));
    useRulesStore
      .getState()
      .addRule(makeRule({ id: "r-g2", scope: "group", target: { kind: "group", groupId: "g2" } }));
    actions.removeGroup("g1");
    expect(emit.mock.calls).toEqual([
      [EventChannel.UI, EngineEvents.RULE_DELETED, { documentId: "doc-1", ruleId: "r-g1" }],
      [
        EventChannel.UI,
        EngineEvents.GROUP_REMOVE_REQUESTED,
        { documentId: "doc-1", groupId: "g1" },
      ],
    ]);
    expect(useRulesStore.getState().rules.map((rule) => rule.id)).toEqual(["r-g2"]);
    expect(usePipelineStore.getState().currentVersion).toBe(1);
  });
});

describe("pila de deshacer conectada al Core (ADR-172)", () => {
  beforeEach(() => {
    useDocumentStore.getState().reset();
    useRulesStore.getState().reset();
    useHistoryStore.setState({ past: [], future: [], live: [], busy: false });
    createEditCheckpoint.mockClear();
    restoreEditCheckpoint.mockClear();
    discardEditCheckpoints.mockClear();
    getSnapshot.mockClear();
  });

  it("toma y restaura puntos del documento activo, y rehidrata las reglas del snapshot", async () => {
    useDocumentStore.setState({ id: "doc-1" });
    createEditCheckpoint.mockReturnValueOnce("cp-before").mockReturnValueOnce("cp-now");
    restoreEditCheckpoint.mockResolvedValue(undefined);
    const restored = makeRule({ id: "r-restored" });
    getSnapshot.mockReturnValue({
      documentId: "doc-1",
      groups: [],
      conflicts: [],
      rules: [restored],
    });

    expect(useHistoryStore.getState().record("Fusionar")).toBe(true);
    expect(createEditCheckpoint).toHaveBeenCalledWith("doc-1");

    expect(await useHistoryStore.getState().undo()).toBe(true);
    expect(restoreEditCheckpoint).toHaveBeenCalledWith("doc-1", "cp-before");
    expect(getSnapshot).toHaveBeenCalledWith("doc-1");
    expect(useRulesStore.getState().rules).toEqual([restored]);
    expect(useHistoryStore.getState().future).toEqual([
      { checkpointId: "cp-now", label: "Fusionar" },
    ]);
  });

  it("undo and redo advance export version after successful identical restores", async () => {
    useDocumentStore.setState({ id: "doc-1" });
    createEditCheckpoint.mockReturnValueOnce("cp-before").mockReturnValueOnce("cp-now");
    restoreEditCheckpoint.mockResolvedValue(undefined);
    const snapshot = { documentId: "doc-1", groups: [], conflicts: [], rules: [] };
    getSnapshot.mockReturnValue(snapshot);
    usePipelineStore.setState({ currentVersion: 20 });
    expect(useHistoryStore.getState().record("Editar")).toBe(true);

    expect(await useHistoryStore.getState().undo()).toBe(true);
    expect(usePipelineStore.getState().currentVersion).toBe(21);
    expect(await useHistoryStore.getState().redo()).toBe(true);
    expect(usePipelineStore.getState().currentVersion).toBe(22);
    expect(restoreEditCheckpoint).toHaveBeenCalledTimes(2);
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("failed restore and empty history do not advance export version", async () => {
    useDocumentStore.setState({ id: "doc-1" });
    usePipelineStore.setState({ currentVersion: 30 });
    expect(await useHistoryStore.getState().undo()).toBe(false);
    createEditCheckpoint.mockReturnValueOnce("cp-before");
    useHistoryStore.getState().record("Editar");
    restoreEditCheckpoint.mockRejectedValueOnce(new Error("restore failed"));

    expect(await useHistoryStore.getState().undo()).toBe(false);
    expect(usePipelineStore.getState().currentVersion).toBe(30);
  });

  it("sin documento no hay punto: la edición no entra a la pila", () => {
    expect(useHistoryStore.getState().record("X")).toBe(false);
    expect(createEditCheckpoint).not.toHaveBeenCalled();
  });

  it("cerrar el documento vacía la pila y descarta sus puntos", () => {
    useDocumentStore.setState({ id: "doc-1" });
    createEditCheckpoint.mockReturnValue("cp-1");
    useHistoryStore.getState().record("A");

    actions.closeDocument();

    expect(discardEditCheckpoints).toHaveBeenCalledWith("doc-1");
    expect(useHistoryStore.getState().past).toEqual([]);
  });

  it("re-analizar vacía la pila (no cruza un re-análisis)", async () => {
    useDocumentStore.setState({ id: "doc-1" });
    createEditCheckpoint.mockReturnValue("cp-1");
    useHistoryStore.getState().record("A");

    await actions.reanalyze({ ocr: { languages: ["spa"] } });

    expect(useHistoryStore.getState().past).toEqual([]);
    expect(reanalyze).toHaveBeenCalled();
  });
});
