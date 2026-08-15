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
 *   `PdfViewer` — nunca se deriva de `settings.scrollSyncEnabled` (ADR-056
 *   §2: sería una segunda fuente de verdad sobre quién necesita píxeles,
 *   capaz de desincronizarse del scroll real). Con la sincronización apagada
 *   eso da el comportamiento lazy pedido (solo se refresca el panel que el
 *   usuario mueve) sin ninguna rama condicional que lo implemente.
 *
 * `SideBySideViewer` monta dos `PdfViewer` (uno por `kind`), cada uno con su
 * propio `visibleRange`/`currentPageIndex` en `viewer.store` (ADR-054 §1: por
 * panel, no globales) — scrollean, montan y piden renders de forma
 * independiente. `zoom` sigue siendo global (los dos paneles comparten
 * escala): un cambio de zoom dispara el re-render debounced en los dos
 * `PdfViewer` a la vez, y con `pageIndices`/`scale` coincidentes si los
 * rangos montados de los dos paneles coinciden. Antes de ADR-056 (sin `kind`
 * en el payload) esos dos pedidos podían ser literalmente idénticos, y el
 * Render Engine igual reconstruía los dos lados por cada uno —trabajo
 * duplicado que el cache LRU por escala y el supersede por página (ADR-037
 * §3/§4) absorbían sin violar el orden por-página
 * (`07_Performance_Strategy.md` §3.1). Con `kind` requerido los dos eventos
 * ya nunca son idénticos —difieren siempre en `kind`— y el motor renderiza
 * solo el lado pedido por cada uno: no hay redundancia que absorber, cada
 * pedido es exactamente el trabajo que su panel necesita.
 *
 * `scrollSync` (creado una sola vez por `SideBySideViewer`, ADR-054 §3) se
 * pasa tal cual a `PageVirtualizer`: este componente no lo consume
 * directamente, solo lo reenvía junto con `kind`.
 */

import type { TextMatch } from "@anonly/anonymization-core";
import { useEffect, useMemo, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore, type ViewerKind } from "../../store/viewer.store.js";

import { DocumentSearchBox } from "./DocumentSearchBox.js";
import { PageCanvas } from "./PageCanvas.js";
import { computePageHeight, computePageWidth } from "./pageLayout.js";
import { PageVirtualizer } from "./PageVirtualizer.js";
import { shouldTriggerReadyRender } from "./readyRenderTrigger.js";
import type { ScrollSyncController } from "./scrollSyncController.js";
import { computeMountRange, rangeToPageIndices, type VisibleRange } from "./visibleRange.js";
import { WordSelectionOverlay } from "./WordSelectionOverlay.js";
import { isOriginalPanel } from "./wordSelectionRect.js";
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
    actions.requestRender(indices, kind, "preview", computeZoomRenderScale(zoom));
  }, [documentId, pipelineStage, mountRange.start, mountRange.end]);

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
    useViewerStore.getState().setVisibleRange(kind, range.start, range.end);
  }

  // Página actual derivada por geometría de scroll (ADR-054 §5), reportada
  // por `PageVirtualizer` — ya no por el mínimo del `IntersectionObserver`.
  function handleCurrentPageIndexChange(pageIndex: number): void {
    useViewerStore.getState().setPage(kind, pageIndex);
  }

  // DocumentSearchBox (ui/Components.md §5.4c, ADR-061 §8): estado local del
  // match activo de la lupa. Solo tiene sentido en `original` — el buscador
  // no se monta en `anonymized` — pero vive acá (no en `viewer.store`) porque
  // es efímero y de un solo panel, sin nada que otro componente necesite leer.
  const [activeMatch, setActiveMatch] = useState<TextMatch | null>(null);
  const scrollNonceRef = useRef(0);

  function handleActiveMatchChange(match: TextMatch | null): void {
    setActiveMatch(match);
    if (match) scrollNonceRef.current += 1;
  }

  const scrollRequest =
    activeMatch === null
      ? null
      : { pageIndex: activeMatch.pageIndex, nonce: scrollNonceRef.current };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-bg-secondary px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {KIND_LABEL[kind]}
        </h2>
        {isOriginalPanel(kind) ? (
          <DocumentSearchBox onActiveMatchChange={handleActiveMatchChange} />
        ) : null}
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
          scrollRequest={scrollRequest}
          renderItem={(pageIndex) => {
            // `exactOptionalPropertyTypes` (Code_Standards.md §2) distingue
            // "prop ausente" de "prop presente con valor undefined": no se
            // puede pasar `blobUrl={maybeUndefined}` directo a un `blobUrl?:
            // string`. `previewByPage.get(pageIndex)` puede dar `string | undefined`.
            const blobUrl = previewByPage.get(pageIndex);
            const activeMatchBbox =
              activeMatch && activeMatch.pageIndex === pageIndex ? activeMatch.bbox : undefined;
            return (
              // Ancho/alto explícitos en vez de `w-full h-full`: `PagePhantom`
              // (`PageVirtualizer.tsx`) es `absolute inset-x-0` — su ancho es
              // el del panel entero, no `pageWidth`. Con `w-full` este wrapper
              // heredaba ese ancho y estiraba `PageCanvas`/`WordSelectionOverlay`
              // al ancho del panel, mientras `wordSelectionRect.ts` seguía
              // asumiendo `displayWidth = pageWidth` (`ui/Components.md`
              // §5.4b): la selección sobre el original traducía coordenadas de
              // pantalla a página con una escala equivocada (bug encontrado en
              // verificación manual post-aprobación del Hito 10.7, ADR-061).
              // Con tamaño fijo, `PagePhantom` centra este wrapper (ya tenía
              // `flex items-center justify-center`, sin uso hasta ahora) en
              // exactamente `pageWidth × pageHeight` — el tamaño que
              // `PageCanvas`/`WordSelectionOverlay` (`h-full w-full` de ESTE
              // wrapper) y `pointerSelectionToPageRect`/`pageRectToScreenRect`
              // ya asumían.
              <div className="relative" style={{ width: pageWidth, height: pageHeight }}>
                <PageCanvas
                  pageIndex={pageIndex}
                  kind={kind}
                  {...(blobUrl !== undefined ? { blobUrl } : {})}
                  width={pageWidth}
                  height={pageHeight}
                />
                {isOriginalPanel(kind) ? (
                  <WordSelectionOverlay
                    pageIndex={pageIndex}
                    displayWidth={pageWidth}
                    displayHeight={pageHeight}
                    {...(activeMatchBbox !== undefined ? { activeMatchBbox } : {})}
                  />
                ) : null}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
