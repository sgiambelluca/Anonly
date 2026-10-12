/**
 * `tightSpaceDialog.ts` — la lógica del diálogo del aviso de espacio justo
 * (`ui/Components.md` §3.3b, ADR-215 §1): qué salidas se ofrecen, qué dibuja
 * el segundo renglón de la frase, qué aclara el renglón reservado y qué dice
 * el botón primario según la opción elegida.
 *
 * Vive en un `.ts` aparte y no dentro de `DegradedBadge.tsx` por la razón de
 * siempre en este repo: `vitest.config.ts` corre con `environment: node` y no
 * hay tests de render (mismo criterio que `degradedMessage.ts`).
 *
 * Regla de redacción de `degradedMessage.ts`, sin cambios: **sin jerga**.
 */

import { ReplacementMode } from "@anonly/anonymization-core";

import type { PhraseContent } from "./phraseContent.js";

/** Las tres salidas de ADR-062 §3. */
export type TightChoice = "shorter" | "redact" | "visible";

export interface TightOption {
  readonly id: TightChoice;
  readonly title: string;
  readonly description: string;
}

const SHORTER: TightOption = {
  id: "shorter",
  title: "Usar un texto más corto",
  description: "Se abre el editor, con sugerencias que sí entran.",
};

const REDACT: TightOption = {
  id: "redact",
  title: "Tapar con negro",
  description: "Un bloque negro sobre el texto. Siempre entra.",
};

const VISIBLE: TightOption = {
  id: "visible",
  title: "Dejarlo a la vista",
  description: "No se oculta: el dato se va a poder leer.",
};

/**
 * Las opciones, en el orden de ADR-215 §1. «Tapar con negro» no se ofrece si
 * el grupo ya está en `redact`: ya está tapado.
 */
export function tightOptions(mode: ReplacementMode): ReadonlyArray<TightOption> {
  return mode === ReplacementMode.Redact ? [SHORTER, VISIBLE] : [SHORTER, REDACT, VISIBLE];
}

/**
 * La opción efectiva: la elegida si sigue ofrecida, y si no —o si todavía no
 * se eligió nada— la primera (preselección de ADR-215 §1).
 */
export function resolveTightChoice(
  chosen: TightChoice | null,
  options: ReadonlyArray<TightOption>,
): TightChoice {
  if (chosen !== null && options.some((option) => option.id === chosen)) return chosen;
  return options[0]?.id ?? "shorter";
}

/**
 * El rótulo del segundo renglón. Con sugerencias, el texto que se dibuja es un
 * ejemplo; sin ellas, el lugar queda vacío y el rótulo no promete un ejemplo.
 */
export function tightResultLabel(choice: TightChoice, hasSuggestions: boolean): string {
  switch (choice) {
    case "shorter":
      return hasSuggestions ? "Con un texto más corto (ejemplo)" : "Con un texto más corto";
    case "redact":
      return "Con el bloque negro";
    case "visible":
      return "Sin ocultar";
  }
}

/**
 * Lo que dibuja el segundo renglón: la primera sugerencia, el bloque negro o el
 * original resaltado. Sin sugerencias, el lugar vacío con el ancho del original.
 */
export function tightResultContent(
  choice: TightChoice,
  suggestions: ReadonlyArray<string>,
): PhraseContent {
  switch (choice) {
    case "shorter": {
      const [first] = suggestions;
      return first !== undefined ? { kind: "text", text: first } : { kind: "empty" };
    }
    case "redact":
      return { kind: "block" };
    case "visible":
      return { kind: "original" };
  }
}

export interface TightClarification {
  readonly text: string;
  /** `true` cuando la aclaración advierte (se pinta en `--color-warning-strong`). */
  readonly warning: boolean;
}

/**
 * La aclaración del renglón reservado. Dejar el dato a la vista cambia lo que
 * se aclara: ya no es un problema de lectura sino de privacidad.
 */
export function tightClarification(choice: TightChoice): TightClarification {
  return choice === "visible"
    ? { text: "El dato va a quedar legible en el documento exportado.", warning: true }
    : {
        text: "El dato sigue oculto: es un problema de lectura, no de privacidad.",
        warning: false,
      };
}

/** El texto del botón primario: abrir el editor no aplica nada todavía. */
export function tightApplyLabel(choice: TightChoice): string {
  return choice === "shorter" ? "Abrir el editor" : "Aplicar";
}
