/**
 * `scrollSync.ts` — sincronización real de scroll entre los dos `PdfViewer`
 * de `SideBySideViewer` (`ui/Components.md` §5.1: "dos PdfViewer... con
 * scroll sincronizado"; `ui/React_Client.md` §7: "Lado a lado sincronizado:
 * scroll vertical compartido vía `viewer.currentPageIndex`";
 * `architecture/07_Performance_Strategy.md` §3.1: "dos virtualizers
 * sincronizados... vía estado Zustand").
 *
 * Cada `PageVirtualizer` tiene su propio contenedor con scroll
 * (`overflow-y-auto` independiente). Compartir un `visibleRange` global no
 * mueve el scroll del contenedor que el usuario no tocó — solo cambia qué
 * páginas monta. Este módulo resuelve la otra mitad: cuando
 * `viewer.store.currentPageIndex` cambia (porque UNO de los dos scrolleó),
 * el OTRO tiene que desplazar su contenedor programáticamente para mostrar
 * la misma página.
 *
 * El riesgo es un loop de realimentación: desplazar un contenedor
 * programáticamente dispara su propio `IntersectionObserver`, que reporta un
 * nuevo rango visible, que vuelve a escribir `currentPageIndex` — que podría
 * disparar el efecto de sincronización de nuevo. `computeScrollSyncTarget`
 * lo corta: un `PageVirtualizer` solo se re-sincroniza si `currentPageIndex`
 * no coincide con el **último rango que él mismo reportó**. Si coincide, el
 * cambio se originó en su propio scroll (o ya convergió tras un hop de
 * sincronización) y no hay que actuar — ver `PageVirtualizer.tsx`, donde
 * `lastReportedRef` ya existe para el idéntico propósito de no repetir
 * `onVisibleRangeChange` con el mismo rango.
 */

/**
 * Decide si (y a qué `scrollTop`) hay que desplazar programáticamente el
 * contenedor de un `PageVirtualizer` para seguir `targetPageIndex`
 * (`viewer.store.currentPageIndex`, compartido entre los dos `PdfViewer`).
 *
 * Devuelve `undefined` si no hay que hacer nada:
 * - el cambio se originó en el propio scroll de este `PageVirtualizer`
 *   (`lastReportedStart === targetPageIndex`: o bien nunca se movió de ahí, o
 *   ya convergió tras un hop de sincronización anterior), o
 * - el contenedor ya está a ese `scrollTop` (dentro de una tolerancia de 1px,
 *   para no pelear con redondeos de sub-píxel).
 */
export function computeScrollSyncTarget(params: {
  readonly targetPageIndex: number;
  readonly lastReportedStart: number | undefined;
  readonly currentScrollTop: number;
  readonly pageSize: number;
}): number | undefined {
  const { targetPageIndex, lastReportedStart, currentScrollTop, pageSize } = params;
  if (lastReportedStart === targetPageIndex) return undefined;
  const target = targetPageIndex * pageSize;
  if (Math.abs(currentScrollTop - target) < 1) return undefined;
  return target;
}
