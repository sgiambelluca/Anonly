/**
 * `addManualEntity.ts` (ADR-061 §3/§6, ADR-169 §7, ADR-174 §4) — el camino
 * común de las tres vías de agregado manual. Mismo criterio de mock que
 * `actions.test.ts`: se reemplaza `core-adapter/index.js`.
 */

import {
  EntityType,
  ReplacementMode,
  type EntityGroup,
  type ManualEntityResult,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToastMessage } from "../components/common/toast.js";
import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";

const addManualEntity = vi.fn<() => Promise<ManualEntityResult | null>>();
const createEditCheckpoint = vi.fn();
const restoreEditCheckpoint = vi.fn();
const discardEditCheckpoints = vi.fn();

vi.mock("../core-adapter/index.js", () => ({
  getCore: () => ({
    bus: { emit: vi.fn(), on: vi.fn(), once: vi.fn(), off: vi.fn(), emitAsync: vi.fn() },
    orchestrator: {
      addManualEntity,
      createEditCheckpoint,
      restoreEditCheckpoint,
      discardEditCheckpoints,
      getState: vi.fn(),
    },
    engines: {},
  }),
}));

const { addManualEntityWithFeedback } = await import("../components/entities/addManualEntity.js");
const { useHistoryStore } = await import("../core-adapter/history.js");
const { subscribeToToasts } = await import("../components/common/toast.js");
const { subscribeToManualOverlapDialog } =
  await import("../components/conflicts/manualOverlapController.js");

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

function captureLastToast() {
  let last: ToastMessage | null = null;
  const unsubscribe = subscribeToToasts((toast) => {
    last = toast;
  });
  return { get: (): ToastMessage | null => last, unsubscribe };
}

function captureLastOpenedOverlap() {
  let last: string | null = null;
  const unsubscribe = subscribeToManualOverlapDialog((conflictId) => {
    last = conflictId;
  });
  return { get: (): string | null => last, unsubscribe };
}

describe("addManualEntityWithFeedback (ADR-174 §4, N-3)", () => {
  beforeEach(() => {
    addManualEntity.mockReset();
    createEditCheckpoint.mockReset();
    restoreEditCheckpoint.mockReset();
    discardEditCheckpoints.mockReset();
    createEditCheckpoint.mockReturnValue("cp-1");
    useDocumentStore.setState({ id: "doc-1", name: "a.pdf" });
    useEntitiesStore.getState().reset();
    useHistoryStore.setState({ past: [], future: [], live: [], busy: false });
  });

  it("sin documento activo: no-op, sin tocar la pila ni el Core", async () => {
    useDocumentStore.getState().reset();
    const feedback = await addManualEntityWithFeedback({
      value: "Juan Pérez",
      entityType: EntityType.Person,
    });
    expect(feedback).toBe("no-op");
    expect(addManualEntity).not.toHaveBeenCalled();
    expect(useHistoryStore.getState().past).toEqual([]);
  });

  it("occurrenceCount 0: not-found, y la entrada de deshacer registrada se retira (N-3)", async () => {
    addManualEntity.mockResolvedValue({ occurrenceCount: 0, heldConflictIds: [] });
    const toasts = captureLastToast();

    const feedback = await addManualEntityWithFeedback({
      value: "no existe",
      entityType: EntityType.Person,
    });

    expect(feedback).toBe("not-found");
    // La pila quedó como si nada se hubiera registrado: sin la entrada
    // fantasma que `recordEdit` metió antes de intentar el agregado.
    expect(useHistoryStore.getState().past).toEqual([]);
    expect(toasts.get()).toBeNull();
    toasts.unsubscribe();
  });

  it("occurrenceCount > 0 pero ningún grupo tiene el valor: not-found, entrada retirada (N-3)", async () => {
    // ADR-174 §4 / Components.md §3.4c: occurrenceCount > 0 solo no alcanza.
    addManualEntity.mockResolvedValue({ occurrenceCount: 2, heldConflictIds: [] });

    const feedback = await addManualEntityWithFeedback({
      value: "José Pérez",
      entityType: EntityType.Person,
    });

    expect(feedback).toBe("not-found");
    expect(useHistoryStore.getState().past).toEqual([]);
  });

  it("agregado exitoso: toast con Ver en la lista y Deshacer, la entrada queda en la pila", async () => {
    useEntitiesStore.getState().addGroup(group());
    addManualEntity.mockResolvedValue({ occurrenceCount: 2, heldConflictIds: [] });
    const toasts = captureLastToast();

    const feedback = await addManualEntityWithFeedback({
      value: "Juan Pérez",
      entityType: EntityType.Person,
    });

    expect(feedback).toBe("added");
    expect(useHistoryStore.getState().past).toHaveLength(1);
    expect(toasts.get()?.title).toBe("Agregaste «Juan Pérez»");
    expect(toasts.get()?.description).toBe("Persona N.º 06 · 2 apariciones ocultas");
    expect(toasts.get()?.actions?.map((action) => action.label)).toEqual([
      "Ver en la lista",
      "Deshacer",
    ]);
    toasts.unsubscribe();
  });

  // ADR-174 §4: un choque no es ni éxito ni "no se encontró" — abre
  // ManualOverlapDialog y no toca la pila (el literal quedó retenido, no es
  // un no-op).
  it("heldConflictIds no vacío: 'held', abre el diálogo con el primer conflicto, sin toast", async () => {
    addManualEntity.mockResolvedValue({
      occurrenceCount: 1,
      heldConflictIds: ["conflict-1", "conflict-2"],
    });
    const toasts = captureLastToast();
    const overlap = captureLastOpenedOverlap();

    const feedback = await addManualEntityWithFeedback({
      value: "juan.perez@example.com.",
      entityType: EntityType.Email,
    });

    expect(feedback).toBe("held");
    expect(overlap.get()).toBe("conflict-1");
    expect(toasts.get()).toBeNull();
    expect(useHistoryStore.getState().past).toHaveLength(1);
    toasts.unsubscribe();
    overlap.unsubscribe();
  });

  it("heldConflictIds manda por sobre un grupo que sí se haya formado con otra aparición", async () => {
    useEntitiesStore.getState().addGroup(group());
    addManualEntity.mockResolvedValue({ occurrenceCount: 3, heldConflictIds: ["conflict-1"] });
    const toasts = captureLastToast();

    const feedback = await addManualEntityWithFeedback({
      value: "Juan Pérez",
      entityType: EntityType.Person,
    });

    expect(feedback).toBe("held");
    expect(toasts.get()).toBeNull();
    toasts.unsubscribe();
  });
});
