import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it, vi } from "vitest";

import {
  historyCommandFor,
  isEditableTarget,
  resolveHistoryShortcut,
} from "../components/screens/historyShortcuts.js";
import { createHistoryStore, type EditCheckpointPort } from "../store/history.store.js";

// `editHistory.ts` llega al Core por `core-adapter/history.ts`; acá solo se
// prueba su parte pura (`withUndoAction`), así que el Core se reemplaza.
vi.mock("../core-adapter/index.js", () => ({ getCore: () => ({}) }));

const { discardLastEdit, UNDO_SHORTCUT_HINT, withUndoAction } =
  await import("../components/entities/editHistory.js");
const { removeConfirmMessage, removedToastText } =
  await import("../components/entities/undoableEdits.js");
const { useHistoryStore } = await import("../core-adapter/history.js");

/**
 * Un Core de mentira: el "estado" es un número, y cada punto guarda el valor
 * que tenía al tomarse. Alcanza para ver que deshacer vuelve exacto.
 */
function fakeCore(options: { readonly limit?: number } = {}) {
  let state = 0;
  let nextId = 0;
  const points = new Map<string, number>();
  const limit = options.limit ?? 50;
  const port: EditCheckpointPort = {
    create() {
      nextId += 1;
      const id = `cp${nextId}`;
      points.set(id, state);
      if (points.size > limit) {
        const oldest = points.keys().next().value;
        if (oldest !== undefined) points.delete(oldest);
      }
      return id;
    },
    restore(id) {
      const saved = points.get(id);
      if (saved === undefined) return Promise.reject(new Error("desconocido"));
      state = saved;
      return Promise.resolve();
    },
    discard() {
      points.clear();
    },
  };
  return {
    port,
    get state() {
      return state;
    },
    edit(value: number) {
      state = value;
    },
    get pointCount() {
      return points.size;
    },
  };
}

describe("history.store (ADR-172 §2)", () => {
  it("deshacer vuelve al estado anterior a la edición, y rehacer al de después", async () => {
    const core = fakeCore();
    const history = createHistoryStore(core.port);

    expect(history.getState().record("Fusionar")).toBe(true);
    core.edit(1);
    history.getState().record("Dividir");
    core.edit(2);

    expect(await history.getState().undo()).toBe(true);
    expect(core.state).toBe(1);
    expect(history.getState().past.map((entry) => entry.label)).toEqual(["Fusionar"]);
    expect(history.getState().future.map((entry) => entry.label)).toEqual(["Dividir"]);

    expect(await history.getState().undo()).toBe(true);
    expect(core.state).toBe(0);

    expect(await history.getState().redo()).toBe(true);
    expect(core.state).toBe(1);
    expect(await history.getState().redo()).toBe(true);
    expect(core.state).toBe(2);
    expect(history.getState().future).toEqual([]);
    expect(history.getState().past.map((entry) => entry.label)).toEqual(["Fusionar", "Dividir"]);
  });

  it("una edición nueva después de deshacer vacía lo que se podía rehacer", async () => {
    const core = fakeCore();
    const history = createHistoryStore(core.port);
    history.getState().record("A");
    core.edit(1);
    await history.getState().undo();
    expect(history.getState().future).toHaveLength(1);

    history.getState().record("B");
    expect(history.getState().future).toEqual([]);
  });

  it("con la pila vacía, deshacer y rehacer no hacen nada", async () => {
    const history = createHistoryStore(fakeCore().port);
    expect(await history.getState().undo()).toBe(false);
    expect(await history.getState().redo()).toBe(false);
  });

  it("si el Core no puede tomar el punto, la edición no entra a la pila", () => {
    const port: EditCheckpointPort = {
      create: () => {
        throw new Error("pasada de detección en curso");
      },
      restore: () => Promise.resolve(),
      discard: () => undefined,
    };
    const history = createHistoryStore(port);
    expect(history.getState().record("A")).toBe(false);
    expect(history.getState().past).toEqual([]);
  });

  it("refleja el límite del Core: lo que el Core descartó sale de la pila", async () => {
    const core = fakeCore({ limit: 3 });
    const history = createHistoryStore(core.port, 3);
    for (let value = 1; value <= 4; value += 1) {
      history.getState().record(`E${value}`);
      core.edit(value);
    }
    // Cuatro puntos con límite tres: el primero ya no existe en el Core.
    expect(history.getState().past.map((entry) => entry.label)).toEqual(["E2", "E3", "E4"]);

    // Deshacer también crea un punto (el del estado actual): se lleva el
    // siguiente más viejo, y la pila lo sabe antes de intentar restaurarlo.
    await history.getState().undo();
    expect(core.state).toBe(3);
    expect(history.getState().past.map((entry) => entry.label)).toEqual(["E3"]);
    expect(history.getState().future.map((entry) => entry.label)).toEqual(["E4"]);

    // En el fondo de una pila llena, el punto a restaurar es el más viejo:
    // se restaura igual, sin guardar el actual, y rehacer deja de estar.
    expect(await history.getState().undo()).toBe(true);
    expect(core.state).toBe(2);
    expect(history.getState().past).toEqual([]);
    expect(history.getState().future).toEqual([]);
  });

  it("un punto que el Core ya no tiene vacía la pila en vez de quedar trabada", async () => {
    const core = fakeCore();
    const history = createHistoryStore(core.port);
    history.getState().record("A");
    core.edit(1);
    core.port.discard();

    expect(await history.getState().undo()).toBe(false);
    expect(history.getState().past).toEqual([]);
    expect(history.getState().future).toEqual([]);
  });

  // ADR-174 §4 / N-3: un agregado manual que resultó `not-found`/`no-op`
  // registró un punto antes de intentar, pero no cambió nada. `discardLast`
  // retira esa entrada fantasma sin pedirle nada al Core.
  it("discardLast retira la última entrada de past sin tocar el Core", () => {
    const core = fakeCore();
    const history = createHistoryStore(core.port);
    history.getState().record("Agregaste «X»");
    core.edit(1);

    history.getState().discardLast();

    expect(history.getState().past).toEqual([]);
    // El punto sigue vivo en el Core (nunca se llamó a `discard`): solo se
    // retiró la entrada de la pila, no el checkpoint.
    expect(core.pointCount).toBe(1);
  });

  it("discardLast solo toca la última entrada de past, no future ni entradas previas", () => {
    const core = fakeCore();
    const history = createHistoryStore(core.port);
    history.getState().record("A");
    core.edit(1);
    history.getState().record("B");
    core.edit(2);

    history.getState().discardLast();

    expect(history.getState().past.map((entry) => entry.label)).toEqual(["A"]);
    expect(history.getState().future).toEqual([]);
  });

  it("discardLast con la pila vacía no rompe nada", () => {
    const history = createHistoryStore(fakeCore().port);
    history.getState().discardLast();
    expect(history.getState().past).toEqual([]);
  });

  // ADR-175, no bloqueante 5 de la revisión 2: `record()` vacía `future`
  // como CUALQUIER edición nueva (ADR-172 §2) — pero una edición especulativa
  // que termina descartándose (`discardLast`) no debería haberse llevado
  // puesta la pila de rehacer que el usuario ya tenía.
  it("discardLast restaura future al valor que tenía antes del record que lo vació", async () => {
    const core = fakeCore();
    const history = createHistoryStore(core.port);
    history.getState().record("A");
    core.edit(1);
    expect(await history.getState().undo()).toBe(true);
    // El undo dejó algo para rehacer.
    expect(history.getState().future).toHaveLength(1);

    // Una edición especulativa (p. ej. un agregado `not-found`): `record()`
    // vacía `future` igual que cualquier edición nueva...
    history.getState().record("Agregaste «X»");
    expect(history.getState().future).toEqual([]);

    // ...pero como no cambió nada, se descarta y `future` vuelve a estar.
    history.getState().discardLast();
    expect(history.getState().past).toEqual([]);
    expect(history.getState().future).toHaveLength(1);
    expect(history.getState().future[0]?.label).toBe("A");
  });

  it("clear vacía las dos pilas y descarta los puntos del Core", async () => {
    const core = fakeCore();
    const history = createHistoryStore(core.port);
    history.getState().record("A");
    core.edit(1);
    await history.getState().undo();

    history.getState().clear();
    expect(history.getState().past).toEqual([]);
    expect(history.getState().future).toEqual([]);
    expect(core.pointCount).toBe(0);
  });

  it("un deshacer en vuelo no se pisa con otro", async () => {
    const core = fakeCore();
    let release: () => void = () => undefined;
    const slowPort: EditCheckpointPort = {
      ...core.port,
      restore: (id) =>
        new Promise<void>((resolve) => {
          release = () => {
            void core.port.restore(id).then(resolve);
          };
        }),
    };
    const history = createHistoryStore(slowPort);
    history.getState().record("A");
    core.edit(1);
    history.getState().record("B");
    core.edit(2);

    const first = history.getState().undo();
    expect(await history.getState().undo()).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(core.state).toBe(1);
  });
});

describe("discardLastEdit (ADR-174 §4 / N-3)", () => {
  it("retira la última entrada de past del store real, sin tocar el Core", () => {
    useHistoryStore.setState({
      past: [{ checkpointId: "cp1", label: "Agregaste «X»" }],
      future: [],
      live: ["cp1"],
      busy: false,
    });

    discardLastEdit();

    expect(useHistoryStore.getState().past).toEqual([]);
    // `live` no cambia: `discardLast` no le pide nada al Core, solo saca la
    // entrada de la pila (ver history.store.ts#discardLast).
    expect(useHistoryStore.getState().live).toEqual(["cp1"]);
  });

  it("con la pila vacía no rompe nada", () => {
    useHistoryStore.setState({ past: [], future: [], live: [], busy: false });
    discardLastEdit();
    expect(useHistoryStore.getState().past).toEqual([]);
  });
});

describe("toasts con Deshacer (ADR-172 §3)", () => {
  it("suma Deshacer con la pista Ctrl+Z después de las otras acciones", () => {
    const undo = vi.fn();
    const seeInList = { label: "Ver en la lista", run: vi.fn() };
    const toast = withUndoAction({ title: "Agregaste «X»", actions: [seeInList] }, true, undo);
    expect(toast.actions?.map((action) => action.label)).toEqual(["Ver en la lista", "Deshacer"]);
    expect(toast.actions?.[1]?.shortcut).toBe(UNDO_SHORTCUT_HINT);
    expect(UNDO_SHORTCUT_HINT).toBe("Ctrl+Z");
    toast.actions?.[1]?.run();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("sin punto registrado, no ofrece un Deshacer que no existe", () => {
    const toast = withUndoAction({ title: "X" }, false, vi.fn());
    expect(toast.actions).toBeUndefined();
  });
});

describe("Eliminar entidad (ADR-171 §5)", () => {
  it("el toast dice que deja la lista y que no se va a ocultar", () => {
    expect(removedToastText("Banco Nación")).toEqual({
      title: "Eliminaste «Banco Nación»",
      description: "Ya no está en la lista ni se va a ocultar",
    });
  });

  it("la confirmación nombra la entidad y avisa que queda a la vista", () => {
    const message = removeConfirmMessage("Banco Nación");
    expect(message).toContain("«Banco Nación»");
    expect(message).toContain("queda a la vista en el documento exportado");
  });
});

describe("atajos (ADR-172 §3)", () => {
  const key = (overrides: Partial<Parameters<typeof historyCommandFor>[0]> = {}) => ({
    key: "z",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  });

  it("Ctrl/Cmd+Z deshace; Ctrl/Cmd+Y y Ctrl/Cmd+Shift+Z rehacen", () => {
    expect(historyCommandFor(key())).toBe("undo");
    expect(historyCommandFor(key({ ctrlKey: false, metaKey: true }))).toBe("undo");
    expect(historyCommandFor(key({ key: "y" }))).toBe("redo");
    expect(historyCommandFor(key({ key: "Z", shiftKey: true }))).toBe("redo");
    expect(historyCommandFor(key({ ctrlKey: false }))).toBeNull();
    expect(historyCommandFor(key({ altKey: true }))).toBeNull();
    expect(historyCommandFor(key({ key: "x" }))).toBeNull();
  });

  it("en un campo de texto manda el deshacer nativo", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("no actúa con un diálogo abierto, en un campo, en una pasada de detección ni exportando", () => {
    const base = { stage: PipelineStage.Ready, editableTarget: false, dialogOpen: false };
    expect(resolveHistoryShortcut(key(), base)).toBe("undo");
    expect(resolveHistoryShortcut(key(), { ...base, dialogOpen: true })).toBeNull();
    expect(resolveHistoryShortcut(key(), { ...base, editableTarget: true })).toBeNull();
    for (const stage of [
      PipelineStage.Importing,
      PipelineStage.Extracting,
      PipelineStage.OCRing,
      PipelineStage.Detecting,
      PipelineStage.Grouping,
      PipelineStage.Exporting,
    ]) {
      expect(resolveHistoryShortcut(key(), { ...base, stage })).toBeNull();
    }
    expect(resolveHistoryShortcut(key(), { ...base, stage: PipelineStage.Done })).toBe("undo");
  });
});
