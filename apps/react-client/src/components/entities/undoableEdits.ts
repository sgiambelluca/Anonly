/**
 * `undoableEdits.ts` — los textos y la selección de las ediciones del árbol
 * que avisan con un toast (`applyEdits.ts` las ejecuta).
 *
 * Hasta ADR-172 este módulo también armaba el **undo** de cada una con la
 * operación contraria (restituir el `enabled` de cada grupo, reescribir el
 * valor anterior) y explicaba por qué fusionar, dividir, reclasificar y
 * agregar no podían tenerlo: el Core no tenía una inversa exacta. Esa razón
 * sigue siendo cierta, y por eso el deshacer ya no invierte operaciones:
 * vuelve a un punto de restauración que guarda el Core (`history.store`,
 * ADR-172 §1-§2), exacto para todas. Lo que queda acá es puro texto.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

export interface EnabledSnapshot {
  readonly groupId: string;
  /** El valor que tenía ANTES del cambio. */
  readonly enabled: boolean;
}

interface ToggleCandidate {
  readonly id: string;
  readonly enabled: boolean;
}

/**
 * Los grupos que de verdad cambian de estado. Los que ya estaban en `next` se
 * excluyen: incluirlos inflaría el contador del toast ("12 grupos" cuando el
 * usuario cambió 3) y emitiría escrituras que no cambian nada.
 */
export function groupsToToggle(
  groups: ReadonlyArray<ToggleCandidate>,
  next: boolean,
): ReadonlyArray<EnabledSnapshot> {
  return groups
    .filter((group) => group.enabled !== next)
    .map((group) => ({ groupId: group.id, enabled: group.enabled }));
}

/**
 * Texto del toast. Dice qué pasa con el documento, no qué campo se tocó:
 * "habilitado"/"deshabilitado" es vocabulario de la estructura de datos, y lo
 * que el usuario decidió es si ese dato se reemplaza o se deja como está.
 */
export function enabledToastText(params: {
  readonly count: number;
  /** Nombre del grupo o del tipo. */
  readonly label: string;
  /** `true` si el cambio fue sobre una cabecera de tipo (afecta a varios). */
  readonly isType: boolean;
  readonly next: boolean;
}): string {
  const { count, label, isType, next } = params;
  const verb = next ? "se anonimiza" : "no se anonimiza";
  const verbPlural = next ? "se anonimizan" : "no se anonimizan";
  if (!isType) return `«${label}» ${verb}`;
  return `${label}: ${count} ${count === 1 ? "grupo" : "grupos"} ${count === 1 ? verb : verbPlural}`;
}

/**
 * Toast de "Eliminar entidad" (ADR-171 §5): dice que el dato deja la lista y
 * que **no se va a ocultar** — la diferencia con deshabilitar es de lista, no
 * de documento.
 */
export function removedToastText(canonicalValue: string): {
  readonly title: string;
  readonly description: string;
} {
  return {
    title: `Eliminaste «${canonicalValue}»`,
    description: "Ya no está en la lista ni se va a ocultar",
  };
}

/** El texto del `ConfirmDialog` de "Eliminar entidad" (ADR-171 §5). */
export function removeConfirmMessage(canonicalValue: string): string {
  return `«${canonicalValue}» sale de la lista y su texto queda a la vista en el documento exportado. Si un nuevo análisis lo vuelve a encontrar, sigue eliminada.`;
}
