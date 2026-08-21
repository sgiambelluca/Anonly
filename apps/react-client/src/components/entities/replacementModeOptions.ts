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
 * El **ejemplo** se construye con el grupo real de la fila (`buildModeOptions`)
 * y no con un valor genérico: la pregunta que el usuario tiene es qué le pasa
 * *a su dato*.
 */

import { ReplacementMode } from "@anonly/anonymization-core";

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
 * Ejemplo del efecto de cada modo, para el menú de `ModeSelectMenu`.
 *
 * **El único valor exacto que la UI puede mostrar es el del modo vigente**, y
 * viene del propio grupo: `EntityGroup.replacementValue`, ya resuelto por el
 * Grouping Engine. Los otros tres **no se pueden calcular acá**:
 *
 * - el token de `placeholder` sale de la escalera de abreviaturas de ADR-057
 *   (`[PERSONA 01]`, `[PERS 01]` o `[PRS-01]` según cuánto espacio haya) y,
 *   sobre personas con género resuelto, de ADR-060 (`[MUJER 01]`);
 * - el formato de `mask` sale de `MASK_FORMAT_BY_TYPE`, que vive en
 *   `grouping-engine` — un motor, que la UI **no puede importar** (P-1);
 * - el valor de `synthetic` sale del sintetizador sembrado con el
 *   `EntityGroup.id` (ADR-072 §1).
 *
 * Reimplementar cualquiera de los tres sería exactamente lo que
 * `React_Client.md` U-3 prohíbe, y peor: un ejemplo *casi* correcto es una
 * mentira más difícil de detectar que uno declaradamente esquemático. Una
 * primera versión de este módulo mostraba `[PERSONA 01]` para todos los tipos
 * — un DNI previsualizaba como si fuera una persona.
 *
 * `redact` es la excepción: un bloque negro tiene una sola forma.
 */

const SCHEMATIC: Readonly<Record<ReplacementMode, string>> = {
  [ReplacementMode.Placeholder]: "una etiqueta con el tipo y un número",
  [ReplacementMode.Mask]: "el valor con sus caracteres tapados",
  [ReplacementMode.Synthetic]: "otro dato del mismo tipo, inventado",
  [ReplacementMode.Redact]: "███████",
};

export interface ModeExampleContext {
  /** Valor sobre el que se ilustra. */
  readonly sample: string;
  /** Modo vigente del grupo, si el nivel tiene uno. */
  readonly currentMode?: ReplacementMode;
  /** `EntityGroup.replacementValue` — el único valor exacto disponible. */
  readonly currentValue?: string;
}

export function describeModeExample(mode: ReplacementMode, context: ModeExampleContext): string {
  const exact =
    mode === context.currentMode &&
    context.currentValue !== undefined &&
    context.currentValue !== ""
      ? context.currentValue
      : SCHEMATIC[mode];
  return `${context.sample} → ${exact}`;
}
