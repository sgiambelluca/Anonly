/**
 * `PdfViewer` (`ui/Components.md` §5.2, reescrito por
 * `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` §5,
 * `adr/ADR-054-Scroll-Independiente-Por-Panel.md` §1/§5 y
 * `adr/ADR-056-RenderRequested-Kind-Por-Panel.md` §1/§2).
 *
 * - Cambio de `visibleRange` (reportado por `PageVirtualizer` a partir de su
 *   `IntersectionObserver`) → `actions.requestRender(pageIndices, kind)`
 *   **inmediato**, con la escala vigente (`computeZoomRenderScale`).
 *   `pageIndices` es el rango **montado** (visible ± 1, `computeMountRange`),
 *   no solo el estrictamente visible: son exactamente las páginas que
 *   `PageVirtualizer` ya monta con contenido real, incluyendo el buffer que
 *   existe para evitar pop-in al scrollear (`07_Performance_Strategy.md` §3).
 * - Cambio de `zoom` → el escalado CSS/canvas es inmediato porque
 *   `PageCanvas`/`PageVirtualizer` leen `zoom` reactivamente vía `pageSize`
 *   (`pageLayout.ts`); el re-render real se dispara **debounced**
 *   (`ZOOM_RERENDER_DEBOUNCE_MS`, `zoomRenderScheduler.ts`) con
 *   `scale = previewScale × zoom` (`zoomRenderScale.ts`).
 * - Los tres emisores (render inicial al observar `Ready`, cambio de rango
 *   montado, re-render debounced de zoom) pasan **siempre** el `kind` de este
 *   `PdfViewer`, que desde ADR-087 §2 es `viewer.store.mode` — la posición del
 *   `ViewerModeToggle`. Sigue habiendo **una sola** fuente de verdad sobre qué
 *   lado necesita píxeles, que es lo que ADR-056 §2 protege.
 *
 * Desde ADR-087 §2 hay **un solo** `PdfViewer`, y `kind` sale de
 * `viewer.store.mode`. `RENDER_REQUESTED.kind` sigue requerido y con la misma
 * semántica de ADR-056: el motor renderiza únicamente el lado pedido, que
 * ahora es siempre el que el usuario está mirando. Conmutar el toggle cambia
 * `mode` → cambia `kind` → se pide el render del otro lado; si esa página ya
 * está en `previewByPage[kind]`, se pinta desde ahí sin esperar.
 *
 * Retirado con el lado a lado: la prop `scrollSync` y todo el controller de
 * sincronización (ADR-054 §3). Con un panel no hay dos scrolls que alinear.
 *
 * **Reintento de preview** (`previewRetry.ts`): mientras las páginas montadas
 * no tengan imagen, se re-pide. El Render Engine descarta en silencio los
 * pedidos de un documento que todavía no cargó, y con el pase temprano de
 * ADR-087 §6 ese descarte dejaba el visor gris durante todo el escaneo.
 */

import type { TextMatch } from "@anonly/anonymization-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore, type ViewerKind } from "../../store/viewer.store.js";

import { PageCanvas } from "./PageCanvas.js";
import { computePageHeight, computePageWidth } from "./pageLayout.js";
import { PageVirtualizer } from "./PageVirtualizer.js";
import { PREVIEW_RETRY_INTERVAL_MS, pagesMissingPreview } from "./previewRetry.js";
import { shouldTriggerReadyRender } from "./readyRenderTrigger.js";
import {
  describePageSeparator,
  PAGE_SEPARATOR_PX,
  pageStride,
  zoomFromWheel,
} from "./viewerGestures.js";
import { computeMountRange, rangeToPageIndices, type VisibleRange } from "./visibleRange.js";
import { WordSelectionOverlay, type PageSelection } from "./WordSelectionOverlay.js";
import { isOriginalPanel } from "./wordSelectionRect.js";
import { computeZoomRenderScale } from "./zoomRenderScale.js";
import { createZoomRenderScheduler } from "./zoomRenderScheduler.js";

const KIND_LABEL: Readonly<Record<ViewerKind, string>> = {
  original: "Documento original",
  anonymized: "Documento anonimizado",
};

export interface PdfViewerProps {
  /**
   * El resultado activo de la lupa (`DocumentSearchBox`), que ahora vive en la
   * barra del visor y no adentro de este componente (ADR-169 §7): el visor
   * scrollea a su página y lo resalta.
   */
  readonly activeMatch: TextMatch | null;
  /** Fuerza el salto aunque dos resultados caigan en la misma página. */
  readonly scrollNonce: number;
}

export function PdfViewer({ activeMatch, scrollNonce }: PdfViewerProps) {
  // `kind` sale del toggle (ADR-087 §2), no de una prop: hay un solo visor.
  const kind = useViewerStore((state) => state.mode);
  const documentId = useDocumentStore((state) => state.id);
  const pageCount = useDocumentStore((state) => state.pageCount);
  const pipelineStage = usePipelineStore((state) => state.stage);
  const zoom = useViewerStore((state) => state.zoom);
  const visibleRange = useViewerStore((state) => state.visibleRange);
  // `previewByPage` sigue siendo por `kind` (viewer.store.ts): las dos vistas
  // tienen imágenes distintas de la misma página, y conmutar el toggle pinta
  // la cacheada sin esperar un render nuevo.
  const previewByPage = useViewerStore((state) => state.previewByPage[kind]);
  const failedPages = useViewerStore((state) => state.failedPages);

  const pageHeight = computePageHeight(zoom);
  const pageWidth = computePageWidth(pageHeight);

  const mountRange = useMemo(
    () => computeMountRange(visibleRange, pageCount),
    [visibleRange.start, visibleRange.end, pageCount],
  );
  const mountedPageIndices = useMemo(() => rangeToPageIndices(mountRange), [mountRange]);

  const mountedPageIndicesRef = useRef(mountedPageIndices);
  mountedPageIndicesRef.current = mountedPageIndices;

  const schedulerRef = useRef<ReturnType<typeof createZoomRenderScheduler> | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createZoomRenderScheduler();
  }

  // Fix del visor en blanco hasta que el usuario scrollea (`readyRenderTrigger.ts`):
  // el pipeline puede llegar a `Ready` después de que este componente ya
  // montó (y ya intentó, en vano, su primer `RENDER_REQUESTED` — ver el
  // efecto de abajo) sin que cambie `mountRange` de nuevo. Se re-pide el
  // render de las páginas montadas la primera vez que se observa `Ready` para
  // este `documentId`, una sola vez (la ref evita pedidos redundantes en
  // renders posteriores o tras un `reanalyze` que vuelve a `Ready`).
  const triggeredReadyRenderForRef = useRef<string | null>(null);
  useEffect(() => {
    const indices = mountedPageIndicesRef.current;
    if (
      !shouldTriggerReadyRender({
        documentId,
        stage: pipelineStage,
        mountedPageIndicesCount: indices.length,
        triggeredForDocumentId: triggeredReadyRenderForRef.current,
      })
    ) {
      return;
    }
    triggeredReadyRenderForRef.current = documentId;
    actions.requestRender(indices, kind, "preview", computeZoomRenderScale(zoom));
  }, [documentId, pipelineStage, mountRange.start, mountRange.end]);

  // Reintento mientras las páginas montadas sigan sin imagen
  // (`previewRetry.ts`). El re-pedido único de arriba dejó de alcanzar con el
  // pase temprano de ADR-087 §6: el visor se monta con el pipeline todavía
  // escaneando, sus pedidos se descartan porque el documento de render no
  // cargó, y `Ready` puede estar a minutos. Es autolimitado — apenas llegan
  // las imágenes, `pagesMissingPreview` devuelve vacío y el intervalo se
  // limpia.
  const retryAttemptsRef = useRef(0);
  useEffect(() => {
    // Cada conjunto montado nuevo estrena su cuota de intentos: al scrollear a
    // páginas que nunca se pidieron, el techo del conjunto anterior no tiene
    // por qué penalizarlas.
    retryAttemptsRef.current = 0;
  }, [mountRange.start, mountRange.end, documentId, kind]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const missing = pagesMissingPreview({
        documentId,
        mountedPageIndices: mountedPageIndicesRef.current,
        previewByPage,
        failedPages,
        attempts: retryAttemptsRef.current,
      });
      if (missing.length === 0) {
        window.clearInterval(timer);
        return;
      }
      retryAttemptsRef.current += 1;
      actions.requestRender(missing, kind, "preview", computeZoomRenderScale(zoom));
    }, PREVIEW_RETRY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [documentId, kind, previewByPage, failedPages, mountRange.start, mountRange.end]);

  // Cambio de visibleRange (scroll) → render inmediato, con la escala vigente.
  useEffect(() => {
    if (mountedPageIndices.length === 0) return;
    actions.requestRender(mountedPageIndices, kind, "preview", computeZoomRenderScale(zoom));
    // Se dispara por cambios de rango montado, no de zoom (ese caso lo cubre
    // el efecto debounced de abajo) — `zoom` se lee fresco igual porque el
    // cuerpo del efecto se recrea en cada render; solo la re-ejecución está
    // acotada a los deps listados (no hay `eslint-plugin-react-hooks` en este
    // repo que lo exija).
  }, [mountRange.start, mountRange.end]);

  // Cambio de zoom → re-render real debounced (ADR-037 §5). Se salta el
  // primer render (valor inicial, no un cambio de usuario): el efecto de
  // arriba ya cubre el render inicial del rango montado.
  const skippedInitialZoomRef = useRef(false);
  useEffect(() => {
    if (!skippedInitialZoomRef.current) {
      skippedInitialZoomRef.current = true;
      return;
    }
    const scheduler = schedulerRef.current;
    if (!scheduler) return;
    scheduler.schedule(() => {
      const indices = mountedPageIndicesRef.current;
      if (indices.length === 0) return;
      actions.requestRender(indices, kind, "preview", computeZoomRenderScale(zoom));
    });
    return () => scheduler.cancel();
  }, [zoom]);

  function handleVisibleRangeChange(range: VisibleRange): void {
    useViewerStore.getState().setVisibleRange(range.start, range.end);
  }

  // Página actual derivada por geometría de scroll (ADR-054 §5, sigue
  // vigente), reportada por `PageVirtualizer` — no por el mínimo del
  // `IntersectionObserver`.
  function handleCurrentPageIndexChange(pageIndex: number): void {
    useViewerStore.getState().setPage(pageIndex);
  }

  // ADR-169 §7: la selección sobre el original persiste hasta que se agrega,
  // se cancela, se hace otra, se presiona Escape, se conmuta a Anonimizado o
  // se cierra el documento. Vive acá —y no en cada página— para que haya una
  // sola en todo el documento y sobreviva a que su página salga del rango
  // montado.
  const [selection, setSelection] = useState<PageSelection | null>(null);
  const clearSelection = useCallback(() => setSelection(null), []);
  useEffect(() => {
    setSelection(null);
  }, [kind, documentId]);

  // ADR-169 §9: pellizco del trackpad y `Ctrl + rueda`. React registra
  // `onWheel` como pasivo, así que `preventDefault()` no frenaría el zoom de
  // la ventana entera: va por `addEventListener` con `{ passive: false }`.
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    function handleWheel(event: WheelEvent): void {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const state = useViewerStore.getState();
      state.setZoom(zoomFromWheel(state.zoom, event.deltaY));
    }
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, []);

  const scrollRequest =
    activeMatch === null ? null : { pageIndex: activeMatch.pageIndex, nonce: scrollNonce };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div ref={viewportRef} className="flex-1 overflow-hidden" aria-label={KIND_LABEL[kind]}>
        <PageVirtualizer
          pageCount={pageCount}
          visibleRange={visibleRange}
          // El paso incluye el separador de arriba de cada página (ADR-169
          // §9): toda la aritmética de scroll sigue siendo `índice × paso`.
          pageSize={pageStride(pageHeight)}
          pageWidth={pageWidth}
          onVisibleRangeChange={handleVisibleRangeChange}
          onCurrentPageIndexChange={handleCurrentPageIndexChange}
          scrollRequest={scrollRequest}
          renderItem={(pageIndex) => {
            // `exactOptionalPropertyTypes`: no se puede pasar `blobUrl` en
            // `undefined` explícito a un `blobUrl?: string`.
            const blobUrl = previewByPage.get(pageIndex);
            const activeMatchBbox =
              activeMatch && activeMatch.pageIndex === pageIndex ? activeMatch.bbox : undefined;
            return (
              <div className="flex shrink-0 flex-col items-center" style={{ width: pageWidth }}>
                <PageSeparator pageIndex={pageIndex} pageCount={pageCount} />
                {/*
                  Ancho/alto explícitos y `shrink-0`: `WordSelectionOverlay` y
                  `wordSelectionRect.ts` asumen que la página mide exactamente
                  `pageWidth × pageHeight` — con `w-full` heredaba el ancho del
                  panel y la selección traducía coordenadas con otra escala
                  (Hito 10.7, ADR-061).
                */}
                <div
                  className="relative shrink-0 bg-bg-tertiary"
                  style={{ width: pageWidth, height: pageHeight }}
                >
                  <PageCanvas
                    pageIndex={pageIndex}
                    kind={kind}
                    {...(blobUrl !== undefined ? { blobUrl } : {})}
                    width={pageWidth}
                    height={pageHeight}
                    failed={failedPages.has(pageIndex)}
                  />
                  {isOriginalPanel(kind) ? (
                    <WordSelectionOverlay
                      pageIndex={pageIndex}
                      displayWidth={pageWidth}
                      displayHeight={pageHeight}
                      {...(activeMatchBbox !== undefined ? { activeMatchBbox } : {})}
                      selection={selection?.pageIndex === pageIndex ? selection : null}
                      onSelect={setSelection}
                      onClearSelection={clearSelection}
                    />
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}

/**
 * ADR-169 §9: el paso de una página a otra se nota — un espacio con una línea
 * punteada y *"Página N de M"* centrada. Va arriba de cada página.
 */
function PageSeparator({
  pageIndex,
  pageCount,
}: {
  readonly pageIndex: number;
  readonly pageCount: number;
}) {
  const label = describePageSeparator(pageIndex, pageCount);
  return (
    <div
      role="separator"
      aria-label={label}
      className="flex w-full shrink-0 items-center gap-3 text-sm font-semibold text-text-secondary"
      style={{ height: PAGE_SEPARATOR_PX }}
    >
      <i aria-hidden className="h-0 flex-1 border-t-2 border-dashed border-border" />
      <span className="rounded-full border border-border bg-bg-primary px-2.5 py-0.5">{label}</span>
      <i aria-hidden className="h-0 flex-1 border-t-2 border-dashed border-border" />
    </div>
  );
}
