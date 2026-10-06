/**
 * Hacia dónde se abre un menú flotante anclado a su disparador: abajo, que es
 * lo normal, o arriba cuando abajo no entra.
 *
 * El caso que lo motiva: el menú de modos de las últimas filas de la lista de
 * entidades. La lista scrollea y recorta lo que se sale, así que el menú
 * quedaba tapado y había que scrollear para leerlo.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

export type MenuPlacement = "bottom" | "top";

export interface ClippingBoundary {
  readonly top: number;
  readonly bottom: number;
}

export interface MenuPlacementInput {
  /** Borde superior e inferior del disparador, en coordenadas de ventana. */
  readonly triggerTop: number;
  readonly triggerBottom: number;
  /** Alto del menú, con su separación del disparador incluida. */
  readonly menuHeight: number;
  /** El área donde el menú se ve entero: lo que recorta, o la ventana. */
  readonly boundaryTop: number;
  readonly boundaryBottom: number;
}

/** Ventana intersectada con los ancestros que recortan contenido vertical. */
export function clippingBoundary(element: HTMLElement): ClippingBoundary {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

/**
 * Abajo si entra. Si no, arriba si ahí entra. Si no entra en ninguno, el lado
 * con más lugar; en el empate, abajo.
 */
export function resolveMenuPlacement(input: MenuPlacementInput): MenuPlacement {
  const spaceBelow = input.boundaryBottom - input.triggerBottom;
  const spaceAbove = input.triggerTop - input.boundaryTop;
  if (input.menuHeight <= spaceBelow) return "bottom";
  if (input.menuHeight <= spaceAbove) return "top";
  return spaceAbove > spaceBelow ? "top" : "bottom";
}
