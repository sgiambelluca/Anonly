/**
 * `PageVirtualizer` (`ui/Components.md` §5.3, `architecture/07_Performance_Strategy.md`
 * §3): virtualiza el scroll de un visor de páginas. Mantiene un "phantom" por
 * página (dimensión + placeholder gris, siempre presente) para que el scroll
 * height total sea correcto, y solo monta contenido real (`renderItem`) para
 * las páginas dentro de `visibleRange` ± 1 (`computeMountRange`,
 * `visibleRange.ts`).
 *
 * Detección de visibilidad vía `IntersectionObserver` con `root` = el propio
 * contenedor con scroll, y batching de las actualizaciones vía
 * `requestAnimationFrame` (ambos exigidos explícitamente por el spec) para no
 * "thrashear" en scrolls rápidos.
 *
 * `visibleRange` es un prop **controlado**: el dueño del estado (`PdfViewer` →
 * `viewer.store`) decide qué rango se considera vigente; este componente solo
 * lo usa para decidir qué montar y reporta los cambios que detecta por su
 * cuenta vía `onVisibleRangeChange` (prop no listado textualmente en
 * `Components.md` §5.3, pero necesario para cerrar el loop que esa misma
 * sección exige: "usa IntersectionObserver para detectar visibilidad" tiene
 * que llegar a alguna parte).
 *
 * **ADR-054**: cada panel scrollea de forma independiente. Este componente ya
 * no recibe `scrollToPageIndex` (esa prop y el efecto que la consumía se
 * retiraron junto con `scrollSync.ts`/`computeScrollSyncTarget`, ADR-054 §6):
 * con scroll independiente no existe el concepto de "seguidor" por defecto.
 * En su lugar:
 * - Un listener nativo de `scroll` (no el `IntersectionObserver`, que solo
 *   decide qué montar — ADR-054 §5) deriva la página actual por geometría
 *   (`currentPageIndex.ts`) y la reporta vía `onCurrentPageIndexChange`, sin
 *   necesidad de rAF: es aritmética barata y el resultado se dedupe (solo se
 *   reporta si la página cambió), así que no escribe el store en cada tick.
 * - El mismo evento `scroll` notifica a `scrollSync` (`scrollSyncController.ts`,
 *   ADR-054 §3): si la sincronización opcional está prendida, empuja
 *   `scrollTop` al otro panel a nivel de píxel — imperativo, fuera de
 *   React/Zustand.
 * - Un `ResizeObserver` sobre el contenedor detecta la transición de alto 0 a
 *   alto > 0 (panel que se vuelve visible: cambio de tab, o la ventana que
 *   ensancha a `≥ lg`, ADR-054 §4 caso 2) y llama `scrollSync.notifyVisible`.
 *
 * Ningún contenedor con scroll lleva `scroll-behavior: smooth` (ADR-054 §7):
 * animaría la asignación de `scrollTop` y rompería la exactitud de la que
 * depende la idempotencia de `scrollSyncController.ts`.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ViewerKind } from "../../store/viewer.store.js";

import { computeCurrentPageIndexFromScroll } from "./currentPageIndex.js";
import type { ScrollSyncController } from "./scrollSyncController.js";
import {
  computeMountRange,
  computeVisibleRangeFromIndices,
  type VisibleRange,
} from "./visibleRange.js";

export interface PageVirtualizerProps {
  readonly kind: ViewerKind;
  readonly pageCount: number;
  readonly renderItem: (pageIndex: number) => ReactNode;
  readonly visibleRange: VisibleRange;
  readonly pageSize: number;
  readonly onVisibleRangeChange: (range: VisibleRange) => void;
  /** Página actual derivada de la geometría de scroll de este panel (ADR-054 §5). Se reporta solo cuando cambia. */
  readonly onCurrentPageIndexChange: (pageIndex: number) => void;
  /** Sincronización opcional de scroll a nivel de píxel entre los dos paneles (ADR-054 §3), creada una sola vez por `SideBySideViewer` y compartida entre sus dos `PdfViewer`. */
  readonly scrollSync: ScrollSyncController;
  /**
   * Salto explícito a una página, pedido por el usuario (`DocumentSearchBox`,
   * `ui/Components.md` §5.4c — "navegación anterior/siguiente con scroll a
   * la página"). Distinto del "seguidor" que ADR-054 §6 retiró: ahí un panel
   * copiaba el scroll del otro automáticamente; acá es el propio panel el
   * que salta por pedido directo del usuario, no por otro panel. `nonce`
   * fuerza el scroll aunque `pageIndex` no haya cambiado (dos coincidencias
   * seguidas en la misma página).
   */
  readonly scrollRequest?: { readonly pageIndex: number; readonly nonce: number } | null;
}

const PAGE_INDEX_ATTR = "pageIndex";

export function PageVirtualizer({
  kind,
  pageCount,
  renderItem,
  visibleRange,
  pageSize,
  onVisibleRangeChange,
  onCurrentPageIndexChange,
  scrollSync,
  scrollRequest,
}: PageVirtualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const intersectingRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | undefined>(undefined);
  const lastReportedRef = useRef<VisibleRange | undefined>(undefined);
  const lastReportedPageIndexRef = useRef<number | undefined>(undefined);

  // Registro en el controller de sincronización (ADR-054 §3): un solo
  // register por montaje del contenedor real.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return scrollSync.register(kind, container);
  }, [scrollSync, kind]);

  // Listener nativo de scroll: deriva la página actual por geometría
  // (ADR-054 §5) y notifica al controller de sincronización (ADR-054 §3).
  // Deliberadamente sin rAF: es aritmética barata sobre un solo número, y el
  // reporte a React ya está dedupeado por `lastReportedPageIndexRef` (solo
  // escribe el store si la página cambió, no en cada tick de scroll) — el rAF
  // del IntersectionObserver de abajo resuelve un problema distinto (coalescer
  // múltiples entradas del mismo frame en un Set).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleScroll(): void {
      if (!container) return;
      scrollSync.notifyScroll(kind);

      const pageIndex = computeCurrentPageIndexFromScroll({
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        pageSize,
        pageCount,
      });
      if (lastReportedPageIndexRef.current === pageIndex) return;
      lastReportedPageIndexRef.current = pageIndex;
      onCurrentPageIndexChange(pageIndex);
    }

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
    // `onCurrentPageIndexChange` deliberadamente no es dependencia, mismo
    // criterio que `onVisibleRangeChange` más abajo: es un callback estable en
    // la práctica y no hay `eslint-plugin-react-hooks` en este repo que lo
    // exija.
  }, [scrollSync, kind, pageSize, pageCount]);

  // ResizeObserver: detecta que este panel pasó de alto 0 (oculto, modo tabs)
  // a alto > 0 (visible) para realinearlo una vez si la sincronización está
  // prendida (ADR-054 §4, caso 2). `previousHeight` empieza `undefined` a
  // propósito: la primera medición (montaje) no es una transición real, así
  // que no dispara una realineación contra un panel que todavía no scrolleó.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let previousHeight: number | undefined;
    const resizeObserver = new ResizeObserver(() => {
      const height = container.clientHeight;
      if (previousHeight !== undefined && previousHeight <= 0 && height > 0) {
        scrollSync.notifyVisible(kind);
      }
      previousHeight = height;
    });
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [scrollSync, kind]);

  // Salto explícito a una página (DocumentSearchBox, ui/Components.md §5.4c).
  // Sin scroll-behavior: smooth acá tampoco (mismo motivo que el resto del
  // componente, ADR-054 §7): no hace falta animarlo y rompería la exactitud
  // del valor que `scrollSync` necesita si la sincronización está prendida.
  useEffect(() => {
    if (!scrollRequest) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = scrollRequest.pageIndex * pageSize;
    // Deps acotadas a propósito a `nonce`: no a `pageSize` (evitar re-saltar
    // en cada cambio de zoom) ni a `scrollRequest.pageIndex` solo (el `nonce`
    // es lo que fuerza el salto cuando dos matches caen en la misma página);
    // `pageSize` se lee fresco igual porque el cuerpo del efecto se recrea en
    // cada render. Mismo criterio que el resto del componente: no hay
    // `eslint-plugin-react-hooks` en este repo que exija la lista exhaustiva.
  }, [scrollRequest?.nonce]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const nextObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Narrowing seguro (Code_Standards.md §2): `IntersectionObserverEntry.target`
          // tipa `Element`, pero este observer solo observa los `HTMLDivElement`
          // que `PagePhantom` registra más abajo (con `data-page-index` propio).
          const target = entry.target as HTMLElement;
          const raw = target.dataset[PAGE_INDEX_ATTR];
          if (raw === undefined) continue;
          const index = Number(raw);
          if (entry.isIntersecting) {
            intersectingRef.current.add(index);
          } else {
            intersectingRef.current.delete(index);
          }
        }

        // requestAnimationFrame coalescea varias entradas del mismo frame de
        // scroll en una sola actualización (07_Performance_Strategy.md §3).
        if (rafRef.current !== undefined) return;
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = undefined;
          const nextRange = computeVisibleRangeFromIndices(intersectingRef.current);
          if (!nextRange) return;
          const last = lastReportedRef.current;
          if (last && last.start === nextRange.start && last.end === nextRange.end) return;
          lastReportedRef.current = nextRange;
          onVisibleRangeChange(nextRange);
        });
      },
      { root: container, threshold: 0 },
    );
    setObserver(nextObserver);

    return () => {
      nextObserver.disconnect();
      setObserver(null);
      if (rafRef.current !== undefined) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
      intersectingRef.current.clear();
    };
    // Se re-crea si cambia `pageCount` (nuevas páginas a observar tras
    // `DOCUMENT_PARSED`). `onVisibleRangeChange` deliberadamente no es
    // dependencia: es un callback estable en la práctica (ver `PdfViewer`,
    // donde no depende de estado que cambie por render) y no hay
    // `eslint-plugin-react-hooks` instalado en este repo para exigirlo.
  }, [pageCount]);

  const mountRange = useMemo(
    () => computeMountRange(visibleRange, pageCount),
    [visibleRange.start, visibleRange.end, pageCount],
  );

  const pageIndices = useMemo(
    () => Array.from({ length: Math.max(0, pageCount) }, (_, index) => index),
    [pageCount],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-y-auto">
      <div className="relative" style={{ height: pageCount * pageSize }}>
        {pageIndices.map((pageIndex) => (
          <PagePhantom
            key={pageIndex}
            pageIndex={pageIndex}
            pageSize={pageSize}
            observer={observer}
          >
            {pageIndex >= mountRange.start && pageIndex <= mountRange.end
              ? renderItem(pageIndex)
              : null}
          </PagePhantom>
        ))}
      </div>
    </div>
  );
}

function PagePhantom({
  pageIndex,
  pageSize,
  observer,
  children,
}: {
  readonly pageIndex: number;
  readonly pageSize: number;
  readonly observer: IntersectionObserver | null;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !observer) return;
    node.dataset[PAGE_INDEX_ATTR] = String(pageIndex);
    observer.observe(node);
    return () => observer.unobserve(node);
  }, [observer, pageIndex]);

  return (
    <div
      ref={ref}
      className="absolute inset-x-0 flex items-center justify-center bg-bg-tertiary"
      style={{ top: pageIndex * pageSize, height: pageSize }}
    >
      {children}
    </div>
  );
}
