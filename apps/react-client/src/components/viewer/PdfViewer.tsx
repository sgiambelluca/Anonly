/**
 * `PdfViewer` (`ui/Components.md` §5.2, reescrito por
 * `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` §5 y
 * `adr/ADR-054-Scroll-Independiente-Por-Panel.md` §1/§5).
 *
 * - Cambio de `visibleRange` (reportado por `PageVirtualizer` a partir de su
 *   `IntersectionObserver`) → `actions.requestRender(pageIndices)` **inmediato**
 *   (sin `kind`: el payload `RenderRequested` no lo tiene — Render decide;
 *   `06_Pipeline.md` §10), con la escala vigente (`computeZoomRenderScale`).
 *   `pageIndices` es el rango **montado** (visible ± 1, `computeMountRange`),
 *   no solo el estrictamente visible: son exactamente las páginas que
 *   `PageVirtualizer` ya monta con contenido real, incluyendo el buffer que
 *   existe para evitar pop-in al scrollear (`07_Performance_Strategy.md` §3).
 * - Cambio de `zoom` → el escalado CSS/canvas es inmediato porque
 *   `PageCanvas`/`PageVirtualizer` leen `zoom` reactivamente vía `pageSize`
 *   (`pageLayout.ts`); el re-render real se dispara **debounced**
 *   (`ZOOM_RERENDER_DEBOUNCE_MS`, `zoomRenderScheduler.ts`) con
 *   `scale = previewScale × zoom` (`zoomRenderScale.ts`).
 *
 * `SideBySideViewer` monta dos `PdfViewer` (uno por `kind`), cada uno con su
 * propio `visibleRange`/`currentPageIndex` en `viewer.store` (ADR-054 §1: por
 * panel, no globales) — scrollean, montan y piden renders de forma
 * independiente. `zoom` sigue siendo global (los dos paneles comparten
 * escala): un cambio de zoom puede emitir dos `RENDER_REQUESTED` idénticos
 * (mismo `pageIndices`/`scale` si por coincidencia los rangos montados de
 * los dos paneles coinciden, o dos pedidos distintos si no) — inofensivo por
 * diseño: el cache LRU por escala y el supersede por página del Render
 * Engine (ADR-037 §3/§4) lo absorben sin duplicar trabajo real ni violar el
 * orden por-página (`07_Performance_Strategy.md` §3.1).
 *
 * `scrollSync` (creado una sola vez por `SideBySideViewer`, ADR-054 §3) se
 * pasa tal cual a `PageVirtualizer`: este componente no lo consume
 * directamente, solo lo reenvía junto con `kind`.
 */

import { useEffect, useMemo, useRef } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore, type ViewerKind } from "../../store/viewer.store.js";

import { PageCanvas } from "./PageCanvas.js";
import { computePageHeight, computePageWidth } from "./pageLayout.js";
import { PageVirtualizer } from "./PageVirtualizer.js";
import { shouldTriggerReadyRender } from "./readyRenderTrigger.js";
import type { ScrollSyncController } from "./scrollSyncController.js";
import { computeMountRange, rangeToPageIndices, type VisibleRange } from "./visibleRange.js";
import { computeZoomRenderScale } from "./zoomRenderScale.js";
import { createZoomRenderScheduler } from "./zoomRenderScheduler.js";

export interface PdfViewerProps {
  readonly kind: ViewerKind;
  /** Controller de sincronización opcional de scroll (ADR-054 §3), instanciado una sola vez por `SideBySideViewer` y compartido entre sus dos `PdfViewer`. */
  readonly scrollSync: ScrollSyncController;
}

const KIND_LABEL: Readonly<Record<PdfViewerProps["kind"], string>> = {
  original: "PDF original",
  anonymized: "PDF anonimizado",
};

export function PdfViewer({ kind, scrollSync }: PdfViewerProps) {
  const documentId = useDocumentStore((state) => state.id);
  const pageCount = useDocumentStore((state) => state.pageCount);
  const pipelineStage = usePipelineStore((state) => state.stage);
  const zoom = useViewerStore((state) => state.zoom);
  // Por panel desde ADR-054 §1: este PdfViewer solo lee/escribe SU propia
  // entrada de `visibleRange`/`currentPageIndex`, nunca la del otro `kind`.
  const visibleRange = useViewerStore((state) => state.visibleRange[kind]);
  // Por panel: leer solo la entrada de este `kind` evita que este PdfViewer
  // se re-renderice cuando llega un preview del otro panel (viewer.store.ts).
  const previewByPage = useViewerStore((state) => state.previewByPage[kind]);

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
    actions.requestRender(indices, "preview", computeZoomRenderScale(zoom));
  }, [documentId, pipelineStage, mountRange.start, mountRange.end]);

  // Cambio de visibleRange (scroll) → render inmediato, con la escala vigente.
  useEffect(() => {
    if (mountedPageIndices.length === 0) return;
    actions.requestRender(mountedPageIndices, "preview", computeZoomRenderScale(zoom));
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
      actions.requestRender(indices, "preview", computeZoomRenderScale(zoom));
    });
    return () => scheduler.cancel();
  }, [zoom]);

  function handleVisibleRangeChange(range: VisibleRange): void {
    useViewerStore.getState().setVisibleRange(kind, range.start, range.end);
  }

  // Página actual derivada por geometría de scroll (ADR-054 §5), reportada
  // por `PageVirtualizer` — ya no por el mínimo del `IntersectionObserver`.
  function handleCurrentPageIndexChange(pageIndex: number): void {
    useViewerStore.getState().setPage(kind, pageIndex);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg-secondary px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {KIND_LABEL[kind]}
        </h2>
      </div>
      <div className="flex-1 overflow-hidden" aria-label={KIND_LABEL[kind]}>
        <PageVirtualizer
          kind={kind}
          pageCount={pageCount}
          visibleRange={visibleRange}
          pageSize={pageHeight}
          onVisibleRangeChange={handleVisibleRangeChange}
          onCurrentPageIndexChange={handleCurrentPageIndexChange}
          scrollSync={scrollSync}
          renderItem={(pageIndex) => {
            // `exactOptionalPropertyTypes` (Code_Standards.md §2) distingue
            // "prop ausente" de "prop presente con valor undefined": no se
            // puede pasar `blobUrl={maybeUndefined}` directo a un `blobUrl?:
            // string`. `previewByPage.get(pageIndex)` puede dar `string | undefined`.
            const blobUrl = previewByPage.get(pageIndex);
            return (
              <PageCanvas
                pageIndex={pageIndex}
                kind={kind}
                {...(blobUrl !== undefined ? { blobUrl } : {})}
                width={pageWidth}
                height={pageHeight}
              />
            );
          }}
        />
      </div>
    </div>
  );
}
