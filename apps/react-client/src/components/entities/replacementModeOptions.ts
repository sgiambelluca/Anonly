/**
 * `replacementModeOptions.ts` — etiquetas (es) de `ReplacementMode`
 * (`ui/UX_Guidelines.md` §3.5, ADR-087 §4). Presentacional puro, mismo
 * criterio que `entityTypeLabels.ts`.
 *
 * **Las etiquetas nombran lo que se ve en el papel, no el mecanismo.**
 * "Placeholder", "Máscara", "Sintético" y "Redactar" eran jerga de dominio: un
 * perito o un abogado no tiene forma de saber que "Sintético" le va a inventar
 * un nombre falso plausible. `ReplacementMode` **no cambia** (ADR-012 sigue
 * vigente, los cuatro valores del enum son los mismos): cambia solo cómo se
 * los llama.
 *
 * La **vista previa** de cada opción es la del grupo real de la fila
 * (`resolveModePreview`, ADR-170): la pregunta que el usuario tiene es qué le
 * pasa *a su dato*.
 */

import { ReplacementMode, type ReplacementPreviews } from "@anonly/anonymization-core";

import type { SelectOption } from "../common/Select.js";

export const REPLACEMENT_MODE_LABEL: Readonly<Record<ReplacementMode, string>> = {
  [ReplacementMode.Placeholder]: "Etiquetar",
  [ReplacementMode.Mask]: "Ocultar parcialmente",
  [ReplacementMode.Synthetic]: "Reemplazar por dato falso",
  [ReplacementMode.Redact]: "Tapar con negro",
};

/**
 * Forma corta, **solo para el disparador** de los selectores.
 *
 * El menú muestra siempre la forma larga de arriba, que es donde el usuario
 * lee qué hace cada modo. El disparador de la fila mide 11 rem: "Ocultar
 * parcialmente" no entra y se corta en "Ocultar parcialme…", que es peor que
 * una forma corta elegida a propósito. Verificado en el browser sobre la barra
 * lateral a 480 px.
 */
export const REPLACEMENT_MODE_SHORT_LABEL: Readonly<Record<ReplacementMode, string>> = {
  [ReplacementMode.Placeholder]: "Etiquetar",
  [ReplacementMode.Mask]: "Ocultar parcial",
  [ReplacementMode.Synthetic]: "Dato falso",
  [ReplacementMode.Redact]: "Tapar con negro",
};

export const REPLACEMENT_MODE_ORDER: ReadonlyArray<ReplacementMode> = [
  ReplacementMode.Placeholder,
  ReplacementMode.Mask,
  ReplacementMode.Synthetic,
  ReplacementMode.Redact,
];

export const REPLACEMENT_MODE_OPTIONS: ReadonlyArray<SelectOption<ReplacementMode>> =
  REPLACEMENT_MODE_ORDER.map((mode) => ({ value: mode, label: REPLACEMENT_MODE_LABEL[mode] }));

/**
 * ADR-169 §6: la descripción **fija** de cada modo en el menú. No depende del
 * grupo ni del modo vigente: elegir otra opción solo mueve el tilde, y ningún
 * texto del menú cambia.
 */
export const REPLACEMENT_MODE_DESCRIPTION: Readonly<Record<ReplacementMode, string>> = {
  [ReplacementMode.Placeholder]: "Tipo y número, para seguir quién es quién",
  [ReplacementMode.Mask]: "Tapa cada letra y conserva la forma",
  [ReplacementMode.Synthetic]: "Un dato inventado del mismo tipo",
  [ReplacementMode.Redact]: "Un bloque negro sobre el texto",
};

/**
 * La vista previa de una opción del menú (ADR-169 §6, ADR-170 §1).
 *
 * **Exacta, y la calcula el Core**: `EntityGroup.replacementPreviews` trae lo
 * que valdría `replacementValue` en cada modo para ese grupo —la escalera de
 * ADR-057, el género de ADR-060, `MASK_FORMAT_BY_TYPE`, el sintetizador de
 * ADR-072—. La UI **no reimplementa ninguno** (`React_Client.md` U-3): hasta
 * ADR-170 solo el modo vigente se mostraba exacto y los otros tres eran
 * esquemáticos, y el menú se reescribía entero al elegir.
 *
 * - `redact` no tiene texto: se dibuja el bloque (`"bar"`).
 * - Sin grupo concreto (nivel documento) no hay vista previa de texto
 *   (`"none"`): el nivel documento es genérico (`UX_Guidelines.md` §3.5).
 */
export type ModePreview =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "bar" }
  | { readonly kind: "none" };

export function resolveModePreview(
  mode: ReplacementMode,
  previews: ReplacementPreviews | null,
): ModePreview {
  if (mode === ReplacementMode.Redact) return { kind: "bar" };
  if (previews === null) return { kind: "none" };
  switch (mode) {
    case ReplacementMode.Placeholder:
      return { kind: "text", value: previews.placeholder };
    case ReplacementMode.Mask:
      return { kind: "text", value: previews.mask };
    case ReplacementMode.Synthetic:
      return { kind: "text", value: previews.synthetic };
  }
}
