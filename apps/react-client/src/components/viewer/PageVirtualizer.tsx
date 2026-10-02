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
 *
 * **ADR-087 §2** retira las props `scrollSync` y `kind`, y todo lo que colgaba
 * de la primera (el `register`, el `notifyScroll`, y el `ResizeObserver` que
 * detectaba el panel volviéndose visible para realinearlo): con **un solo**
 * visor no hay dos scrolls que sincronizar ni un panel oculto que realinear, y
 * `kind` solo servía para identificarse ante el controller.
 *
 * Ningún contenedor con scroll lleva `scroll-behavior: smooth`: animaría la
 * asignación de `scrollTop` y pelearía con el salto explícito a una página del
 * buscador, que necesita el valor exacto.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { computeCurrentPageIndexFromScroll } from "./currentPageIndex.js";
import {
  anchorScrollTop,
  isStripOnlyChange,
  scrollTopForPage,
  type PageSlots,
} from "./pageSlots.js";
import {
  computeMountRange,
  computeVisibleRangeFromIndices,
  type VisibleRange,
} from "./visibleRange.js";

export interface PageVirtualizerProps {
  readonly pageCount: number;
  readonly renderItem: (pageIndex: number) => ReactNode;
  readonly visibleRange: VisibleRange;
  /**
   * Geometría de las filas (`pageSlots.ts`): desplazamiento y alto de cada
   * una. Reemplaza al `pageSize` uniforme de antes — una página marcada con
   * `unreadableInk` reserva una franja de aviso (ADR-190 §4) y su fila es más
   * alta que las demás.
   */
  readonly slots: PageSlots;
  /**
   * Ancho de página en CSS px (`PdfViewer.pageWidth`, `pageLayout.ts`), para
   * que el contenedor con scroll crezca cuando el zoom hace que la página
   * sea más ancha que el panel — ver el comentario de `width` más abajo.
   */
  readonly pageWidth: number;
  readonly onVisibleRangeChange: (range: VisibleRange) => void;
  /** Página actual derivada de la geometría de scroll de este panel (ADR-054 §5). Se reporta solo cuando cambia. */
  readonly onCurrentPageIndexChange: (pageIndex: number) => void;
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
  pageCount,
  renderItem,
  visibleRange,
  slots,
  pageWidth,
  onVisibleRangeChange,
  onCurrentPageIndexChange,
  scrollRequest,
}: PageVirtualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const intersectingRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | undefined>(undefined);
  const lastReportedRef = useRef<VisibleRange | undefined>(undefined);
  const lastReportedPageIndexRef = useRef<number | undefined>(undefined);

  // Último `scrollTop` que el usuario (o un salto) dejó, por evento de scroll.
  // El anclaje de abajo lo necesita **de antes** del cambio de `slots`: si el
  // contenido se achica, el navegador recorta `scrollTop` en el mismo commit y
  // leerlo del DOM daría el valor ya recortado (el evento de scroll de ese
  // recorte llega después del efecto).
  const lastScrollTopRef = useRef(0);
  const previousSlotsRef = useRef(slots);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    lastScrollTopRef.current = container.scrollTop;
    function trackScroll(): void {
      if (container) lastScrollTopRef.current = container.scrollTop;
    }
    container.addEventListener("scroll", trackScroll);
    return () => container.removeEventListener("scroll", trackScroll);
  }, []);

  // Anclaje del scroll (ADR-190 §4, `ui/Components.md` §5.3): si `slots` cambia
  // porque una página ganó o perdió su franja, se corrige `scrollTop` para que
  // la fila visible de arriba quede donde estaba. Solo ese tipo de cambio
  // (`isStripOnlyChange`): un cambio de zoom o de documento no se ancla. Es un
  // efecto de layout —antes de pintar— para que no haya un cuadro con el
  // contenido corrido; va **antes** del efecto del salto explícito, así que si
  // en el mismo commit hay un salto, el salto tiene la última palabra.
  useLayoutEffect(() => {
    const previous = previousSlotsRef.current;
    previousSlotsRef.current = slots;
    const container = containerRef.current;
    if (!container || previous === slots || !isStripOnlyChange(previous, slots)) return;
    const anchored = anchorScrollTop(
      previous,
      slots,
      lastScrollTopRef.current,
      container.clientHeight,
    );
    if (anchored !== lastScrollTopRef.current) {
      container.scrollTop = anchored;
      lastScrollTopRef.current = anchored;
    }
    // Aunque no haga falta corregir `scrollTop` (no se dispara ningún evento de
    // scroll), una franja que aparece o desaparece entre la fila de arriba y el
    // centro de la vista puede cambiar qué página ocupa el centro: se recalcula
    // la página actual acá. Solo para cambios de franja: el zoom conserva su
    // comportamiento de siempre.
    reportCurrentPage(container);
  }, [slots]);

  // Deriva la página actual por geometría (ADR-054 §5) y la reporta solo si
  // cambió. Lo usan el listener de scroll y el anclaje de arriba.
  function reportCurrentPage(container: HTMLDivElement): void {
    const pageIndex = computeCurrentPageIndexFromScroll({
      scrollTop: container.scrollTop,
      clientHeight: container.clientHeight,
      slots,
    });
    if (lastReportedPageIndexRef.current === pageIndex) return;
    lastReportedPageIndexRef.current = pageIndex;
    onCurrentPageIndexChange(pageIndex);
  }

  // Listener nativo de scroll: deriva la página actual por geometría
  // (ADR-054 §5). Deliberadamente sin rAF: es aritmética barata sobre un solo número, y el
  // reporte a React ya está dedupeado por `lastReportedPageIndexRef` (solo
  // escribe el store si la página cambió, no en cada tick de scroll) — el rAF
  // del IntersectionObserver de abajo resuelve un problema distinto (coalescer
  // múltiples entradas del mismo frame en un Set).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleScroll(): void {
      if (container) reportCurrentPage(container);
    }

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
    // `onCurrentPageIndexChange` deliberadamente no es dependencia, mismo
    // criterio que `onVisibleRangeChange` más abajo: es un callback estable en
    // la práctica y no hay `eslint-plugin-react-hooks` en este repo que lo
    // exija.
  }, [slots]);

  // Salto explícito a una página (DocumentSearchBox, ui/Components.md §5.4c).
  // Sin `scroll-behavior: smooth`: no hace falta animarlo y la animación
  // pelearía con la asignación exacta de `scrollTop`.
  useEffect(() => {
    if (!scrollRequest) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = scrollTopForPage(slots, scrollRequest.pageIndex);
    lastScrollTopRef.current = container.scrollTop;
    // Deps acotadas a propósito a `nonce`: no a `slots` (evitar re-saltar en
    // cada cambio de zoom o de franjas) ni a `scrollRequest.pageIndex` solo (el
    // `nonce` es lo que fuerza el salto cuando dos matches caen en la misma
    // página); `slots` se lee fresco igual porque el cuerpo del efecto se
    // recrea en cada render. Mismo criterio que el resto del componente: no hay
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
    <div
      ref={containerRef}
      data-testid="page-virtualizer-scroll"
      className="relative h-full w-full overflow-auto"
    >
      {/*
       * `width: max(pageWidth, 100%)` en vez de dejarlo en el 100% implícito
       * de un bloque: a zoom alto `pageWidth` supera el ancho del panel, y
       * `PagePhantom` (`inset-x-0`, más abajo) toma el ancho de ESTE div, no
       * el del panel. Sin esto, `PagePhantom` se queda angosto (el del
       * panel) y centra un `renderItem` más ancho vía flex — desborda por
       * igual a los dos lados, pero un navegador en LTR solo cuenta el
       * desborde hacia la **derecha** como `scrollWidth`: el borde
       * izquierdo de la página (texto rotado pegado al margen, p. ej.)
       * queda a `scrollLeft` negativo, inalcanzable (`scrollLeft` no baja de
       * 0). Con este div creciendo primero, `PagePhantom` hereda el ancho
       * correcto y el `renderItem` de `PdfViewer` (mismo ancho, `shrink-0`)
       * queda pegado al borde izquierdo sin desbordar para ningún lado —
       * todo el contenido cae en `scrollLeft ∈ [0, scrollWidth]`, alcanzable
       * scrolleando a la derecha. Cuando `pageWidth ≤` el panel, `max(...)`
       * da el 100% de siempre y `PagePhantom` centra el `renderItem` más
       * angosto — comportamiento sin cambios en ese caso (confirmado con un
       * harness aislado, mismo criterio que `wordSelectionRect.ts`).
       */}
      <div
        className="relative"
        style={{ height: slots.totalHeight, width: `max(${pageWidth}px, 100%)` }}
      >
        {pageIndices.map((pageIndex) => (
          <PagePhantom
            key={pageIndex}
            pageIndex={pageIndex}
            top={slots.offsets[pageIndex] ?? 0}
            height={slots.heights[pageIndex] ?? 0}
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
  top,
  height,
  observer,
  children,
}: {
  readonly pageIndex: number;
  readonly top: number;
  readonly height: number;
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
      style={{ top, height }}
    >
      {children}
    </div>
  );
}
