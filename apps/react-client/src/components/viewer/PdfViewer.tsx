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
import { useEffect, useMemo, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useDocumentStore } from "../../store/document.store.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { useViewerStore, type ViewerKind } from "../../store/viewer.store.js";

import { DocumentSearchBox } from "./DocumentSearchBox.js";
import { PageCanvas } from "./PageCanvas.js";
import { computePageHeight, computePageWidth } from "./pageLayout.js";
import { PageVirtualizer } from "./PageVirtualizer.js";
import { PREVIEW_RETRY_INTERVAL_MS, pagesMissingPreview } from "./previewRetry.js";
import { shouldTriggerReadyRender } from "./readyRenderTrigger.js";
import { computeMountRange, rangeToPageIndices, type VisibleRange } from "./visibleRange.js";
import { WordSelectionOverlay } from "./WordSelectionOverlay.js";
import { isOriginalPanel } from "./wordSelectionRect.js";
import { computeZoomRenderScale } from "./zoomRenderScale.js";
import { createZoomRenderScheduler } from "./zoomRenderScheduler.js";

const KIND_LABEL: Readonly<Record<ViewerKind, string>> = {
  original: "Documento original",
  anonymized: "Documento anonimizado",
};

export function PdfViewer() {
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
      {/*
        El rótulo del lado lo dice ahora el `ViewerModeToggle` (ADR-087 §2), así
        que esta barra solo existe cuando hay buscador — o sea, en `original`.
        Repetir "Documento original" al lado del toggle que ya dice "Original"
        sería decir lo mismo dos veces en la misma línea.
      */}
      {isOriginalPanel(kind) ? (
        <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-border bg-bg-secondary px-3">
          <DocumentSearchBox onActiveMatchChange={handleActiveMatchChange} />
        </div>
      ) : null}
      <div className="flex-1 overflow-hidden" aria-label={KIND_LABEL[kind]}>
        <PageVirtualizer
          pageCount={pageCount}
          visibleRange={visibleRange}
          pageSize={pageHeight}
          pageWidth={pageWidth}
          onVisibleRangeChange={handleVisibleRangeChange}
          onCurrentPageIndexChange={handleCurrentPageIndexChange}
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
              //
              // `shrink-0` es necesario y no cosmético: `PagePhantom` es un
              // contenedor flex, y un hijo con `width` fija pero sin
              // `flex-shrink: 0` sigue con el `flex-shrink: 1` por defecto —
              // si `pageWidth` (crece con `zoom`) supera el ancho real del
              // panel (constante, no depende del zoom), el motor de flexbox
              // encoge el wrapper para que entre, y el tamaño renderizado
              // vuelve a divergir de `pageWidth` exactamente como antes de
              // este fix (confirmado con el mismo harness aislado: sin
              // `shrink-0`, un wrapper de 509px en un panel de 500px
              // renderiza a 500px real). Con `shrink-0` el wrapper mantiene
              // su tamaño real aunque desborde — el contenedor scrollea
              // horizontal en vez de mentir sobre su tamaño.
              <div className="relative shrink-0" style={{ width: pageWidth, height: pageHeight }}>
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
