/**
 * `scrollRequestMerge.ts` — la fusión del salto de la lupa con el pedido de
 * "Ir a la página" (`viewer.store.pageJumpRequest`, ADR-190 §4).
 */

import { describe, expect, it } from "vitest";

import { createScrollRequestMerger } from "../components/viewer/scrollRequestMerge.js";

describe("createScrollRequestMerger", () => {
  it("acuña nonces estrictamente crecientes, sin importar de qué fuente viene cada pedido", () => {
    const merger = createScrollRequestMerger();
    const lupa = merger.next(4);
    const exportDialog = merger.next(1);
    const lupaOtraVez = merger.next(4);
    expect([lupa.nonce, exportDialog.nonce, lupaOtraVez.nonce]).toEqual([1, 2, 3]);
    expect([lupa.pageIndex, exportDialog.pageIndex, lupaOtraVez.pageIndex]).toEqual([4, 1, 4]);
  });

  it("pedir dos veces la misma página produce pedidos distintos (el virtualizador solo salta si cambia el nonce)", () => {
    const merger = createScrollRequestMerger();
    const first = merger.next(2);
    const second = merger.next(2);
    expect(second.pageIndex).toBe(first.pageIndex);
    expect(second.nonce).not.toBe(first.nonce);
  });

  it("cada fusionador tiene su propia secuencia", () => {
    expect(createScrollRequestMerger().next(0).nonce).toBe(1);
    expect(createScrollRequestMerger().next(0).nonce).toBe(1);
  });
});
