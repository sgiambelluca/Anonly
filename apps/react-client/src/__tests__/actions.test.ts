import {
  ConflictReason,
  EngineEvents,
  EventChannel,
  ReplacementMode,
  type Rule,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { usePipelineStore } from "../store/pipeline.store.js";
import { useRulesStore } from "../store/rules.store.js";
import { useViewerStore } from "../store/viewer.store.js";

const emit = vi.fn();
const importDocument = vi.fn().mockResolvedValue(undefined);
const retryWithPassword = vi.fn().mockResolvedValue(undefined);
const reanalyze = vi.fn().mockResolvedValue(undefined);

vi.mock("../core-adapter/index.js", () => ({
  getCore: () => ({
    bus: { emit, on: vi.fn(), once: vi.fn(), off: vi.fn(), emitAsync: vi.fn() },
    orchestrator: {
      importDocument,
      retryWithPassword,
      reanalyze,
      cancel: vi.fn(),
      closeDocument: vi.fn(),
      getState: vi.fn(),
      dispose: vi.fn(),
    },
  }),
}));

const { actions } = await import("../core-adapter/actions.js");

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
    importDocument.mockClear();
    retryWithPassword.mockClear();
    reanalyze.mockClear();
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
    actions.resolveConflict("conflict-1", ReplacementMode.Mask);
    actions.requestRender([0, 1], "original");
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

  it("actions requiring an active document no-op when none is open (async orchestrator calls)", async () => {
    await actions.reanalyze({ ner: { enabled: false } });
    await actions.retryWithPassword("secret");

    expect(reanalyze).not.toHaveBeenCalled();
    expect(retryWithPassword).not.toHaveBeenCalled();
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

    // ADR-060 §6 / ADR-069 §4: lo que `PersonGenderSelect` emite por cada uno
    // de sus tres estados. "neutral" viaja como valor explícito, nunca como
    // ausencia de la clave (ver el comentario en `actions.ts` junto al patch).
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

    it("resolveConflict emits CONFLICT_RESOLVE_REQUESTED", () => {
      actions.resolveConflict("conflict-1", ReplacementMode.Redact);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
        documentId: "doc-1",
        conflictId: "conflict-1",
        mode: ReplacementMode.Redact,
      });
    });

    it("requestRender omits scale when not provided", () => {
      actions.requestRender([0, 1], "original", "preview");
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
        documentId: "doc-1",
        pageIndices: [0, 1],
        kind: "original",
        mode: "preview",
      });
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
      actions.requestRender([2, 3], "anonymized");
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RENDER_REQUESTED, {
        documentId: "doc-1",
        pageIndices: [2, 3],
        kind: "anonymized",
        mode: "preview",
      });
    });

    it("reanalyze forwards the patch to orchestrator.reanalyze", async () => {
      await actions.reanalyze({ ocr: { languages: ["spa"] } });
      expect(reanalyze).toHaveBeenCalledWith("doc-1", { ocr: { languages: ["spa"] } });
    });

    it("retryWithPassword forwards the password to orchestrator.retryWithPassword", async () => {
      await actions.retryWithPassword("secret");
      expect(retryWithPassword).toHaveBeenCalledWith("doc-1", "secret");
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
      actions.requestExport(options);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.EXPORT_REQUESTED, {
        documentId: "doc-1",
        options,
      });
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
