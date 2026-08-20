/**
 * `degraded.store` (ADR-062 §2/§3) — el veredicto de "el reemplazo no entró"
 * viaja **por página** y la UI lo necesita **por grupo**.
 *
 * Los tres casos que se rompen solos si alguien "simplifica" el store:
 * acumular en vez de reemplazar, tratar la ausencia como "no sé", y dejar
 * entrar los eventos del panel original.
 */

import { AnnotationKind, type Annotation } from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import { describePages } from "../components/entities/degradedMessage.js";
import {
  selectDegradedPages,
  selectGroupIsDegraded,
  useDegradedStore,
} from "../store/degraded.store.js";

function annotation(groupId: string): Annotation {
  return {
    id: `ann-${groupId}`,
    groupId,
    pageIndex: 0,
    bbox: { x: 0, y: 0, width: 40, height: 12 },
    kind: AnnotationKind.Degraded,
  };
}

describe("degraded.store", () => {
  beforeEach(() => {
    useDegradedStore.getState().reset();
  });

  it("mapea el veredicto de una página a los grupos que lo tienen", () => {
    useDegradedStore.getState().setPageVerdict(2, [annotation("g1"), annotation("g2")]);

    expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(true);
    expect(selectGroupIsDegraded(useDegradedStore.getState(), "g3")).toBe(false);
    expect(selectDegradedPages(useDegradedStore.getState(), "g1")).toEqual([2]);
  });

  it("un grupo degradado en varias páginas las lista todas, en orden", () => {
    useDegradedStore.getState().setPageVerdict(5, [annotation("g1")]);
    useDegradedStore.getState().setPageVerdict(0, [annotation("g1")]);
    useDegradedStore.getState().setPageVerdict(3, [annotation("g1")]);

    expect(selectDegradedPages(useDegradedStore.getState(), "g1")).toEqual([0, 3, 5]);
  });

  // ADR-062 §2: cada evento trae el veredicto COMPLETO de esa página en ese
  // render. Si se acumulara, arreglar el reemplazo (re-render con veredicto
  // vacío) dejaría la marca encendida para siempre.
  it("el veredicto de una página REEMPLAZA al anterior, no se acumula", () => {
    useDegradedStore.getState().setPageVerdict(1, [annotation("g1")]);
    expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(true);

    useDegradedStore.getState().setPageVerdict(1, []);
    expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(false);
  });

  it("re-renderizar una página no borra el veredicto de las otras", () => {
    useDegradedStore.getState().setPageVerdict(1, [annotation("g1")]);
    useDegradedStore.getState().setPageVerdict(2, [annotation("g2")]);

    useDegradedStore.getState().setPageVerdict(1, []);

    expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(false);
    expect(selectGroupIsDegraded(useDegradedStore.getState(), "g2")).toBe(true);
  });

  // Un `PREVIEW_UPDATED` por página llega en cada scroll y en cada cambio de
  // zoom. Sin esta guarda, el árbol de entidades entero se re-renderiza en
  // cada uno de ellos aunque nada haya cambiado.
  it("un veredicto idéntico conserva la referencia del mapa", () => {
    useDegradedStore.getState().setPageVerdict(1, [annotation("g1")]);
    const first = useDegradedStore.getState().byPage;

    useDegradedStore.getState().setPageVerdict(1, [annotation("g1")]);
    expect(useDegradedStore.getState().byPage).toBe(first);

    useDegradedStore.getState().setPageVerdict(4, []);
    expect(useDegradedStore.getState().byPage).toBe(first);
  });

  it("reset limpia todo — el veredicto es del documento abierto", () => {
    useDegradedStore.getState().setPageVerdict(1, [annotation("g1")]);
    useDegradedStore.getState().reset();

    expect(selectGroupIsDegraded(useDegradedStore.getState(), "g1")).toBe(false);
  });
});

describe("describePages", () => {
  // El `pageIndex` del Core es 0-based; el usuario cuenta desde 1. Que se
  // le diga "la página 0" es el error más fácil de cometer acá y el más
  // desconcertante de leer.
  it("cuenta las páginas desde 1, no desde 0", () => {
    expect(describePages([0])).toBe("la página 1");
  });

  it("enumera varias páginas en castellano legible", () => {
    expect(describePages([0, 2])).toBe("las páginas 1 y 3");
    expect(describePages([0, 2, 6])).toBe("las páginas 1, 3 y 7");
  });

  it("sin páginas devuelve vacío — no hay aviso que dar", () => {
    expect(describePages([])).toBe("");
  });

  // Regla de ADR-062: el aviso lo lee alguien que no sabe qué es un token.
  it("el texto no filtra jerga técnica", () => {
    const texto = describePages([0, 3]);
    for (const jerga of ["token", "placeholder", "bbox", "degrad", "ratio"]) {
      expect(texto.toLowerCase()).not.toContain(jerga);
    }
  });
});
