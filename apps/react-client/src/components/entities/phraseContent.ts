/**
 * `phraseContent.ts` — qué se dibuja en el lugar del dato dentro de la frase
 * que muestran los diálogos de edición (`ContextPreview`, ADR-215 §3,
 * `ui/Components.md` §3.3b y §3.5b).
 *
 * Lógica pura y separada del componente por la razón de siempre en este repo:
 * `vitest.config.ts` corre con `environment: node` y no hay tests de render
 * (mismo criterio que `replacementFit.ts` y `degradedMessage.ts`).
 *
 * El lugar del dato mide **lo que medía el original** (es lo que hace el render:
 * el reemplazo se dibuja dentro del ancho del original y se achica si no
 * entra, ADR-058). Lo que cambia es qué va adentro.
 */

import { ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";

/** Lo que va en el lugar del dato. */
export type PhraseContent =
  /** Un texto de reemplazo, achicado si no entra. */
  | { readonly kind: "text"; readonly text: string }
  /** El bloque negro del modo `redact`, del ancho del original. */
  | { readonly kind: "block" }
  /** El texto original, resaltado: el dato queda a la vista. */
  | { readonly kind: "original" }
  /** El lugar vacío, con el ancho del original (no hay qué mostrar). */
  | { readonly kind: "empty" };

/**
 * "Hoy": lo que muestra hoy el documento anonimizado en ese lugar.
 *
 * - Grupo deshabilitado: el dato no se reemplaza, así que se ve el original.
 * - Modo `redact`: el bloque negro (su `replacementValue` es siempre `""`).
 * - Cualquier otro modo: el reemplazo vigente.
 */
export function todayPhrase(
  group: Pick<EntityGroup, "enabled" | "replacementMode" | "replacementValue">,
): PhraseContent {
  if (!group.enabled) return { kind: "original" };
  if (group.replacementMode === ReplacementMode.Redact) return { kind: "block" };
  return { kind: "text", text: group.replacementValue };
}
