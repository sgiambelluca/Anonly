import { describe, expect, it } from "vitest";

import {
  createScrollSyncController,
  type ScrollSyncContainer,
} from "../components/viewer/scrollSyncController.js";

/**
 * Contenedor de prueba puro (Node, sin jsdom): simula el `scrollTop`
 * mutable/clampeado de un `HTMLDivElement` real vía un getter/setter, y un
 * `clientHeight` fijo configurable para simular paneles ocultos (0) o con
 * menos recorrido de scroll que otro (`maxScrollTop`).
 */
function createFakeContainer(params: {
  readonly clientHeight: number;
  readonly maxScrollTop?: number;
}): ScrollSyncContainer {
  const maxScrollTop = params.maxScrollTop ?? Number.POSITIVE_INFINITY;
  let value = 0;
  return {
    clientHeight: params.clientHeight,
    get scrollTop() {
      return value;
    },
    set scrollTop(next: number) {
      value = Math.max(0, Math.min(maxScrollTop, next));
    },
  };
}

describe("createScrollSyncController", () => {
  it("does nothing while disabled: a scroll on one panel does not move the other", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);

    original.scrollTop = 4000;
    controller.notifyScroll("original");

    expect(anonymized.scrollTop).toBe(0);
  });

  it("propagates scrollTop to the other panel when enabled", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    original.scrollTop = 4000;
    controller.notifyScroll("original");

    expect(anonymized.scrollTop).toBe(4000);
  });

  it("is symmetric: scrolling the anonymized panel propagates to original too", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    anonymized.scrollTop = 2500;
    controller.notifyScroll("anonymized");

    expect(original.scrollTop).toBe(2500);
  });

  it("is idempotent: applying the same scrollTop twice yields the same result (ADR-054 §8)", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    original.scrollTop = 4000;
    controller.notifyScroll("original");
    expect(anonymized.scrollTop).toBe(4000);

    // Re-aplicar el mismo scrollTop (p. ej. un segundo evento sin movimiento
    // real, o el propio eco si el llamador no lo hubiera filtrado) no cambia
    // nada: sigue en 4000.
    controller.notifyScroll("original");
    expect(anonymized.scrollTop).toBe(4000);
    expect(original.scrollTop).toBe(4000);
  });

  it("does not propagate an echo: the follower's own scroll event, at the value just pushed, is ignored (ADR-054 §4 caso 1)", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    original.scrollTop = 4000;
    controller.notifyScroll("original"); // empuja anonymized a 4000, recuerda 4000 como "empujado"

    // El propio contenedor "anonymized" dispara su handler de scroll nativo
    // (la asignación de scrollTop lo generaría en el navegador real) con el
    // valor EXACTO que se le acaba de empujar (4000): es un eco, no debe
    // propagarse de vuelta a "original".
    controller.notifyScroll("anonymized");

    // "original" no se movió por el eco.
    expect(original.scrollTop).toBe(4000);
  });

  it("does not drag the leader backward when the follower cannot reach the target (browser-clamped scrollTop)", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 }); // recorrido "ilimitado" en este fake
    const anonymized = createFakeContainer({ clientHeight: 500, maxScrollTop: 3000 }); // el navegador lo clampea a 3000
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    original.scrollTop = 8000;
    controller.notifyScroll("original");

    // El seguidor aterriza en su máximo real, no en el valor pedido.
    expect(anonymized.scrollTop).toBe(3000);

    // El evento de scroll nativo que ese clamp dispara en "anonymized"
    // reporta 3000 — exactamente lo que este módulo empujó — así que se trata
    // como eco y NO arrastra a "original" hacia atrás.
    controller.notifyScroll("anonymized");
    expect(original.scrollTop).toBe(8000);
  });

  it("skips a hidden panel (clientHeight 0) as a push target (ADR-054 §4 caso 2)", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 0 }); // oculto, modo tabs
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    original.scrollTop = 4000;
    controller.notifyScroll("original");

    expect(anonymized.scrollTop).toBe(0); // se saltea: no se le asigna nada
  });

  it("notifyVisible is a no-op if the target container still reports clientHeight 0 (defensive: PageVirtualizer only calls this after observing the real 0→>0 transition)", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 0 }); // sigue oculto en este fake
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    original.scrollTop = 2400;
    controller.notifyVisible("anonymized");

    // `pushTo` saltea cualquier destino oculto (ADR-054 §4 caso 2), incluido
    // el propio target de `notifyVisible`: no toca ninguno de los dos.
    expect(anonymized.scrollTop).toBe(0);
    expect(original.scrollTop).toBe(2400);
  });

  it("realigns a panel that becomes visible (clientHeight > 0) against the other panel's current scrollTop", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    // "anonymized" ya reporta clientHeight > 0 en el momento del llamado
    // (equivalente a que PageVirtualizer ya detectó la transición 0→>0 antes
    // de notificar).
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    original.scrollTop = 2400;
    controller.notifyVisible("anonymized");

    expect(anonymized.scrollTop).toBe(2400);
    expect(original.scrollTop).toBe(2400); // el líder no se mueve
  });

  it("notifyVisible does nothing if the other panel is not visible either (nothing to follow yet)", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 0 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    // "original" está oculto (clientHeight 0): no hay de quién seguir todavía.
    controller.notifyVisible("anonymized");

    expect(anonymized.scrollTop).toBe(0);
  });

  it("notifyVisible does nothing while disabled", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);
    // sync apagada (default)

    original.scrollTop = 2400;
    controller.notifyVisible("anonymized");

    expect(anonymized.scrollTop).toBe(0);
  });

  it("aligns both visible panels once when sync transitions from disabled to enabled", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);

    original.scrollTop = 1600;
    anonymized.scrollTop = 4000; // paneles desalineados mientras sync estaba apagada

    controller.setEnabled(true);

    // "original" es la referencia determinista (KIND_ORDER): "anonymized" se
    // alinea a su valor, "original" no se toca.
    expect(original.scrollTop).toBe(1600);
    expect(anonymized.scrollTop).toBe(1600);
  });

  it("re-enabling sync does not realign anything if it was already enabled (only the disabled→enabled transition aligns)", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    controller.register("anonymized", anonymized);

    controller.setEnabled(true); // ya prendida, paneles en 0/0 — nada que alinear
    original.scrollTop = 1600;
    controller.notifyScroll("original"); // sincroniza normalmente
    expect(anonymized.scrollTop).toBe(1600);

    // Un usuario mueve "anonymized" manualmente sin pasar por notifyScroll
    // (simulación directa, no representativa de uso real, solo para verificar
    // que setEnabled(true) con `enabled` ya en true no vuelve a alinear).
    anonymized.scrollTop = 9999;
    controller.setEnabled(true);
    expect(anonymized.scrollTop).toBe(9999);
  });

  it("does not error when notifying a kind that was never registered", () => {
    const controller = createScrollSyncController();
    controller.setEnabled(true);
    expect(() => controller.notifyScroll("original")).not.toThrow();
    expect(() => controller.notifyVisible("anonymized")).not.toThrow();
  });

  it("stops propagating after a panel is unregistered", () => {
    const controller = createScrollSyncController();
    const original = createFakeContainer({ clientHeight: 500 });
    const anonymized = createFakeContainer({ clientHeight: 500 });
    controller.register("original", original);
    const unregisterAnonymized = controller.register("anonymized", anonymized);
    controller.setEnabled(true);

    unregisterAnonymized();

    original.scrollTop = 4000;
    controller.notifyScroll("original");

    expect(anonymized.scrollTop).toBe(0);
  });
});
