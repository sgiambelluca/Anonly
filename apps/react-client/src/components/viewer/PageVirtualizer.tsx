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
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { computeScrollSyncTarget } from "./scrollSync.js";
import {
  computeMountRange,
  computeVisibleRangeFromIndices,
  type VisibleRange,
} from "./visibleRange.js";

export interface PageVirtualizerProps {
  readonly pageCount: number;
  readonly renderItem: (pageIndex: number) => ReactNode;
  readonly visibleRange: VisibleRange;
  readonly pageSize: number;
  readonly onVisibleRangeChange: (range: VisibleRange) => void;
  /**
   * `viewer.store.currentPageIndex`, compartido entre los dos `PdfViewer` de
   * `SideBySideViewer` (`Components.md` §5.1 / `React_Client.md` §7: scroll
   * sincronizado). Cuando cambia por el scroll del OTRO visor, este
   * contenedor se desplaza programáticamente para seguirlo (`scrollSync.ts`);
   * si el cambio se originó en el propio scroll de este visor, no hace nada
   * (evita el loop de realimentación entre los dos `IntersectionObserver`).
   */
  readonly scrollToPageIndex: number;
}

const PAGE_INDEX_ATTR = "pageIndex";

export function PageVirtualizer({
  pageCount,
  renderItem,
  visibleRange,
  pageSize,
  onVisibleRangeChange,
  scrollToPageIndex,
}: PageVirtualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [observer, setObserver] = useState<IntersectionObserver | null>(null);
  const intersectingRef = useRef<Set<number>>(new Set());
  const rafRef = useRef<number | undefined>(undefined);
  const lastReportedRef = useRef<VisibleRange | undefined>(undefined);

  // Sincronización de scroll (Components.md §5.1, React_Client.md §7): si
  // `scrollToPageIndex` cambió por el scroll del OTRO PdfViewer, desplaza este
  // contenedor para seguirlo. `computeScrollSyncTarget` corta el loop de
  // realimentación comparando contra el último rango que ESTE virtualizador
  // reportó (si coincide, el cambio se originó acá mismo).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const target = computeScrollSyncTarget({
      targetPageIndex: scrollToPageIndex,
      lastReportedStart: lastReportedRef.current?.start,
      currentScrollTop: container.scrollTop,
      pageSize,
    });
    if (target !== undefined) {
      container.scrollTop = target;
    }
  }, [scrollToPageIndex, pageSize]);

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
