/**
 * Geometría visible de los menús flotantes anclados a sus disparadores.
 *
 * El caso que lo motiva: el menú de modos de las últimas filas de la lista de
 * entidades. La lista scrollea y recorta lo que se sale, así que el menú
 * quedaba tapado y había que scrollear para leerlo.
 *
 * El cálculo geométrico es puro para poder probarlo en Node sin jsdom; el
 * observador DOM comparte los mismos límites y se limpia al cerrar el menú.
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

export interface MenuLayoutInput {
  /** Bordes verticales del disparador, en coordenadas de ventana. */
  readonly triggerTop: number;
  readonly triggerBottom: number;
  /** Alto intrínseco del panel, sin separación respecto del disparador. */
  readonly menuHeight: number;
  readonly gap: number;
  /** Intersección de ventana y ancestros que recortan contenido vertical. */
  readonly boundaryTop: number;
  readonly boundaryBottom: number;
}

export interface MenuLayout {
  readonly placement: MenuPlacement;
  /** Desplazamiento CSS top respecto del borde superior del disparador. */
  readonly top: number;
  /** Alto máximo del panel dentro del área visible. */
  readonly maxHeight: number;
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
  return { top, bottom: Math.max(top, bottom) };
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

/** Conserva la dirección y desplaza el panel lo mínimo dentro del área visible. */
export function resolveMenuLayout(input: MenuLayoutInput): MenuLayout {
  const placement = resolveMenuPlacement({
    triggerTop: input.triggerTop,
    triggerBottom: input.triggerBottom,
    menuHeight: input.menuHeight + input.gap,
    boundaryTop: input.boundaryTop,
    boundaryBottom: input.boundaryBottom,
  });
  const availableHeight = Math.max(0, input.boundaryBottom - input.boundaryTop);
  const maxHeight = Math.min(Math.max(0, input.menuHeight), availableHeight);

  if (input.menuHeight > availableHeight) {
    return { placement, top: input.boundaryTop - input.triggerTop, maxHeight };
  }

  const desiredTop =
    placement === "bottom"
      ? input.triggerBottom + input.gap
      : input.triggerTop - input.gap - input.menuHeight;
  const lastTop = input.boundaryBottom - input.menuHeight;
  const top = Math.min(Math.max(desiredTop, input.boundaryTop), lastTop);
  return { placement, top: top - input.triggerTop, maxHeight };
}

function clippingAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (window.getComputedStyle(node).overflowY !== "visible") ancestors.push(node);
  }
  return ancestors;
}

function intrinsicMenuHeight(menu: HTMLElement): number {
  const style = window.getComputedStyle(menu);
  const borders =
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0);
  return Math.max(menu.scrollHeight + borders, menu.getBoundingClientRect().height);
}

/**
 * Observa el menú y los límites que pueden cambiar por resize, scroll o reflow.
 * `scrollHeight` mantiene la medida intrínseca aunque el panel ya tenga max-height.
 */
export function observeMenuLayout(
  container: HTMLElement,
  menu: HTMLElement,
  onLayout: (layout: MenuLayout) => void,
): () => void {
  const ancestors = clippingAncestors(container);
  const measure = (): void => {
    const trigger = container.getBoundingClientRect();
    const boundary = clippingBoundary(container);
    const menuHeight = intrinsicMenuHeight(menu);
    const availableHeight = Math.max(0, boundary.bottom - boundary.top);
    if (menuHeight <= availableHeight && menu.scrollTop !== 0) menu.scrollTop = 0;
    onLayout(
      resolveMenuLayout({
        triggerTop: trigger.top,
        triggerBottom: trigger.bottom,
        menuHeight,
        gap: 4,
        boundaryTop: boundary.top,
        boundaryBottom: boundary.bottom,
      }),
    );
  };

  measure();
  window.addEventListener("resize", measure);
  document.addEventListener("scroll", measure, true);
  const observer = new ResizeObserver(measure);
  observer.observe(container);
  observer.observe(menu);
  for (const ancestor of ancestors) observer.observe(ancestor);

  return () => {
    window.removeEventListener("resize", measure);
    document.removeEventListener("scroll", measure, true);
    observer.disconnect();
  };
}
