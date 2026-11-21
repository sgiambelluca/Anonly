/**
 * `fieldHint.ts` — la lógica de la línea de ayuda bajo un campo
 * (`UX_Guidelines.md` §11b.17). Pura: el componente `FieldHint` solo dibuja.
 *
 * La línea siempre dice algo: la ayuda (el contador, una pista, cómo queda) o,
 * si hay un error, el error. Nunca queda un hueco reservado.
 */

export type FieldHintKind = "help" | "error";

export interface FieldHintContent {
  readonly kind: FieldHintKind;
  readonly text: string;
}

/** Qué muestra la línea: el error si hay uno (no vacío), si no la ayuda. */
export function resolveFieldHint(help: string, error: string | null): FieldHintContent {
  if (error !== null && error !== "") return { kind: "error", text: error };
  return { kind: "help", text: help };
}

/** El contador de un campo con tope: `6/40`. */
export function lengthCounter(value: string, max: number): string {
  return `${Array.from(value.trim()).length}/${max}`;
}

/** Une las partes de la ayuda con « · », salteando las vacías. */
export function joinHelp(...parts: ReadonlyArray<string>): string {
  return parts.filter((part) => part !== "").join(" · ");
}

/** Borde del campo: rojo con error, el de siempre sin él. */
export function fieldBorderClass(invalid: boolean): string {
  return invalid ? "border-error" : "border-border";
}
