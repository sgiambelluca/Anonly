/**
 * `treeNavigation.ts` — teclado del árbol de entidades (`UX_Guidelines.md`
 * §9: "atajos para expandir/colapsar (arrows), seleccionar (space), abrir
 * menú (Enter)").
 *
 * **Por qué existe.** El panel ya declaraba `role="tree"`, `role="treeitem"` y
 * `role="group"`, pero ningún nodo era focusable y ninguna tecla hacía nada:
 * un lector de pantalla anunciaba un árbol y entregaba una lista muerta. Es el
 * mismo defecto que el §15 de `Post_Hito10.8_Pendientes.md` cerró para
 * `role="menu"` — el rol promete un contrato de interacción, y ponerlo sin
 * implementarlo es peor que no ponerlo, porque el usuario que navega por
 * teclado confía en el anuncio.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom, así
 * que toda la decisión de "qué hace esta tecla" vive acá y el componente solo
 * ejecuta el comando que devuelve.
 */

/** Ids de nodo. Prefijados para que un tipo y un grupo nunca colisionen. */
export function typeNodeId(type: string): string {
  return `type:${type}`;
}

export function groupNodeId(groupId: string): string {
  return `group:${groupId}`;
}

/**
 * Un nodo **visible** del árbol. Los hijos de un tipo colapsado no están en la
 * lista: la navegación por flechas recorre lo que se ve, no la estructura
 * completa (patrón WAI-ARIA de tree).
 */
export type TreeNode =
  | { readonly kind: "type"; readonly id: string; readonly expanded: boolean }
  | { readonly kind: "group"; readonly id: string; readonly parentId: string };

export type TreeCommand =
  | { readonly kind: "focus"; readonly nodeId: string }
  | { readonly kind: "expand"; readonly nodeId: string }
  | { readonly kind: "collapse"; readonly nodeId: string }
  | { readonly kind: "toggleEnabled"; readonly nodeId: string }
  | { readonly kind: "openMenu"; readonly nodeId: string };

function focusAt(nodes: ReadonlyArray<TreeNode>, index: number): TreeCommand | null {
  const node = nodes[index];
  return node === undefined ? null : { kind: "focus", nodeId: node.id };
}

/**
 * Traduce una tecla a un comando, o `null` si esa tecla no significa nada en
 * este contexto (el componente entonces **no** hace `preventDefault`, y la
 * tecla sigue su curso normal).
 *
 * Sin wrap-around: `ArrowDown` en el último nodo se queda ahí. Envolver al
 * primero haría perder la referencia de dónde está uno en una lista que puede
 * tener cientos de filas.
 */
export function resolveTreeKey(
  nodes: ReadonlyArray<TreeNode>,
  activeId: string | null,
  key: string,
): TreeCommand | null {
  if (nodes.length === 0) return null;

  const index = nodes.findIndex((node) => node.id === activeId);
  // Sin nodo activo todavía (primer tecleo tras entrar al árbol): cualquier
  // tecla de navegación aterriza en el primero, en vez de no hacer nada.
  if (index === -1) {
    return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End"
      ? focusAt(nodes, key === "End" ? nodes.length - 1 : 0)
      : null;
  }

  const active = nodes[index];
  if (active === undefined) return null;

  switch (key) {
    case "ArrowDown":
      return focusAt(nodes, Math.min(index + 1, nodes.length - 1));
    case "ArrowUp":
      return focusAt(nodes, Math.max(index - 1, 0));
    case "Home":
      return focusAt(nodes, 0);
    case "End":
      return focusAt(nodes, nodes.length - 1);
    case "ArrowRight":
      // Colapsado → abre. Abierto → entra al primer hijo, que por
      // construcción de la lista visible es el nodo siguiente.
      if (active.kind !== "type") return null;
      return active.expanded ? focusAt(nodes, index + 1) : { kind: "expand", nodeId: active.id };
    case "ArrowLeft":
      // Simétrico: desde un hijo sube al padre; desde un tipo abierto cierra.
      if (active.kind === "group") return { kind: "focus", nodeId: active.parentId };
      return active.expanded ? { kind: "collapse", nodeId: active.id } : null;
    case " ":
      return { kind: "toggleEnabled", nodeId: active.id };
    case "Enter":
      // Solo las filas tienen menú contextual; en una cabecera de tipo
      // `Enter` no promete nada, así que no se intercepta.
      return active.kind === "group" ? { kind: "openMenu", nodeId: active.id } : null;
    default:
      return null;
  }
}
