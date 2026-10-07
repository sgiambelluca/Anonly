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

  it("guarda URL y geometría en una misma actualización y elimina el mapa si falta", () => {
    const geometry = { revision: 3, scale: 1, wordPositions: [], coveredRegions: [] };
    const snapshots: Array<{ url: string | undefined; geometry: unknown }> = [];
    const unsubscribe = useViewerStore.subscribe((state) => {
      snapshots.push({
        url: state.previewByPage.anonymized.get(8),
        geometry: state.interactionGeometryByPage.get(8),
      });
    });
    store().setPreview(8, "anonymized", "blob:a", geometry);
    expect(snapshots.at(-1)).toEqual({ url: "blob:a", geometry });
    store().setPreview(8, "anonymized", "blob:b");
    expect(snapshots.at(-1)).toEqual({ url: "blob:b", geometry: undefined });
    unsubscribe();
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

  it("la escala pedida de preview arranca en la del motor y se guarda por kind (ADR-213 §2)", () => {
    expect(store().requestedPreviewScale).toEqual({ original: 1, anonymized: 1 });
    store().setRequestedPreviewScale("anonymized", 1.3);
    expect(store().requestedPreviewScale).toEqual({ original: 1, anonymized: 1.3 });
    const before = store().requestedPreviewScale;
    store().setRequestedPreviewScale("anonymized", 1.3);
    expect(store().requestedPreviewScale).toBe(before); // sin cambio real: misma referencia
  });

  it("setPreview anota la escala pedida de su kind al llegar la imagen (ADR-213 §2)", () => {
    store().setRequestedPreviewScale("original", 1.3);
    store().setPreview(0, "original", "blob:o-0");
    // El otro lado conserva la escala que tenía pedida.
    store().setPreview(0, "anonymized", "blob:a-0");
    expect(store().previewScaleByPage.original.get(0)).toBe(1.3);
    expect(store().previewScaleByPage.anonymized.get(0)).toBe(1);

    // Una imagen que llega después de otro pedido se anota con la escala de ESE momento.
    store().setRequestedPreviewScale("original", 2);
    store().setPreview(1, "original", "blob:o-1");
    expect(store().previewScaleByPage.original.get(1)).toBe(2);
    expect(store().previewScaleByPage.original.get(0)).toBe(1.3);
  });

  it("la imagen y su escala entran en la misma actualización del store (ADR-213 §2)", () => {
    store().setRequestedPreviewScale("original", 1.5);
    const snapshots: Array<{ url: string | undefined; scale: number | undefined }> = [];
    const unsubscribe = useViewerStore.subscribe((state) => {
      snapshots.push({
        url: state.previewByPage.original.get(4),
        scale: state.previewScaleByPage.original.get(4),
      });
    });
    store().setPreview(4, "original", "blob:x");
    unsubscribe();
    expect(snapshots).toEqual([{ url: "blob:x", scale: 1.5 }]);
  });

  it("reset() limpia las escalas pedidas y las anotadas (cambio de documento, ADR-213 §2)", () => {
    store().setRequestedPreviewScale("anonymized", 2);
    store().setPreview(0, "anonymized", "blob:x");
    store().reset();
    expect(store().requestedPreviewScale).toEqual({ original: 1, anonymized: 1 });
    expect(store().previewScaleByPage.anonymized.size).toBe(0);
    expect(store().previewScaleByPage.original.size).toBe(0);
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
