/**
 * `addManualEntity.ts` (ADR-061 §3/§6, ADR-169 §7, ADR-174 §4, ADR-175 §3-§4)
 * — el camino común de las tres vías de agregado manual. Mismo criterio de
 * mock que `actions.test.ts`: se reemplaza `core-adapter/index.js`.
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
  let last: ReadonlyArray<string> | null = null;
  const unsubscribe = subscribeToManualOverlapDialog((conflictIds) => {
    last = conflictIds;
  });
  return { get: (): ReadonlyArray<string> | null => last, unsubscribe };
}

/** Silencia `console.error` del caso "error" (ADR-175 §3) sin perder la aserción de que se llamó. */
function captureConsoleError() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

describe("addManualEntityWithFeedback (ADR-174 §4, ADR-175 §3-§4, N-3)", () => {
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
    addManualEntity.mockResolvedValue({ occurrenceCount: 0, heldConflictIds: [], groupIds: [] });
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

  it("agregado exitoso: nombra el primer grupo de groupIds, toast con Ver en la lista y Deshacer", async () => {
    useEntitiesStore.getState().addGroup(group());
    addManualEntity.mockResolvedValue({
      occurrenceCount: 2,
      heldConflictIds: [],
      groupIds: ["g1"],
    });
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

  it("agregado exitoso con un groupId que ya no resuelve en el store: toast sin 'Ver en la lista'", async () => {
    // Defensivo: `groupIds` viene del Core, pero para cuando la UI lo lee el
    // store podría no tener ese id (no debería pasar, pero no tiene que
    // romper).
    addManualEntity.mockResolvedValue({
      occurrenceCount: 1,
      heldConflictIds: [],
      groupIds: ["fantasma"],
    });
    const toasts = captureLastToast();

    const feedback = await addManualEntityWithFeedback({
      value: "Juan Pérez",
      entityType: EntityType.Person,
    });

    expect(feedback).toBe("added");
    expect(toasts.get()?.description).toBe("Persona · 1 aparición oculta");
    // Sin grupo resuelto no hay "Ver en la lista" — nada a donde llevar al
    // usuario —, pero "Deshacer" sigue (la edición sí quedó registrada).
    expect(toasts.get()?.actions?.map((action) => action.label)).toEqual(["Deshacer"]);
    toasts.unsubscribe();
  });

  // ADR-174 §4 / ADR-175 §4: un choque no es ni éxito ni "no se encontró" —
  // abre ManualOverlapDialog con TODOS los heldConflictIds, y no toca la
  // pila (el literal quedó retenido, no es un no-op).
  it("heldConflictIds no vacío: 'held', abre el diálogo con TODOS los ids, sin toast", async () => {
    addManualEntity.mockResolvedValue({
      occurrenceCount: 1,
      heldConflictIds: ["conflict-1", "conflict-2"],
      groupIds: [],
    });
    const toasts = captureLastToast();
    const overlap = captureLastOpenedOverlap();

    const feedback = await addManualEntityWithFeedback({
      value: "juan.perez@example.com.",
      entityType: EntityType.Email,
    });

    expect(feedback).toBe("held");
    expect(overlap.get()).toEqual(["conflict-1", "conflict-2"]);
    expect(toasts.get()).toBeNull();
    expect(useHistoryStore.getState().past).toHaveLength(1);
    toasts.unsubscribe();
    overlap.unsubscribe();
  });

  it("heldConflictIds manda por sobre groupIds no vacío", async () => {
    useEntitiesStore.getState().addGroup(group());
    addManualEntity.mockResolvedValue({
      occurrenceCount: 3,
      heldConflictIds: ["conflict-1"],
      groupIds: ["g1"],
    });
    const toasts = captureLastToast();

    const feedback = await addManualEntityWithFeedback({
      value: "Juan Pérez",
      entityType: EntityType.Person,
    });

    expect(feedback).toBe("held");
    expect(toasts.get()).toBeNull();
    toasts.unsubscribe();
  });

  // ADR-175 §3: occurrenceCount > 0 sin heldConflictIds ni groupIds rompe el
  // invariante del Core — nunca se dice "no se encontró" sobre algo que el
  // Core sí encontró.
  it("invariante roto: 'error', toast de error, entrada retirada y logueado", async () => {
    const consoleError = captureConsoleError();
    addManualEntity.mockResolvedValue({ occurrenceCount: 3, heldConflictIds: [], groupIds: [] });
    const toasts = captureLastToast();

    const feedback = await addManualEntityWithFeedback({
      value: "Juan Pérez",
      entityType: EntityType.Person,
    });

    expect(feedback).toBe("error");
    expect(useHistoryStore.getState().past).toEqual([]);
    expect(toasts.get()?.title).toBe("No se pudo agregar «Juan Pérez».");
    expect(toasts.get()?.tone).toBe("error");
    expect(consoleError).toHaveBeenCalledTimes(1);
    toasts.unsubscribe();
    consoleError.mockRestore();
  });
});
