/**
 * `applyEdits.ts` (ADR-172 §2, ADR-174 §3-§4) — cada función sigue el mismo
 * patrón: `recordEdit` antes de emitir, el pedido de siempre por `actions`, y
 * —si la superficie lo lleva— un toast con "Deshacer". Mismo criterio de
 * mock que `actions.test.ts`: se reemplaza `core-adapter/index.js` para
 * poder ver qué emite el bus, sin levantar un Core real.
 */

import {
  EntityType,
  EngineEvents,
  EventChannel,
  ReplacementMode,
  type EntityGroup,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToastMessage } from "../components/common/toast.js";
import { useDocumentStore } from "../store/document.store.js";

const emit = vi.fn();
const createEditCheckpoint = vi.fn();
const restoreEditCheckpoint = vi.fn();
const discardEditCheckpoints = vi.fn();

vi.mock("../core-adapter/index.js", () => ({
  getCore: () => ({
    bus: { emit, on: vi.fn(), once: vi.fn(), off: vi.fn(), emitAsync: vi.fn() },
    orchestrator: {
      createEditCheckpoint,
      restoreEditCheckpoint,
      discardEditCheckpoints,
      getState: vi.fn(),
    },
    engines: {},
  }),
}));

const applyEdits = await import("../components/entities/applyEdits.js");
const { useHistoryStore } = await import("../core-adapter/history.js");
const { subscribeToToasts } = await import("../components/common/toast.js");

function group(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "g1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 06]",
    indexInType: 6,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[PERSONA 06]",
      mask: "x",
      synthetic: "y",
      placeholderLadder: ["[PERSONA 06]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Recolecta el último toast mostrado (o `null` si ninguno). */
function captureLastToast() {
  let last: ToastMessage | null = null;
  const unsubscribe = subscribeToToasts((toast) => {
    last = toast;
  });
  return {
    get(): ToastMessage | null {
      return last;
    },
    unsubscribe,
  };
}

describe("applyEdits", () => {
  beforeEach(() => {
    emit.mockClear();
    createEditCheckpoint.mockReset();
    restoreEditCheckpoint.mockReset();
    discardEditCheckpoints.mockReset();
    createEditCheckpoint.mockReturnValue("cp-1");
    useDocumentStore.setState({ id: "doc-1", name: "a.pdf" });
    useHistoryStore.setState({ past: [], future: [], live: [], busy: false });
  });

  it("applyEnabled no hace nada si ningún grupo cambia de estado", () => {
    const toasts = captureLastToast();
    applyEdits.applyEnabled({
      groups: [group({ enabled: true })],
      next: true,
      label: "Juan Pérez",
      isType: false,
    });
    expect(emit).not.toHaveBeenCalled();
    expect(toasts.get()).toBeNull();
    toasts.unsubscribe();
  });

  it("applyEnabled emite GROUP_UPDATE_REQUESTED por cada grupo que cambia y confirma con toast", () => {
    const toasts = captureLastToast();
    applyEdits.applyEnabled({
      groups: [group({ id: "g1", enabled: true }), group({ id: "g2", enabled: false })],
      next: false,
      label: "Personas",
      isType: true,
    });
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { enabled: false },
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(toasts.get()?.title).toBe("Personas: 1 grupo no se anonimiza");
    expect(toasts.get()?.actions?.some((action) => action.label === "Deshacer")).toBe(true);
    expect(useHistoryStore.getState().past).toHaveLength(1);
    toasts.unsubscribe();
  });

  it("applyReplacementValue actualiza el valor y confirma con toast", () => {
    const toasts = captureLastToast();
    applyEdits.applyReplacementValue({ group: group(), value: "[OCULTO]" });
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { replacementValue: "[OCULTO]" },
    });
    expect(toasts.get()?.title).toBe("«Juan Pérez» se reemplaza por «[OCULTO]»");
    toasts.unsubscribe();
  });

  it("restoreComputedValue reaplica el mismo modo", () => {
    applyEdits.restoreComputedValue(group({ replacementMode: ReplacementMode.Mask }));
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { replacementMode: ReplacementMode.Mask },
    });
  });

  it("applyPersonGender actualiza el género sin toast, pero entra a la pila", () => {
    const toasts = captureLastToast();
    applyEdits.applyPersonGender({ groupId: "g1", label: "Juan Pérez", next: "f" });
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { personGender: "f" },
    });
    expect(toasts.get()).toBeNull();
    expect(useHistoryStore.getState().past).toHaveLength(1);
    toasts.unsubscribe();
  });

  it("applyGroupMode cambia el modo de reemplazo sin toast", () => {
    applyEdits.applyGroupMode(group(), ReplacementMode.Mask);
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { replacementMode: ReplacementMode.Mask },
    });
  });

  it("applyLeaveVisible deshabilita el grupo", () => {
    applyEdits.applyLeaveVisible(group());
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { enabled: false },
    });
  });

  it("applyTypeChange cambia el tipo y confirma con toast, con o sin preview", () => {
    const toasts = captureLastToast();
    applyEdits.applyTypeChange(group(), EntityType.Organization, undefined);
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { type: EntityType.Organization },
    });
    expect(toasts.get()?.title).toBe("Cambiaste el tipo de «Juan Pérez»");
    expect(toasts.get()?.description).toBeUndefined();
    toasts.unsubscribe();
  });

  it("applyMerge emite un pedido por paso y una sola entrada de pila", () => {
    const toasts = captureLastToast();
    applyEdits.applyMerge({
      steps: [
        { sourceGroupId: "g2", targetGroupId: "g1" },
        { sourceGroupId: "g3", targetGroupId: "g1" },
      ],
      toast: { title: "Fusionaste 2 entidades" },
      historyLabel: "Fusionar",
    });
    expect(emit).toHaveBeenNthCalledWith(1, EventChannel.UI, EngineEvents.GROUP_MERGE_REQUESTED, {
      documentId: "doc-1",
      sourceGroupId: "g2",
      targetGroupId: "g1",
    });
    expect(emit).toHaveBeenNthCalledWith(2, EventChannel.UI, EngineEvents.GROUP_MERGE_REQUESTED, {
      documentId: "doc-1",
      sourceGroupId: "g3",
      targetGroupId: "g1",
    });
    expect(useHistoryStore.getState().past).toHaveLength(1);
    expect(toasts.get()?.title).toBe("Fusionaste 2 entidades");
    toasts.unsubscribe();
  });

  it("applyMerge sin toast (null) no muestra nada", () => {
    const toasts = captureLastToast();
    applyEdits.applyMerge({
      steps: [{ sourceGroupId: "g2", targetGroupId: "g1" }],
      toast: null,
      historyLabel: "Fusionar",
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(toasts.get()).toBeNull();
    toasts.unsubscribe();
  });

  it("applySplit emite GROUP_SPLIT_REQUESTED y confirma con toast", () => {
    const toasts = captureLastToast();
    applyEdits.applySplit({
      group: group(),
      occurrenceIds: ["occ-1", "occ-2"],
      toast: { title: "Dividiste «Juan Pérez»" },
    });
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_SPLIT_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      occurrenceIds: ["occ-1", "occ-2"],
    });
    expect(toasts.get()?.title).toBe("Dividiste «Juan Pérez»");
    toasts.unsubscribe();
  });

  it("applyRemove pide GROUP_REMOVE_REQUESTED y confirma con toast", () => {
    const toasts = captureLastToast();
    applyEdits.applyRemove(group());
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_REMOVE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
    });
    expect(toasts.get()?.title).toBe("Eliminaste «Juan Pérez»");
    toasts.unsubscribe();
  });

  it("applyConflictResolution manda la grafía y el tipo elegidos", () => {
    applyEdits.applyConflictResolution({
      conflictId: "conflict-1",
      groupId: "g1",
      spelling: "Juan  Pérez",
      entityType: EntityType.Organization,
      label: "Juan Pérez",
    });
    expect(emit).toHaveBeenNthCalledWith(1, EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
      documentId: "doc-1",
      groupId: "g1",
      patch: { canonicalValue: "Juan  Pérez" },
    });
    expect(emit).toHaveBeenNthCalledWith(
      2,
      EventChannel.UI,
      EngineEvents.CONFLICT_RESOLVE_REQUESTED,
      {
        documentId: "doc-1",
        conflictId: "conflict-1",
        entityType: EntityType.Organization,
      },
    );
  });

  it("applyConflictResolution sin grafía no toca canonicalValue", () => {
    applyEdits.applyConflictResolution({
      conflictId: "conflict-1",
      groupId: "g1",
      spelling: null,
      entityType: undefined,
      label: "Juan Pérez",
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
      documentId: "doc-1",
      conflictId: "conflict-1",
    });
  });

  // ADR-174 §3-§4: ManualOverlapDialog.
  describe("applyManualOverlapResolution", () => {
    it("winner: manual manda el winner y confirma con un toast de éxito con Deshacer", () => {
      const toasts = captureLastToast();
      applyEdits.applyManualOverlapResolution({
        conflictId: "conflict-1",
        winner: "manual",
        value: "Juan Pérez",
      });
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
        documentId: "doc-1",
        conflictId: "conflict-1",
        winner: "manual",
      });
      expect(toasts.get()?.title).toBe("Ocultaste «Juan Pérez»");
      expect(toasts.get()?.tone).toBe("success");
      expect(toasts.get()?.actions?.some((action) => action.label === "Deshacer")).toBe(true);
      expect(useHistoryStore.getState().past).toHaveLength(1);
      toasts.unsubscribe();
    });

    it("winner: detected manda el winner y un toast distinto", () => {
      const toasts = captureLastToast();
      applyEdits.applyManualOverlapResolution({
        conflictId: "conflict-1",
        winner: "detected",
        value: "Juan Pérez",
      });
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.CONFLICT_RESOLVE_REQUESTED, {
        documentId: "doc-1",
        conflictId: "conflict-1",
        winner: "detected",
      });
      expect(toasts.get()?.title).toBe("Dejaste «Juan Pérez» sin ocultar");
      toasts.unsubscribe();
    });
  });
});
