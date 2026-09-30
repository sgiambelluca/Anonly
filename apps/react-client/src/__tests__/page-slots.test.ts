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
  anchorScrollTop,
  computePageSlots,
  isStripOnlyChange,
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
      expect(slots).toEqual({ offsets: [], heights: [], totalHeight: 0, baseHeight: BASE });
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
    expect(
      slotIndexAtOffset({ offsets: [], heights: [], totalHeight: 0, baseHeight: 0 }, 500),
    ).toBe(0);
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

// ─── Anclaje del scroll (ADR-190 §4, ui/Components.md §5.3) ────────────────

/** Filas de 100 px (franja de 72 px en las marcadas): la aritmética se lee a ojo. */
function layout(pageCount: number, marked: ReadonlyArray<number>, baseHeight = 100) {
  return computePageSlots({ pageCount, baseHeight, stripPages: new Set(marked) });
}

describe("isStripOnlyChange", () => {
  it("es verdadero cuando cambian solo las franjas", () => {
    expect(isStripOnlyChange(layout(5, []), layout(5, [1]))).toBe(true);
    expect(isStripOnlyChange(layout(5, [1]), layout(5, []))).toBe(true);
  });

  it("una franja que se muda de una fila a otra deja el alto total igual y sí es un cambio de franjas", () => {
    const before = layout(6, [5]);
    const after = layout(6, [1]);
    expect(after.totalHeight).toBe(before.totalHeight);
    expect(isStripOnlyChange(before, after)).toBe(true);
  });

  it("es falso sin cambio real, con otro zoom o con otro documento", () => {
    expect(isStripOnlyChange(layout(5, [1]), layout(5, [1]))).toBe(false);
    expect(isStripOnlyChange(layout(5, [1]), layout(5, [1], 180))).toBe(false);
    expect(isStripOnlyChange(layout(5, [1]), layout(6, [1]))).toBe(false);
  });

  it("un cambio de zoom que suma justo 72 px a cada fila no se confunde con franjas", () => {
    // Antes de `baseHeight` esto era indistinguible de "todas las páginas ganaron franja".
    expect(isStripOnlyChange(layout(4, []), layout(4, [], 100 + UNREADABLE_STRIP_PX))).toBe(false);
  });
});

describe("anchorScrollTop", () => {
  // Filas sin marcas: [0,100) [100,200) [200,300) [300,400) [400,500) [500,600)
  it("una franja que aparece arriba de la vista empuja el scroll el alto de la franja", () => {
    const before = layout(6, []);
    const after = layout(6, [1]);
    // Arriba de la vista: fila 3 (offset 300) visible desde scrollTop 350.
    const anchored = anchorScrollTop(before, after, 350);
    expect(anchored).toBe(350 + UNREADABLE_STRIP_PX);
    // La fila de arriba quedó en el mismo lugar de la vista: mismo punto de esa fila.
    expect((after.offsets[3] ?? 0) + 50).toBe(anchored);
  });

  it("una franja que desaparece arriba de la vista tira el scroll hacia arriba", () => {
    const before = layout(6, [1]);
    const after = layout(6, []);
    const anchored = anchorScrollTop(before, after, 350 + UNREADABLE_STRIP_PX);
    expect(anchored).toBe(350);
  });

  it("un cambio en la propia fila de arriba no corrige nada", () => {
    // scrollTop 350 está dentro de la fila 3: su franja va dentro de ella.
    expect(anchorScrollTop(layout(6, []), layout(6, [3]), 350)).toBe(350);
    expect(anchorScrollTop(layout(6, [3]), layout(6, []), 350 + UNREADABLE_STRIP_PX)).toBe(
      350 + UNREADABLE_STRIP_PX,
    );
  });

  it("un cambio debajo de la vista no corrige nada", () => {
    expect(anchorScrollTop(layout(6, []), layout(6, [4]), 350)).toBe(350);
    expect(anchorScrollTop(layout(6, []), layout(6, [5]), 350)).toBe(350);
  });

  it("varios cambios a la vez suman solo los que quedan arriba de la fila de arriba", () => {
    const before = layout(8, [0]);
    // Se apaga la 0 y se prenden la 1 y la 2 (arriba de la fila 4, que es la de
    // arriba), la 4 (su propia fila) y la 6 (abajo). Cuentan solo las de arriba:
    // +2 franjas −1 franja.
    const after = layout(8, [1, 2, 4, 6]);
    const scrollTop = (before.offsets[4] ?? 0) + 30;
    const anchored = anchorScrollTop(before, after, scrollTop);
    expect(anchored).toBe((after.offsets[4] ?? 0) + 30);
    expect(anchored - scrollTop).toBe(UNREADABLE_STRIP_PX); // +2 franjas −1 franja arriba
  });

  it("con scroll en 0 no se mueve, ni siquiera si la primera página gana franja", () => {
    expect(anchorScrollTop(layout(6, []), layout(6, [0]), 0)).toBe(0);
    expect(anchorScrollTop(layout(6, [0]), layout(6, []), 0)).toBe(0);
    expect(anchorScrollTop(layout(6, []), layout(6, [2, 3]), 0)).toBe(0);
  });

  it("al final del scroll, sigue anclado a la última fila y respeta el máximo", () => {
    const before = layout(6, []); // total 600
    const after = layout(6, [1]); // total 672
    const clientHeight = 250;
    const atEnd = before.totalHeight - clientHeight; // 350: la fila de arriba es la 3
    const anchored = anchorScrollTop(before, after, atEnd, clientHeight);
    expect(anchored).toBe(atEnd + UNREADABLE_STRIP_PX);
    expect(anchored).toBeLessThanOrEqual(after.totalHeight - clientHeight);
  });

  it("si el contenido se achica, no pasa del nuevo máximo", () => {
    const before = layout(6, [1, 2]); // total 744
    const after = layout(6, []); // total 600
    const clientHeight = 250;
    const scrollTop = before.totalHeight - clientHeight; // 494, al final
    const anchored = anchorScrollTop(before, after, scrollTop, clientHeight);
    expect(anchored).toBe(after.totalHeight - clientHeight);
  });

  it("un cambio de zoom no se ancla: devuelve el scrollTop tal cual", () => {
    expect(anchorScrollTop(layout(6, [1]), layout(6, [1], 180), 350)).toBe(350);
    // Ni siquiera con marcas distintas a la vez: mandan los cambios de alto base.
    expect(anchorScrollTop(layout(6, []), layout(6, [1], 180), 350)).toBe(350);
  });

  it("un documento distinto (otra cantidad de páginas) no se ancla", () => {
    expect(anchorScrollTop(layout(6, []), layout(9, [0]), 350)).toBe(350);
  });

  it("una franja que se muda de abajo de la vista a arriba de ella mueve el scroll aunque el alto total no cambie", () => {
    // scrollTop 350: la fila de arriba es la 3 (offset 300, 50 px adentro). La
    // franja pasa de la fila 5 (debajo de la vista) a la 1 (arriba de ella).
    const before = layout(6, [5]);
    const after = layout(6, [1]);
    expect(after.totalHeight).toBe(before.totalHeight);
    expect(isStripOnlyChange(before, after)).toBe(true);

    const anchored = anchorScrollTop(before, after, 350);

    expect(anchored).toBe(422);
    // La fila de arriba sigue 50 px adentro de la vista, como antes.
    expect(anchored - (after.offsets[3] ?? 0)).toBe(50);
  });

  it("sin filas no hace nada", () => {
    expect(anchorScrollTop(layout(0, []), layout(0, []), 0)).toBe(0);
  });

  it("no pelea con el salto a una página: el destino del salto se calcula con la geometría nueva", () => {
    const before = layout(6, []);
    const after = layout(6, [1]);
    // Si en el mismo commit hay un salto, el salto tiene la última palabra y
    // usa `scrollTopForPage` sobre los `slots` nuevos, no el valor anclado.
    expect(scrollTopForPage(after, 4)).toBe(4 * 100 + UNREADABLE_STRIP_PX);
    // Y anclar sobre el scroll que dejó un salto lo deja en la misma página.
    const jumped = scrollTopForPage(before, 4);
    const anchored = anchorScrollTop(before, after, jumped);
    expect(anchored).toBe(scrollTopForPage(after, 4));
  });
});

describe("página actual tras un cambio de franja sin corrección de scroll", () => {
  it("una franja entre la fila de arriba y el centro puede cambiar la página actual sin mover el scroll", () => {
    // Filas de 100: [0,100) [100,200) [200,300) [300,400)... Viewport de 300 px
    // con scrollTop 100: la fila de arriba es la 1 y el centro (250) cae en la 2.
    const before = layout(6, []);
    const scrollTop = 100;
    const clientHeight = 300;
    expect(computeCurrentPageIndexFromScroll({ scrollTop, clientHeight, slots: before })).toBe(2);

    // La página 2 gana una franja (debajo de la fila de arriba, sin corrección):
    // la fila 2 pasa a medir 172 px, sigue conteniendo el centro.
    const stripOnRow2 = layout(6, [2]);
    expect(anchorScrollTop(before, stripOnRow2, scrollTop, clientHeight)).toBe(scrollTop);
    expect(computeCurrentPageIndexFromScroll({ scrollTop, clientHeight, slots: stripOnRow2 })).toBe(
      2,
    );

    // La página 1 (la de arriba) gana una franja: no hay corrección, pero su fila
    // se estira a 172 px y el centro (250) cae ahora adentro de ELLA, no de la 2.
    const stripOnRow1 = layout(6, [1]);
    expect(anchorScrollTop(before, stripOnRow1, scrollTop, clientHeight)).toBe(scrollTop);
    expect(computeCurrentPageIndexFromScroll({ scrollTop, clientHeight, slots: stripOnRow1 })).toBe(
      1,
    );
  });
});
