/**
 * `viewer.store.ts` — el estado del visor y, en particular, el pedido de salto
 * a una página (`requestPageJump` / `consumePageJump`, ADR-190 §4).
 *
 * El `useEffect` de `PdfViewer` que lo consume no es testeable acá (sin jsdom):
 * lo que sí se prueba es el contrato del store del que depende que un
 * remontaje del visor no repita el salto.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { MAX_ZOOM, MIN_ZOOM, useViewerStore } from "../store/viewer.store.js";

const store = () => useViewerStore.getState();

describe("viewer.store — pedido de salto a una página (ADR-190 §4)", () => {
  beforeEach(() => {
    store().reset();
  });

  it("arranca sin pedido pendiente", () => {
    expect(store().pageJumpRequest).toBeNull();
    expect(store().consumePageJump()).toBeNull();
  });

  it("requestPageJump deja el pedido pendiente en el store", () => {
    store().requestPageJump(3);
    expect(store().pageJumpRequest).toMatchObject({ pageIndex: 3 });
  });

  it("consumePageJump entrega el pedido una sola vez y lo borra del store", () => {
    store().requestPageJump(3);

    expect(store().consumePageJump()).toMatchObject({ pageIndex: 3 });
    expect(store().pageJumpRequest).toBeNull();
    // Un segundo consumidor (un PdfViewer que se remonta, la segunda pasada de
    // StrictMode) no recibe nada: no hay salto que repetir.
    expect(store().consumePageJump()).toBeNull();
  });

  it("un remontaje del visor con el pedido ya consumido no ve ningún pedido", () => {
    store().requestPageJump(5);
    expect(store().consumePageJump()).not.toBeNull();

    // Segundo montaje: lee el estado actual del store, como el efecto real.
    expect(store().pageJumpRequest).toBeNull();
  });

  it("pedir la misma página dos veces seguidas genera dos pedidos distintos", () => {
    store().requestPageJump(2);
    const first = store().consumePageJump();
    store().requestPageJump(2);
    const second = store().consumePageJump();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second?.pageIndex).toBe(first?.pageIndex);
    expect(second?.nonce).toBeGreaterThan(first?.nonce ?? Number.POSITIVE_INFINITY);
  });

  it("un pedido nuevo antes de consumir reemplaza al anterior (gana el último)", () => {
    store().requestPageJump(1);
    store().requestPageJump(6);
    expect(store().consumePageJump()).toMatchObject({ pageIndex: 6 });
    expect(store().consumePageJump()).toBeNull();
  });

  it("reset() descarta un pedido pendiente (documento nuevo)", () => {
    store().requestPageJump(4);
    store().reset();
    expect(store().pageJumpRequest).toBeNull();
    expect(store().consumePageJump()).toBeNull();
  });
});

describe("viewer.store — estado del visor", () => {
  beforeEach(() => {
    store().reset();
  });

  it("valores iniciales", () => {
    expect(store()).toMatchObject({
      currentPageIndex: 0,
      zoom: 1,
      mode: "original",
      searchQuery: "",
      visibleRange: { start: 0, end: 0 },
    });
    expect(store().failedPages.size).toBe(0);
  });

  it("setPage, setMode y setVisibleRange escriben su campo", () => {
    store().setPage(7);
    store().setMode("anonymized");
    store().setVisibleRange(4, 9);
    expect(store().currentPageIndex).toBe(7);
    expect(store().mode).toBe("anonymized");
    expect(store().visibleRange).toEqual({ start: 4, end: 9 });
  });

  it("setZoom respeta los límites", () => {
    store().setZoom(MAX_ZOOM + 5);
    expect(store().zoom).toBe(MAX_ZOOM);
    store().setZoom(MIN_ZOOM - 5);
    expect(store().zoom).toBe(MIN_ZOOM);
    store().setZoom(1.5);
    expect(store().zoom).toBe(1.5);
  });

  it("setPreview guarda la imagen por panel sin tocar el otro", () => {
    store().setPreview(2, "original", "blob:original-2");
    expect(store().previewByPage.original.get(2)).toBe("blob:original-2");
    expect(store().previewByPage.anonymized.has(2)).toBe(false);
  });

  it("setPageFailed marca la página, y un preview posterior que prospera limpia la marca", () => {
    store().setPageFailed(3);
    expect(store().failedPages.has(3)).toBe(true);

    const failedBefore = store().failedPages;
    store().setPageFailed(3);
    expect(store().failedPages).toBe(failedBefore); // sin cambio real: misma referencia

    store().setPreview(3, "original", "blob:ok");
    expect(store().failedPages.has(3)).toBe(false);
  });

  it("setPreview de una página no fallada conserva la referencia de failedPages", () => {
    store().setPageFailed(1);
    const failedBefore = store().failedPages;
    store().setPreview(5, "anonymized", "blob:otra");
    expect(store().failedPages).toBe(failedBefore);
  });

  it("reset() vuelve todo al estado inicial", () => {
    store().setPage(3);
    store().setZoom(2);
    store().setMode("anonymized");
    store().setPreview(0, "original", "blob:x");
    store().setPageFailed(1);
    store().setSearchQuery("dni");
    store().setVisibleRange(2, 5);
    store().requestPageJump(1);

    store().reset();

    expect(store()).toMatchObject({
      currentPageIndex: 0,
      zoom: 1,
      mode: "original",
      searchQuery: "",
      visibleRange: { start: 0, end: 0 },
      pageJumpRequest: null,
    });
    expect(store().previewByPage.original.size).toBe(0);
    expect(store().failedPages.size).toBe(0);
  });
});
