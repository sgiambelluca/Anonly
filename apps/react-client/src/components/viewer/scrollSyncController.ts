/**
 * `scrollSyncController.ts` — sincronización opcional de `scrollTop` a nivel
 * de píxel entre los dos paneles de `SideBySideViewer`, cuando
 * `settings.scrollSyncEnabled` está prendido (ADR-054 §2/§3/§4).
 *
 * **Excepción deliberada al patrón del resto de la app** (ADR-054 §3,
 * "Consecuencias — Negativas"): este módulo es imperativo y vive fuera de
 * React/Zustand a propósito. El evento `scroll` dispara a la frecuencia del
 * monitor; si el `scrollTop` compartido viviera en el store, cada tick
 * re-renderizaría los dos paneles. Este módulo solo lee/escribe `scrollTop`
 * directo sobre los contenedores registrados — al store (`viewer.store.ts`)
 * llega únicamente `currentPageIndex`, derivado aparte por
 * `currentPageIndex.ts` y escrito una sola vez por página.
 *
 * **Restricción dura de ADR-054 §3, no una sugerencia**: prohibido cualquier
 * `setTimeout`/`setInterval` acá. La convergencia sale de la idempotencia, no
 * de suprimir eventos por una ventana de tiempo: al asignarle a un panel el
 * `scrollTop` exacto de otro, el evento `scroll` que esa asignación dispara
 * calcula un valor **ya igual** al que se acaba de empujar, así que
 * `notifyScroll` no vuelve a propagar nada — sin bandera de "estoy
 * sincronizando", sin temporizador. Ver el módulo `computeScrollSyncTarget`
 * que este reemplaza (`scrollSync.ts`, borrado por ADR-054 §6): sincronizaba
 * por índice de página, no por píxel, y eso era exactamente lo que producía
 * el ping-pong que este ADR cierra.
 *
 * Los dos casos límite de ADR-054 §4 se resuelven por comparación de valor:
 * - **El seguidor no puede llegar** (el navegador recorta su `scrollTop`):
 *   `notifyScroll` recuerda el último valor que ESTE módulo empujó a cada
 *   panel (`lastPushed`, el valor real tras el clamp del navegador, no el
 *   pedido); un evento cuyo `scrollTop` coincide con ese valor (±1px) es un
 *   eco de la propia sincronización y no se propaga — nunca arrastra al
 *   panel que originó el movimiento hacia atrás.
 * - **Panel oculto** (modo tabs, `display: none`, `clientHeight` 0): se
 *   saltea como destino de cualquier empuje (`pushTo`). Al volverse visible,
 *   `notifyVisible(kind)` lo realinea una vez contra el otro panel, sin
 *   mover a este último.
 *
 * Pensado para testearse en Node sin jsdom (mismo criterio que
 * `visibleRange.ts`/`currentPageIndex.ts`): `ScrollSyncContainer` es una
 * forma estructural mínima (`scrollTop` mutable + `clientHeight` de lectura)
 * que un objeto plano de test puede simular sin DOM real — un
 * `HTMLDivElement` la satisface igual en producción.
 */

import type { ViewerKind } from "../../store/viewer.store.js";

/** Forma mínima que este módulo necesita de un contenedor con scroll. */
export interface ScrollSyncContainer {
  scrollTop: number;
  readonly clientHeight: number;
}

export interface ScrollSyncController {
  /** Prende/apaga la sincronización. Al pasar de apagado a prendido, realinea una vez los paneles visibles registrados (ADR-054 §2, "al volver a ancho ≥ lg... los paneles se realinean" aplica igual al prender el control). */
  setEnabled(enabled: boolean): void;
  /** Registra el contenedor con scroll de un panel. Devuelve un cleanup que lo desregistra (llamar al desmontar). */
  register(kind: ViewerKind, container: ScrollSyncContainer): () => void;
  /** El contenedor de `kind` reportó un evento nativo `scroll`. Si la sincronización está prendida y no es un eco, empuja su `scrollTop` al otro panel. */
  notifyScroll(kind: ViewerKind): void;
  /** El contenedor de `kind` pasó de alto cero a alto > 0 (se volvió visible: cambio de tab, o la ventana que ensancha a `≥ lg`). Si la sincronización está prendida, lo realinea una vez contra el otro panel — sin mover a este último. */
  notifyVisible(kind: ViewerKind): void;
}

const OTHER_KIND: Readonly<Record<ViewerKind, ViewerKind>> = {
  original: "anonymized",
  anonymized: "original",
};

/** Orden fijo, determinista, usado solo para elegir una referencia al prender la sincronización con los dos paneles ya visibles (§2 del docblock de arriba). */
const KIND_ORDER: ReadonlyArray<ViewerKind> = ["original", "anonymized"];

/** Tolerancia de redondeo de sub-píxel (ADR-054 §4, mismo valor que el `scrollSync.ts` que este módulo reemplaza). */
const ECHO_TOLERANCE_PX = 1;

export function createScrollSyncController(): ScrollSyncController {
  let enabled = false;
  const containers = new Map<ViewerKind, ScrollSyncContainer>();
  const lastPushed = new Map<ViewerKind, number>();

  /** Empuja `value` al contenedor de `kind`, salvo que esté oculto (alto 0). Recuerda el valor REAL post-clamp del navegador, no el pedido. */
  function pushTo(kind: ViewerKind, value: number): void {
    const container = containers.get(kind);
    if (!container) return;
    if (container.clientHeight <= 0) return; // panel oculto: se saltea (ADR-054 §4, caso 2)
    container.scrollTop = value;
    lastPushed.set(kind, container.scrollTop);
  }

  function alignVisibleToReference(): void {
    const reference = KIND_ORDER.find((kind) => {
      const container = containers.get(kind);
      return container !== undefined && container.clientHeight > 0;
    });
    if (reference === undefined) return;
    const referenceContainer = containers.get(reference);
    if (!referenceContainer) return;
    const value = referenceContainer.scrollTop;
    for (const kind of KIND_ORDER) {
      if (kind === reference) continue;
      pushTo(kind, value);
    }
  }

  return {
    setEnabled(next) {
      const wasEnabled = enabled;
      enabled = next;
      if (!wasEnabled && next) {
        alignVisibleToReference();
      }
    },
    register(kind, container) {
      containers.set(kind, container);
      return () => {
        containers.delete(kind);
        lastPushed.delete(kind);
      };
    },
    notifyScroll(kind) {
      if (!enabled) return;
      const container = containers.get(kind);
      if (!container) return;
      const pushed = lastPushed.get(kind);
      if (pushed !== undefined && Math.abs(container.scrollTop - pushed) < ECHO_TOLERANCE_PX) {
        return; // eco de la propia sincronización (ADR-054 §4, caso 1): no propagar.
      }
      pushTo(OTHER_KIND[kind], container.scrollTop);
    },
    notifyVisible(kind) {
      if (!enabled) return;
      const leader = containers.get(OTHER_KIND[kind]);
      if (!leader || leader.clientHeight <= 0) return; // no hay otro panel visible del que seguir todavía
      pushTo(kind, leader.scrollTop);
    },
  };
}
