/**
 * `removeEntityCopy.ts` — los textos y la decisión de `RemoveEntityDialog`
 * (`ui/Components.md` §3.5b, ADR-215 §2).
 *
 * Lógica pura y separada del componente: `vitest.config.ts` corre con
 * `environment: node` y no hay tests de render. Reemplaza a
 * `removeConfirmMessage` (la oración gris del `ConfirmDialog` genérico, ADR-171
 * §5): las tres consecuencias de ahora conservan sus tres datos —el texto
 * queda a la vista, sale de la lista y un nuevo análisis no la trae de vuelta—,
 * pero la primera va primero y en el color del texto principal.
 *
 * Regla de redacción de `degradedMessage.ts`, sin cambios: **sin jerga**.
 */

export const REMOVE_TITLE = "¿Eliminar esta entidad?";
export const REMOVE_DESCRIPTION = "Deja de ocultarse en todo el documento.";

/** Rótulos de los dos renglones de la frase. */
export const REMOVE_TODAY_LABEL = "Hoy";
export const REMOVE_IF_REMOVED_LABEL = "Si la eliminás";

/** La caja de la frase cuando el grupo no tiene una aparición para mostrar. */
export const REMOVE_NO_OCCURRENCE = "No hay una aparición para mostrar.";

/** Lo que se lee antes de la pista del atajo, en el pie. */
export const REMOVE_UNDO_HINT_LEAD = "Podés deshacerlo con";

/** Las dos consecuencias que no dependen del grupo. */
export const REMOVE_LIST_CONSEQUENCE = "Sale de la lista de entidades.";
export const REMOVE_REANALYZE_CONSEQUENCE =
  "Si un nuevo análisis la vuelve a encontrar, sigue eliminada.";

export interface VisibleConsequence {
  /** La parte en negrita. */
  readonly strong: string;
  /** El resto de la oración, con el espacio inicial incluido. */
  readonly rest: string;
}

/**
 * La primera consecuencia —la que importa—: el texto queda a la vista en el
 * documento exportado, en las N apariciones o, si hay una sola, "en su única
 * aparición". Un grupo sin apariciones no debería existir; si pasara, no se
 * inventa un número.
 */
export function visibleConsequence(occurrenceCount: number): VisibleConsequence {
  const strong = "Su texto queda a la vista";
  if (occurrenceCount === 1) {
    return { strong, rest: " en el documento exportado, en su única aparición." };
  }
  if (occurrenceCount <= 0) return { strong, rest: " en el documento exportado." };
  return {
    strong,
    rest: ` en el documento exportado, en las ${String(occurrenceCount)} apariciones.`,
  };
}
