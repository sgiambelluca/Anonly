/**
 * `scrollRequestMerge.ts` — fusiona las dos fuentes de "ir a esta página" del
 * visor (la lupa de `DocumentSearchBox` y `viewer.store.pageJumpRequest`, que
 * usa "Ir a la página" de la confirmación de export, ADR-190 §4) en un único
 * pedido para `PageVirtualizer`.
 *
 * Cada fuente tiene su propio contador; comparar sus nonces entre sí no
 * significa nada. El fusionador acuña el suyo, estrictamente creciente, así
 * que "cuál llegó después" siempre está bien definido, y pedir dos veces la
 * misma página produce dos pedidos distintos (el virtualizador solo salta
 * cuando el `nonce` cambia).
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

export interface MergedScrollRequest {
  readonly pageIndex: number;
  readonly nonce: number;
}

export interface ScrollRequestMerger {
  /** Acuña el pedido de scroll siguiente, con un nonce mayor a todos los anteriores. */
  next(pageIndex: number): MergedScrollRequest;
}

export function createScrollRequestMerger(): ScrollRequestMerger {
  let nonce = 0;
  return {
    next(pageIndex) {
      nonce += 1;
      return { pageIndex, nonce };
    },
  };
}
