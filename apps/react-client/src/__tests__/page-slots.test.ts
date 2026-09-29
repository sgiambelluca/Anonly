/**
 * `pageSlots.ts` — geometría vertical del visor con franja de aviso en las
 * páginas `unreadableInk` (ADR-190 §4, `ui/Components.md` §5.3/§5.4).
 *
 * Los tests de `apps/react-client` corren en Node sin jsdom: lo que se prueba
 * es la regla de alto y de desplazamiento, que es lo que hace que el scroll no
 * quede corrido ni las páginas se encimen (el `.tsx` solo la aplica).
 */

import { describe, expect, it } from "vitest";

import { computeCurrentPageIndexFromScroll } from "../components/viewer/currentPageIndex.js";
import {
  UNREADABLE_STRIP_PX,
  computePageSlots,
  scrollTopForPage,
  slotIndexAtOffset,
} from "../components/viewer/pageSlots.js";
import { pageStride } from "../components/viewer/viewerGestures.js";

const BASE = 844; // pageStride(800): página + separador.

describe("computePageSlots", () => {
  it("sin páginas marcadas, las filas son uniformes: offset = índice × paso", () => {
    const slots = computePageSlots({ pageCount: 5, baseHeight: BASE, stripPages: new Set() });
    expect(slots.heights).toEqual([BASE, BASE, BASE, BASE, BASE]);
    expect(slots.offsets).toEqual([0, BASE, 2 * BASE, 3 * BASE, 4 * BASE]);
    expect(slots.totalHeight).toBe(5 * BASE);
  });

  it("usa el paso real del visor (página + separador) como alto base", () => {
    const slots = computePageSlots({
      pageCount: 2,
      baseHeight: pageStride(800),
      stripPages: new Set(),
    });
    expect(slots.heights[0]).toBe(BASE);
  });

  it("una página marcada suma exactamente la franja a su fila y empuja a las siguientes", () => {
    const slots = computePageSlots({ pageCount: 4, baseHeight: BASE, stripPages: new Set([1]) });
    expect(slots.heights).toEqual([BASE, BASE + UNREADABLE_STRIP_PX, BASE, BASE]);
    expect(slots.offsets).toEqual([
      0,
      BASE,
      BASE + BASE + UNREADABLE_STRIP_PX,
      BASE + BASE + UNREADABLE_STRIP_PX + BASE,
    ]);
    expect(slots.totalHeight).toBe(4 * BASE + UNREADABLE_STRIP_PX);
  });

  it("las filas no se encimen: cada una empieza donde termina la anterior, y la última llega al total", () => {
    const slots = computePageSlots({
      pageCount: 10,
      baseHeight: BASE,
      stripPages: new Set([0, 3, 4, 9]),
    });
    for (let index = 1; index < 10; index += 1) {
      const previousEnd = (slots.offsets[index - 1] ?? 0) + (slots.heights[index - 1] ?? 0);
      expect(slots.offsets[index]).toBe(previousEnd);
    }
    expect((slots.offsets[9] ?? 0) + (slots.heights[9] ?? 0)).toBe(slots.totalHeight);
    expect(slots.totalHeight).toBe(10 * BASE + 4 * UNREADABLE_STRIP_PX);
  });

  it("la franja es de alto fijo: no depende del zoom", () => {
    for (const baseHeight of [BASE / 2, BASE, BASE * 3]) {
      const slots = computePageSlots({ pageCount: 3, baseHeight, stripPages: new Set([2]) });
      expect((slots.heights[2] ?? 0) - baseHeight).toBe(UNREADABLE_STRIP_PX);
    }
  });

  it("el layout depende solo de las páginas marcadas: agregar o quitar entidades no lo mueve", () => {
    // La función ni siquiera recibe entidades: la misma marca da la misma
    // geometría, con o sin ellas (UX-10).
    const params = { pageCount: 6, baseHeight: BASE, stripPages: new Set([2, 5]) };
    expect(computePageSlots(params)).toEqual(computePageSlots({ ...params }));
  });

  it("ignora índices marcados fuera del documento", () => {
    const slots = computePageSlots({ pageCount: 2, baseHeight: BASE, stripPages: new Set([7]) });
    expect(slots.totalHeight).toBe(2 * BASE);
  });

  it("sin páginas (o con un conteo negativo) no hay filas", () => {
    for (const pageCount of [0, -3]) {
      const slots = computePageSlots({ pageCount, baseHeight: BASE, stripPages: new Set() });
      expect(slots).toEqual({ offsets: [], heights: [], totalHeight: 0 });
    }
  });
});

describe("scrollTopForPage (salto a una página: lupa y 'Ir a la página')", () => {
  const slots = computePageSlots({ pageCount: 5, baseHeight: BASE, stripPages: new Set([0, 2]) });

  it("lleva cada página al comienzo del viewport, contando las franjas de las anteriores", () => {
    expect(scrollTopForPage(slots, 0)).toBe(0);
    expect(scrollTopForPage(slots, 1)).toBe(BASE + UNREADABLE_STRIP_PX);
    expect(scrollTopForPage(slots, 2)).toBe(2 * BASE + UNREADABLE_STRIP_PX);
    expect(scrollTopForPage(slots, 3)).toBe(3 * BASE + 2 * UNREADABLE_STRIP_PX);
    // Sin la corrección de las franjas, `índice × paso` quedaría corrido:
    expect(scrollTopForPage(slots, 3)).not.toBe(3 * BASE);
  });

  it("un índice inexistente cae en 0 en vez de NaN", () => {
    expect(scrollTopForPage(slots, 99)).toBe(0);
    expect(scrollTopForPage(slots, -1)).toBe(0);
  });

  it("saltar a una página y calcular la página actual son inversas", () => {
    for (let index = 0; index < 5; index += 1) {
      // Con un viewport de alto 0, el centro es el borde superior: la página
      // que empieza ahí es la actual.
      expect(
        computeCurrentPageIndexFromScroll({
          scrollTop: scrollTopForPage(slots, index),
          clientHeight: 0,
          slots,
        }),
      ).toBe(index);
    }
  });
});

describe("slotIndexAtOffset", () => {
  const slots = computePageSlots({ pageCount: 4, baseHeight: 100, stripPages: new Set([1]) });
  // Filas: [0,100) [100,272) [272,372) [372,472); la franja de la 1 mide 72.

  it("devuelve la fila que contiene la coordenada, incluida su franja", () => {
    expect(slotIndexAtOffset(slots, 0)).toBe(0);
    expect(slotIndexAtOffset(slots, 99)).toBe(0);
    expect(slotIndexAtOffset(slots, 100)).toBe(1);
    expect(slotIndexAtOffset(slots, 100 + UNREADABLE_STRIP_PX + 99)).toBe(1);
    expect(slotIndexAtOffset(slots, 272)).toBe(2);
    expect(slotIndexAtOffset(slots, 471)).toBe(3);
  });

  it("acota a la primera y a la última fila", () => {
    expect(slotIndexAtOffset(slots, -50)).toBe(0);
    expect(slotIndexAtOffset(slots, 1_000_000)).toBe(3);
  });

  it("es 0 si no hay filas o el layout todavía no tiene alto", () => {
    expect(slotIndexAtOffset({ offsets: [], heights: [], totalHeight: 0 }, 500)).toBe(0);
    const zero = computePageSlots({ pageCount: 3, baseHeight: 0, stripPages: new Set() });
    expect(slotIndexAtOffset(zero, 500)).toBe(0);
  });

  it("coincide con la división directa cuando no hay franjas (compatibilidad con el layout de antes)", () => {
    const uniform = computePageSlots({ pageCount: 20, baseHeight: BASE, stripPages: new Set() });
    for (const y of [0, 1, BASE - 1, BASE, 5 * BASE + 3, 19 * BASE + 100]) {
      expect(slotIndexAtOffset(uniform, y)).toBe(Math.min(19, Math.floor(y / BASE)));
    }
  });
});

describe("página actual con franjas", () => {
  it("el centro del viewport se mide sobre la geometría real, no sobre índice × paso", () => {
    const slots = computePageSlots({ pageCount: 3, baseHeight: 100, stripPages: new Set([0]) });
    // Filas: [0,172) [172,272) [272,372). Con paso uniforme de 100, el centro
    // en 150 daría la página 1; con la geometría real todavía es la 0.
    expect(computeCurrentPageIndexFromScroll({ scrollTop: 150, clientHeight: 0, slots })).toBe(0);
    expect(computeCurrentPageIndexFromScroll({ scrollTop: 180, clientHeight: 0, slots })).toBe(1);
  });
});
