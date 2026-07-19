/**
 * `PdfViewer` (`ui/Components.md` §5.2, reescrito por
 * `adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` §5).
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
 * `SideBySideViewer` monta dos `PdfViewer` (uno por `kind`) que comparten
 * `viewer.store` (`visibleRange`/`zoom` son globales, no por-kind): cada
 * instancia reacciona de forma independiente, así que un cambio de zoom con
 * `sideBySide` activo puede emitir dos `RENDER_REQUESTED` idénticos (mismo
 * `pageIndices`/`scale`) — inofensivo por diseño: el cache LRU por escala y el
 * supersede por página del Render Engine (ADR-037 §3/§4) lo absorben sin
 * duplicar trabajo real ni violar el orden por-página. Centralizar esto en
 * `SideBySideViewer` para emitir una sola vez está fuera de alcance de este PR
 * (`Components.md` §5.2 asigna el disparo a `PdfViewer`, no a
 * `SideBySideViewer`).
 */

import { useEffect, useMemo, useRef } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { useViewerStore } from "../../store/viewer.store.js";

import { PageCanvas } from "./PageCanvas.js";
import { computePageHeight, computePageWidth } from "./pageLayout.js";
import { PageVirtualizer } from "./PageVirtualizer.js";
import { computeMountRange, rangeToPageIndices, type VisibleRange } from "./visibleRange.js";
import { computeZoomRenderScale } from "./zoomRenderScale.js";
import { createZoomRenderScheduler } from "./zoomRenderScheduler.js";

export interface PdfViewerProps {
  readonly kind: "original" | "anonymized";
}

const KIND_LABEL: Readonly<Record<PdfViewerProps["kind"], string>> = {
  original: "PDF original",
  anonymized: "PDF anonimizado",
};

export function PdfViewer({ kind }: PdfViewerProps) {
  const pageCount = useDocumentStore((state) => state.pageCount);
  const zoom = useViewerStore((state) => state.zoom);
  const visibleRange = useViewerStore((state) => state.visibleRange);
  const previewByPage = useViewerStore((state) => state.previewByPage);
  // Compartido entre los dos PdfViewer de SideBySideViewer: cuando el OTRO
  // visor scrollea, este valor cambia y dispara la sincronización de scroll
  // de PageVirtualizer (Components.md §5.1, React_Client.md §7).
  const currentPageIndex = useViewerStore((state) => state.currentPageIndex);

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
    const store = useViewerStore.getState();
    store.setVisibleRange(range.start, range.end);
    store.setPage(range.start);
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
          pageCount={pageCount}
          visibleRange={visibleRange}
          pageSize={pageHeight}
          onVisibleRangeChange={handleVisibleRangeChange}
          scrollToPageIndex={currentPageIndex}
          renderItem={(pageIndex) => {
            // `exactOptionalPropertyTypes` (Code_Standards.md §2) distingue
            // "prop ausente" de "prop presente con valor undefined": no se
            // puede pasar `blobUrl={maybeUndefined}` directo a un `blobUrl?:
            // string`. `pagePreview?.[kind]` puede dar `string | undefined`.
            const pagePreview = previewByPage.get(pageIndex);
            const blobUrl = pagePreview?.[kind];
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
