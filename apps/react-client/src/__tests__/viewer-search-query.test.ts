/**
 * `viewer.store.searchQuery` (ADR-084 §1).
 *
 * El campo existe para un motivo puntual: "Ver ocurrencias" del panel de
 * entidades tiene que poder escribir la consulta del `DocumentSearchBox`, que
 * vive en el otro extremo del árbol de componentes. Mientras la consulta era
 * un `useState` local del buscador, eso era imposible sin atravesar cinco
 * niveles de props.
 *
 * Este repo no tiene infraestructura de render de componentes
 * (`vitest.config.ts` usa `environment: node`), así que lo testeable es el
 * store — que es donde vive la decisión del ADR.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useViewerStore } from "../store/viewer.store.js";

/*
 * LO QUE ESTOS TESTS **NO** CUBREN, y rompió en prueba manual:
 *
 * Estos casos verifican el store. El cableado que hace útil al campo vive en
 * `DocumentSearchBox`, y ahí estuvo el bug: la búsqueda se disparaba desde el
 * `onChange` del input, así que una consulta escrita **desde el store** por
 * "Ver ocurrencias" aparecía en la caja y no buscaba nada hasta que el usuario
 * tipeaba una letra. El input nunca emite `change` cuando el valor llega de
 * afuera.
 *
 * El fix cuelga la búsqueda de un efecto sobre `query`, así que los dos
 * caminos (tipear y "Ver ocurrencias") pasan por el mismo lugar. **No es
 * testeable acá**: `vitest.config.ts` usa `environment: node` y este repo no
 * tiene infraestructura de render de componentes. Verificado a mano en el
 * browser (consulta escrita desde el menú → "1 de 1 · pág. 1" sin tipear;
 * tipear y limpiar siguen funcionando). Si alguna vez se agrega jsdom, este
 * es el primer caso que merece un test de componente.
 */

describe("viewer.store.searchQuery (ADR-084)", () => {
  beforeEach(() => {
    useViewerStore.getState().reset();
  });

  it("arranca vacío", () => {
    expect(useViewerStore.getState().searchQuery).toBe("");
  });

  it("setSearchQuery la escribe — es lo único que hace 'Ver ocurrencias'", () => {
    useViewerStore.getState().setSearchQuery("Pablo Román Fortes");
    expect(useViewerStore.getState().searchQuery).toBe("Pablo Román Fortes");
  });

  it("la cadena vacía limpia la búsqueda", () => {
    useViewerStore.getState().setSearchQuery("Pablo Román Fortes");
    useViewerStore.getState().setSearchQuery("");
    expect(useViewerStore.getState().searchQuery).toBe("");
  });

  it("NO es por panel: es un solo valor, no un Record por ViewerKind", () => {
    // ADR-084 §1: `currentPageIndex`/`visibleRange` son por panel desde
    // ADR-054 §1, pero el buscador existe una sola vez, sobre el `original`.
    // Hacerlo por-`kind` sería inventar una simetría que la UI no tiene.
    useViewerStore.getState().setSearchQuery("Fiscalía");
    // Un `Record<ViewerKind, string>` no tendría estos dos: `searchQuery` es
    // UN valor, no uno por panel (ADR-084 §1) — el buscador existe una sola
    // vez, sobre el panel `original`.
    const state = useViewerStore.getState();
    expect(state.searchQuery).not.toHaveProperty("original");
    expect(state.searchQuery).not.toHaveProperty("anonymized");
    state.setSearchQuery("Belgrano");
    expect(useViewerStore.getState().searchQuery).toBe("Belgrano");
  });

  it("reset() la limpia junto con el resto del estado del visor", () => {
    useViewerStore.getState().setSearchQuery("Fiscalía");
    useViewerStore.getState().reset();
    expect(useViewerStore.getState().searchQuery).toBe("");
  });
});
