/**
 * `documentTypeEdits.ts` y las acciones de los tipos del documento
 * (`React_Client.md` §3.9, §3.12; ADR-225; ADR-229 §2): crear, editar, borrar y
 * guardar un tipo, «Crear y agregar» y «Crear y cambiar» como **una** entrada del
 * deshacer, y la relectura de los tipos después de un `undo`.
 *
 * Mismo criterio de mock que `apply-edits.test.ts`: se reemplaza
 * `core-adapter/index.js` para ver qué le pide la interfaz al Core sin levantar uno.
 */

import {
  EngineEvents,
  EntityType,
  EventChannel,
  ReplacementMode,
  type ManualEntityResult,
  type Rule,
  type UserEntityTypeDefinition,
} from "@anonly/anonymization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToastMessage } from "../components/common/toast.js";
import { DEFAULT_DETECTION_STATE, DETECTION_STORAGE_KEY } from "../store/detectionState.js";
import { useDocumentStore } from "../store/document.store.js";
import { useEntitiesStore } from "../store/entities.store.js";
import { useRulesStore } from "../store/rules.store.js";

import { userType } from "./helpers/detectionFixtures.js";
import { makeGroup } from "./helpers/groupFixtures.js";

const emit = vi.fn();
const createEditCheckpoint = vi.fn();
const restoreEditCheckpoint = vi.fn();
const discardEditCheckpoints = vi.fn();
const defineDocumentEntityType =
  vi.fn<(documentId: string, type: UserEntityTypeDefinition) => void>();
const updateDocumentEntityType =
  vi.fn<(documentId: string, type: UserEntityTypeDefinition) => Promise<void>>();
const removeDocumentEntityType = vi.fn<(documentId: string, typeId: string) => Promise<void>>();
const getDocumentEntityTypes =
  vi.fn<(documentId: string) => ReadonlyArray<UserEntityTypeDefinition>>();
const addManualEntity = vi.fn<() => Promise<ManualEntityResult | null>>();
const getSnapshot = vi.fn();

vi.mock("../core-adapter/index.js", () => ({
  recreateCore: vi.fn(),
  getCore: () => ({
    bus: { emit, on: vi.fn(), once: vi.fn(), off: vi.fn(), emitAsync: vi.fn() },
    orchestrator: {
      createEditCheckpoint,
      restoreEditCheckpoint,
      discardEditCheckpoints,
      defineDocumentEntityType,
      updateDocumentEntityType,
      removeDocumentEntityType,
      getDocumentEntityTypes,
      addManualEntity,
      getState: vi.fn(),
    },
    engines: { grouping: { getSnapshot } },
  }),
}));

const edits = await import("../components/entities/documentTypeEdits.js");
const { addManualEntityWithFeedback } = await import("../components/entities/addManualEntity.js");
const { applyTypeChange } = await import("../components/entities/applyEdits.js");
const { actions } = await import("../core-adapter/actions.js");
const { useHistoryStore } = await import("../core-adapter/history.js");
const { useDetectionStore } = await import("../store/detection.store.js");
const { subscribeToToasts } = await import("../components/common/toast.js");

const afiliado = userType(0, "Número de afiliado");
const legajo = userType(1, "Legajo");

/** La sesión de Grouping en memoria: lo que `define` agrega es lo que `getDocumentEntityTypes` devuelve. */
let session: UserEntityTypeDefinition[] = [];

function captureToasts() {
  const seen: ToastMessage[] = [];
  const unsubscribe = subscribeToToasts((toast) => {
    if (toast !== null) seen.push(toast);
  });
  return { seen, last: (): ToastMessage | undefined => seen.at(-1), unsubscribe };
}

function makeRule(id: string, scope: Rule["scope"], target: Rule["target"]): Rule {
  return {
    id,
    scope,
    target,
    mode: ReplacementMode.Mask,
    priority: 1,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

function stubLocalStorage(): void {
  let stored: string | null = null;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => stored,
      setItem: (key: string, value: string) => {
        if (key === DETECTION_STORAGE_KEY) stored = value;
      },
    },
  });
}

describe("tipos del documento: acciones del usuario", () => {
  beforeEach(() => {
    session = [];
    emit.mockReset();
    createEditCheckpoint.mockReset();
    restoreEditCheckpoint.mockReset();
    discardEditCheckpoints.mockReset();
    defineDocumentEntityType.mockReset();
    updateDocumentEntityType.mockReset();
    removeDocumentEntityType.mockReset();
    getDocumentEntityTypes.mockReset();
    addManualEntity.mockReset();
    getSnapshot.mockReset();
    let checkpoint = 0;
    createEditCheckpoint.mockImplementation(() => `cp-${(checkpoint += 1)}`);
    restoreEditCheckpoint.mockResolvedValue(undefined);
    getSnapshot.mockReturnValue({ rules: [] });
    defineDocumentEntityType.mockImplementation((_documentId, type) => {
      session.push(type);
    });
    updateDocumentEntityType.mockImplementation(async (_documentId, type) => {
      session = session.map((existing) => (existing.id === type.id ? type : existing));
    });
    removeDocumentEntityType.mockImplementation(async (_documentId, typeId) => {
      session = session.filter((existing) => existing.id !== typeId);
    });
    getDocumentEntityTypes.mockImplementation(() => [...session]);
    stubLocalStorage();
    useDocumentStore.setState({ id: "doc-1", name: "a.pdf" });
    useEntitiesStore.getState().reset();
    useRulesStore.getState().reset();
    useHistoryStore.setState({ past: [], future: [], live: [], busy: false });
    useDetectionStore.setState({ saved: DEFAULT_DETECTION_STATE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("crear", () => {
    it("registra el punto de deshacer ANTES, define el tipo y relee los del documento", () => {
      const order: string[] = [];
      createEditCheckpoint.mockImplementation(() => {
        order.push("record");
        return "cp-1";
      });
      defineDocumentEntityType.mockImplementation((_documentId, type) => {
        order.push("define");
        session.push(type);
      });
      const toasts = captureToasts();

      expect(edits.applyCreateDocumentType(afiliado)).toBe(true);

      expect(order).toEqual(["record", "define"]);
      expect(defineDocumentEntityType).toHaveBeenCalledWith("doc-1", afiliado);
      expect(useEntitiesStore.getState().documentTypes).toEqual([afiliado]);
      expect(useHistoryStore.getState().past).toHaveLength(1);
      // El aviso trae «Deshacer» con la pista Ctrl+Z (UX_Guidelines.md §11b.11).
      const toast = toasts.last();
      expect(toast?.title).toBe("Creaste el tipo «Número de afiliado»");
      expect(toast?.edit).toBe(true);
      expect(toast?.actions?.[0]).toMatchObject({ label: "Deshacer", shortcut: "Ctrl+Z" });
      toasts.unsubscribe();
    });

    it("si el Core lo rechaza: retira la entrada, avisa del error y no deja tipo", () => {
      defineDocumentEntityType.mockImplementation(() => {
        throw new Error("InvalidInputError");
      });
      const toasts = captureToasts();

      expect(edits.applyCreateDocumentType(afiliado)).toBe(false);

      expect(useHistoryStore.getState().past).toEqual([]);
      expect(useEntitiesStore.getState().documentTypes).toEqual([]);
      expect(toasts.last()).toMatchObject({ tone: "error" });
      toasts.unsubscribe();
    });

    it("sin documento activo no define nada", () => {
      useDocumentStore.getState().reset();
      actions.defineDocumentType(afiliado);
      expect(defineDocumentEntityType).not.toHaveBeenCalled();
    });
  });

  describe("editar", () => {
    it("registra, espera al Core, relee y avisa con «Deshacer»", async () => {
      session.push(afiliado);
      useEntitiesStore.getState().setDocumentTypes([afiliado]);
      const renamed = { ...afiliado, name: "Afiliado" };
      const toasts = captureToasts();

      await expect(edits.applyUpdateDocumentType(renamed)).resolves.toBe(true);

      expect(updateDocumentEntityType).toHaveBeenCalledWith("doc-1", renamed);
      expect(useEntitiesStore.getState().documentTypes).toEqual([renamed]);
      expect(useHistoryStore.getState().past).toHaveLength(1);
      expect(toasts.last()?.title).toBe("Cambiaste el tipo «Afiliado»");
      expect(toasts.last()?.actions?.[0]?.shortcut).toBe("Ctrl+Z");
      toasts.unsubscribe();
    });

    it("si el Core lo rechaza, retira la entrada y avisa del error", async () => {
      updateDocumentEntityType.mockRejectedValue(new Error("InvalidInputError"));
      const toasts = captureToasts();
      await expect(edits.applyUpdateDocumentType(afiliado)).resolves.toBe(false);
      expect(useHistoryStore.getState().past).toEqual([]);
      expect(toasts.last()).toMatchObject({ tone: "error" });
      toasts.unsubscribe();
    });

    it("sin documento activo no pide nada", async () => {
      useDocumentStore.getState().reset();
      await actions.updateDocumentType(afiliado);
      expect(updateDocumentEntityType).not.toHaveBeenCalled();
    });
  });

  describe("borrar", () => {
    const typeRule = makeRule("r-type", "type", { kind: "type", entityType: afiliado.id });

    it("borra las reglas del tipo y de sus grupos, y recién después le pide al Core que borre el tipo", async () => {
      const order: string[] = [];
      session.push(afiliado);
      useEntitiesStore.getState().setDocumentTypes([afiliado]);
      useEntitiesStore.getState().addGroup(makeGroup({ id: "g-own", type: afiliado.id }));
      useEntitiesStore.getState().addGroup(makeGroup({ id: "g-other", type: EntityType.Person }));
      const groupRule = makeRule("r-group", "group", { kind: "group", groupId: "g-own" });
      const otherRule = makeRule("r-other", "group", { kind: "group", groupId: "g-other" });
      useRulesStore.setState({ rules: [typeRule, groupRule, otherRule] });
      emit.mockImplementation((_channel, event: EngineEvents, payload: { ruleId?: string }) => {
        if (event === EngineEvents.RULE_DELETED) order.push(`rule:${payload.ruleId ?? ""}`);
      });
      removeDocumentEntityType.mockImplementation(async (_documentId, typeId) => {
        order.push("core");
        session = session.filter((existing) => existing.id !== typeId);
      });
      const toasts = captureToasts();

      await expect(edits.applyRemoveDocumentType(afiliado)).resolves.toBe(true);

      expect(order).toEqual(["rule:r-type", "rule:r-group", "core"]);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.RULE_DELETED, {
        documentId: "doc-1",
        ruleId: "r-type",
      });
      expect(useRulesStore.getState().rules.map((rule) => rule.id)).toEqual(["r-other"]);
      expect(removeDocumentEntityType).toHaveBeenCalledWith("doc-1", afiliado.id);
      expect(useEntitiesStore.getState().documentTypes).toEqual([]);
      expect(useHistoryStore.getState().past).toHaveLength(1);
      expect(toasts.last()).toMatchObject({
        title: "Borraste el tipo «Número de afiliado»",
        tone: "deletion",
      });
      toasts.unsubscribe();
    });

    it("sin reglas ni grupos, solo le pide al Core que lo borre", async () => {
      session.push(afiliado);
      await edits.applyRemoveDocumentType(afiliado);
      expect(emit).not.toHaveBeenCalled();
      expect(removeDocumentEntityType).toHaveBeenCalledOnce();
    });

    it("si el Core lo rechaza, retira la entrada y avisa del error", async () => {
      removeDocumentEntityType.mockRejectedValue(new Error("InvalidInputError"));
      const toasts = captureToasts();
      await expect(edits.applyRemoveDocumentType(afiliado)).resolves.toBe(false);
      expect(useHistoryStore.getState().past).toEqual([]);
      expect(toasts.last()).toMatchObject({ tone: "error" });
      toasts.unsubscribe();
    });

    it("sin documento activo no pide nada", async () => {
      useDocumentStore.getState().reset();
      await actions.removeDocumentType(afiliado.id);
      expect(removeDocumentEntityType).not.toHaveBeenCalled();
    });
  });

  describe("sin punto de restauración (el Core no pudo tomarlo)", () => {
    beforeEach(() => {
      createEditCheckpoint.mockReturnValue(null);
    });

    it("crear, editar y borrar se hacen igual, pero el aviso no ofrece «Deshacer»", async () => {
      session.push(afiliado);
      const toasts = captureToasts();

      expect(edits.applyCreateDocumentType(legajo)).toBe(true);
      expect(toasts.last()?.actions).toBeUndefined();
      await expect(edits.applyUpdateDocumentType({ ...afiliado, name: "Afiliado" })).resolves.toBe(
        true,
      );
      expect(toasts.last()?.actions).toBeUndefined();
      await expect(edits.applyRemoveDocumentType(afiliado)).resolves.toBe(true);
      expect(toasts.last()?.actions).toBeUndefined();
      expect(useHistoryStore.getState().past).toEqual([]);
      toasts.unsubscribe();
    });

    it("si además el Core rechaza el pedido, solo avisa del error: no hay entrada que retirar", async () => {
      defineDocumentEntityType.mockImplementation(() => {
        throw new Error("InvalidInputError");
      });
      updateDocumentEntityType.mockRejectedValue(new Error("InvalidInputError"));
      removeDocumentEntityType.mockRejectedValue(new Error("InvalidInputError"));
      const toasts = captureToasts();

      expect(edits.applyCreateDocumentType(afiliado)).toBe(false);
      await expect(edits.applyUpdateDocumentType(afiliado)).resolves.toBe(false);
      await expect(edits.applyRemoveDocumentType(afiliado)).resolves.toBe(false);

      expect(toasts.seen.filter((toast) => toast.tone === "error")).toHaveLength(3);
      toasts.unsubscribe();
    });
  });

  describe("guardar para los próximos documentos (ADR-225 §5)", () => {
    it("no es una edición del documento: sin punto de deshacer, y su «Deshacer» no lleva Ctrl+Z", () => {
      useEntitiesStore.getState().setDocumentTypes([afiliado]);
      const toasts = captureToasts();

      edits.applySaveDocumentType(afiliado);

      expect(createEditCheckpoint).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().past).toEqual([]);
      expect(useDetectionStore.getState().saved.userTypes).toEqual([afiliado]);
      expect(useEntitiesStore.getState().savedDuringDocument.has(afiliado.id)).toBe(true);
      const toast = toasts.last();
      expect(toast?.title).toBe("«Número de afiliado» se guardó para los próximos documentos");
      expect(toast?.edit).toBeUndefined();
      expect(toast?.actions).toHaveLength(1);
      expect(toast?.actions?.[0]?.label).toBe("Deshacer");
      expect(toast?.actions?.[0]?.shortcut).toBeUndefined();
      toasts.unsubscribe();
    });

    it("su «Deshacer» lo quita de lo guardado", () => {
      useEntitiesStore.getState().setDocumentTypes([afiliado]);
      const toasts = captureToasts();
      edits.applySaveDocumentType(afiliado);

      toasts.last()?.actions?.[0]?.run();

      expect(useDetectionStore.getState().saved.userTypes).toEqual([]);
      expect(useEntitiesStore.getState().savedDuringDocument.has(afiliado.id)).toBe(false);
      toasts.unsubscribe();
    });

    it("un tipo que no es del documento no se guarda", () => {
      const toasts = captureToasts();
      expect(actions.saveDocumentType(afiliado.id)).toBe(false);
      edits.applySaveDocumentType(afiliado);
      expect(useDetectionStore.getState().saved.userTypes).toEqual([]);
      expect(toasts.seen).toEqual([]);
      toasts.unsubscribe();
    });
  });

  describe("«Crear y agregar» (ADR-229 §2): una sola entrada del deshacer", () => {
    const found: ManualEntityResult = { occurrenceCount: 2, heldConflictIds: [], groupIds: ["g1"] };

    it("registra una vez, define el tipo y después agrega, nombrando el tipo nuevo en el aviso", async () => {
      const order: string[] = [];
      createEditCheckpoint.mockImplementation(() => {
        order.push("record");
        return "cp-1";
      });
      defineDocumentEntityType.mockImplementation((_documentId, type) => {
        order.push("define");
        session.push(type);
      });
      addManualEntity.mockImplementation(async () => {
        order.push("add");
        useEntitiesStore.getState().addGroup(makeGroup({ id: "g1", type: afiliado.id }));
        return found;
      });
      const toasts = captureToasts();

      const feedback = await addManualEntityWithFeedback(
        { value: "20-1234", entityType: afiliado.id },
        afiliado,
      );

      expect(feedback).toBe("added");
      expect(order).toEqual(["record", "define", "add"]);
      expect(useHistoryStore.getState().past).toHaveLength(1);
      expect(toasts.last()?.description).toBe("Número de afiliado N.º 01 · 2 apariciones ocultas");
      toasts.unsubscribe();
    });

    it("sin tipo nuevo, no define nada", async () => {
      addManualEntity.mockResolvedValue(found);
      await addManualEntityWithFeedback({ value: "Juan", entityType: EntityType.Person });
      expect(defineDocumentEntityType).not.toHaveBeenCalled();
    });

    it("si el Core rechaza el tipo, no agrega, retira la entrada y avisa del error", async () => {
      defineDocumentEntityType.mockImplementation(() => {
        throw new Error("InvalidInputError");
      });
      const toasts = captureToasts();

      const feedback = await addManualEntityWithFeedback(
        { value: "20-1234", entityType: afiliado.id },
        afiliado,
      );

      expect(feedback).toBe("error");
      expect(addManualEntity).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().past).toEqual([]);
      expect(toasts.last()).toMatchObject({ tone: "error" });
      toasts.unsubscribe();
    });

    it("si el valor no se encuentra, la entrada se conserva: crear el tipo sí cambió algo", async () => {
      addManualEntity.mockResolvedValue({ occurrenceCount: 0, heldConflictIds: [], groupIds: [] });
      const feedback = await addManualEntityWithFeedback(
        { value: "no está", entityType: afiliado.id },
        afiliado,
      );
      expect(feedback).toBe("not-found");
      expect(useHistoryStore.getState().past).toHaveLength(1);
      expect(useEntitiesStore.getState().documentTypes).toEqual([afiliado]);
    });

    it("si el resultado rompe el invariante, también conserva la entrada del tipo creado", async () => {
      addManualEntity.mockResolvedValue({ occurrenceCount: 1, heldConflictIds: [], groupIds: [] });
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const feedback = await addManualEntityWithFeedback(
        { value: "x", entityType: afiliado.id },
        afiliado,
      );
      expect(feedback).toBe("error");
      expect(useHistoryStore.getState().past).toHaveLength(1);
      expect(errorLog).toHaveBeenCalled();
    });
  });

  describe("«Crear y cambiar» (ADR-229 §2)", () => {
    it("una sola entrada: define el tipo y después cambia el tipo del grupo", () => {
      const group = makeGroup({ id: "g1" });
      const order: string[] = [];
      createEditCheckpoint.mockImplementation(() => {
        order.push("record");
        return "cp-1";
      });
      defineDocumentEntityType.mockImplementation((_documentId, type) => {
        order.push("define");
        session.push(type);
      });
      emit.mockImplementation((_channel, event: EngineEvents) => {
        if (event === EngineEvents.GROUP_UPDATE_REQUESTED) order.push("update");
      });
      const toasts = captureToasts();

      expect(applyTypeChange(group, afiliado.id, undefined, afiliado)).toBe(true);

      expect(order).toEqual(["record", "define", "update"]);
      expect(emit).toHaveBeenCalledWith(EventChannel.UI, EngineEvents.GROUP_UPDATE_REQUESTED, {
        documentId: "doc-1",
        groupId: "g1",
        patch: { type: afiliado.id },
      });
      expect(useHistoryStore.getState().past).toHaveLength(1);
      expect(toasts.last()?.title).toBe("«Juan Pérez» ahora es Número de afiliado");
      expect(toasts.last()?.description).toBe("Tipo nuevo, solo de este documento.");
      toasts.unsubscribe();
    });

    it("sin tipo nuevo, cambia el tipo sin definir nada", () => {
      expect(applyTypeChange(makeGroup(), EntityType.Address, undefined)).toBe(true);
      expect(defineDocumentEntityType).not.toHaveBeenCalled();
    });

    it("si el Core rechaza el tipo, no cambia nada, retira la entrada y avisa", () => {
      defineDocumentEntityType.mockImplementation(() => {
        throw new Error("InvalidInputError");
      });
      const toasts = captureToasts();
      expect(applyTypeChange(makeGroup({ id: "g1" }), afiliado.id, undefined, afiliado)).toBe(
        false,
      );
      expect(emit).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().past).toEqual([]);
      expect(toasts.last()).toMatchObject({ tone: "error" });
      toasts.unsubscribe();
    });
  });

  describe("undo / redo (React_Client.md §3.12, ADR-225 §6)", () => {
    it("después de deshacer, la interfaz vuelve a leer los tipos del documento", async () => {
      edits.applyCreateDocumentType(afiliado);
      expect(useEntitiesStore.getState().documentTypes).toEqual([afiliado]);
      // El punto de restauración se lleva la definición de la sesión.
      restoreEditCheckpoint.mockImplementation(async () => {
        session = [];
      });

      await expect(useHistoryStore.getState().undo()).resolves.toBe(true);

      expect(useEntitiesStore.getState().documentTypes).toEqual([]);
    });

    it("un tipo guardado durante el documento no se pierde por deshacer: se vuelve a definir, vacío", async () => {
      // Se crea, se guarda (aviso con su «Deshacer», no entra a la pila) y se deshace la creación.
      edits.applyCreateDocumentType(legajo);
      edits.applySaveDocumentType(legajo);
      restoreEditCheckpoint.mockImplementation(async () => {
        session = [];
      });

      await expect(useHistoryStore.getState().undo()).resolves.toBe(true);

      expect(defineDocumentEntityType).toHaveBeenLastCalledWith("doc-1", legajo);
      expect(useEntitiesStore.getState().documentTypes).toEqual([legajo]);
      expect(useEntitiesStore.getState().groupsByType.get(legajo.id)).toBeUndefined();
    });
  });
});
