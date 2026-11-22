/**
 * Los tipos del documento en `entities.store` (`React_Client.md` §3.9) y la
 * relectura que repone un tipo guardado durante el documento (ADR-225 §6).
 */

import type { UserEntityTypeDefinition } from "@anonly/anonymization-core";
import { EntityType, ReplacementMode } from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reconcileDocumentTypes, type DocumentTypesPort } from "../store/documentTypes.js";
import { NO_FILTERS, setDocumentTypesPort, useEntitiesStore } from "../store/entities.store.js";

import { userType } from "./helpers/detectionFixtures.js";
import { makeGroup } from "./helpers/groupFixtures.js";

const afiliado = userType(0, "Número de afiliado");
const legajo = userType(1, "Legajo");

/** Un puerto con una "sesión" en memoria: lo que `read` devuelve es lo que `define` agregó. */
function fakePort(initial: ReadonlyArray<UserEntityTypeDefinition>, saved = [legajo]) {
  const session = [...initial];
  const define = vi.fn((definition: UserEntityTypeDefinition) => {
    session.push(definition);
  });
  const port: DocumentTypesPort = {
    read: () => [...session],
    define,
    savedDefinition: (id) => saved.find((definition) => definition.id === id),
  };
  return { port, session, define };
}

describe("reconcileDocumentTypes", () => {
  it("sin tipos guardados durante el documento, devuelve lo que dice la sesión", () => {
    const { port, define } = fakePort([afiliado]);
    expect(reconcileDocumentTypes(port, new Set())).toEqual([afiliado]);
    expect(define).not.toHaveBeenCalled();
  });

  it("repone un tipo guardado durante el documento que la restauración se llevó (ADR-225 §6)", () => {
    const { port, define } = fakePort([afiliado]);
    const result = reconcileDocumentTypes(port, new Set([legajo.id]));
    expect(define).toHaveBeenCalledWith(legajo);
    expect(result).toEqual([afiliado, legajo]);
  });

  it("si el tipo guardado sigue en la sesión, no lo vuelve a definir", () => {
    const { port, define } = fakePort([legajo]);
    expect(reconcileDocumentTypes(port, new Set([legajo.id]))).toEqual([legajo]);
    expect(define).not.toHaveBeenCalled();
  });

  it("sin definición guardada para ese id, no hay nada que reponer", () => {
    const { port, define } = fakePort([], []);
    expect(reconcileDocumentTypes(port, new Set([legajo.id]))).toEqual([]);
    expect(define).not.toHaveBeenCalled();
  });

  it("si la sesión rechaza la definición, no rompe y devuelve cómo quedó", () => {
    const { port } = fakePort([afiliado]);
    const rejecting: DocumentTypesPort = {
      ...port,
      define: () => {
        throw new Error("sin sesión");
      },
    };
    expect(reconcileDocumentTypes(rejecting, new Set([legajo.id]))).toEqual([afiliado]);
  });
});

describe("entities.store: tipos del documento", () => {
  beforeEach(() => {
    setDocumentTypesPort(null);
    useEntitiesStore.getState().reset();
  });

  it("arranca sin tipos del documento ni guardados", () => {
    expect(useEntitiesStore.getState().documentTypes).toEqual([]);
    expect(useEntitiesStore.getState().savedDuringDocument.size).toBe(0);
  });

  it("refreshDocumentTypes lee el puerto y refleja la sesión", () => {
    const { port } = fakePort([afiliado]);
    setDocumentTypesPort(port);
    useEntitiesStore.getState().refreshDocumentTypes();
    expect(useEntitiesStore.getState().documentTypes).toEqual([afiliado]);
  });

  it("sin puerto, refreshDocumentTypes no hace nada", () => {
    useEntitiesStore.getState().setDocumentTypes([afiliado]);
    useEntitiesStore.getState().refreshDocumentTypes();
    expect(useEntitiesStore.getState().documentTypes).toEqual([afiliado]);
  });

  it("después de un undo, repone el tipo guardado durante el documento", () => {
    const { port, session } = fakePort([afiliado, legajo]);
    setDocumentTypesPort(port);
    useEntitiesStore.getState().markTypeSaved(legajo.id);
    // El undo se llevó a `legajo` de la sesión.
    session.splice(session.indexOf(legajo), 1);
    useEntitiesStore.getState().refreshDocumentTypes();
    expect(useEntitiesStore.getState().documentTypes.map((type) => type.id)).toEqual([
      afiliado.id,
      legajo.id,
    ]);
  });

  it("markTypeSaved / unmarkTypeSaved", () => {
    const store = useEntitiesStore.getState();
    store.markTypeSaved(legajo.id);
    expect(useEntitiesStore.getState().savedDuringDocument.has(legajo.id)).toBe(true);
    useEntitiesStore.getState().unmarkTypeSaved(legajo.id);
    expect(useEntitiesStore.getState().savedDuringDocument.has(legajo.id)).toBe(false);
    // Quitar uno que no está no cambia nada.
    const before = useEntitiesStore.getState().savedDuringDocument;
    useEntitiesStore.getState().unmarkTypeSaved(legajo.id);
    expect(useEntitiesStore.getState().savedDuringDocument).toBe(before);
  });

  it("reset vacía los tipos del documento, los guardados y los filtros", () => {
    const store = useEntitiesStore.getState();
    store.setDocumentTypes([afiliado]);
    store.markTypeSaved(afiliado.id);
    store.setFilters({ ...NO_FILTERS, modes: new Set([ReplacementMode.Mask]) });
    useEntitiesStore.getState().reset();
    const after = useEntitiesStore.getState();
    expect(after.documentTypes).toEqual([]);
    expect(after.savedDuringDocument.size).toBe(0);
    expect(after.filters).toBe(NO_FILTERS);
  });
});

describe("entities.store: filtros", () => {
  beforeEach(() => {
    useEntitiesStore.getState().reset();
  });

  it("setFilters y clearFilters son de la interfaz y no tocan los grupos", () => {
    const store = useEntitiesStore.getState();
    store.addGroup(makeGroup());
    const filters = { ...NO_FILTERS, review: new Set(["disabled" as const]) };
    useEntitiesStore.getState().setFilters(filters);
    expect(useEntitiesStore.getState().filters).toBe(filters);
    expect(useEntitiesStore.getState().groupsByType.get(EntityType.Person)).toHaveLength(1);
    useEntitiesStore.getState().clearFilters();
    expect(useEntitiesStore.getState().filters).toBe(NO_FILTERS);
  });
});

describe("entities.store: grupos de un tipo propio", () => {
  beforeEach(() => {
    useEntitiesStore.getState().reset();
  });

  it("addGroup crea el bucket del tipo propio al llegar su primer grupo", () => {
    useEntitiesStore.getState().addGroup(makeGroup({ id: "h1", type: afiliado.id }));
    expect(
      useEntitiesStore
        .getState()
        .groupsByType.get(afiliado.id)
        ?.map((g) => g.id),
    ).toEqual(["h1"]);
  });

  it("updateGroup mueve un grupo entre un tipo base y uno propio", () => {
    const store = useEntitiesStore.getState();
    store.addGroup(makeGroup({ id: "g1", type: EntityType.Person }));
    useEntitiesStore.getState().updateGroup(makeGroup({ id: "g1", type: afiliado.id }));
    const state = useEntitiesStore.getState();
    expect(state.groupsByType.get(EntityType.Person)).toEqual([]);
    expect(state.groupsByType.get(afiliado.id)?.map((g) => g.id)).toEqual(["g1"]);
  });

  it("removeGroup y updateReplacement funcionan en un tipo propio", () => {
    const store = useEntitiesStore.getState();
    store.addGroup(makeGroup({ id: "g1", type: afiliado.id }));
    useEntitiesStore.getState().updateReplacement("g1", ReplacementMode.Mask, "XXXX");
    expect(useEntitiesStore.getState().groupsByType.get(afiliado.id)?.[0]?.replacementValue).toBe(
      "XXXX",
    );
    useEntitiesStore.getState().removeGroup("g1");
    expect(useEntitiesStore.getState().groupsByType.get(afiliado.id)).toEqual([]);
  });
});
