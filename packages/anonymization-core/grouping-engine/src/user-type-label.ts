/**
 * Etiqueta de un tipo propio (ADR-219 §2, Contracts.md §5.2). Función pura y
 * dueña de la etiqueta: el façade la reexporta (Contracts.md §3.5). Vive en su
 * propio archivo para que `labels.ts` (que arma la escalera) y `user-types.ts`
 * (que valida) la compartan sin un ciclo de imports.
 */

const COMBINING_MARKS_RE = /\p{M}/gu;
const WHITESPACE_RE = /\s+/g;

/**
 * NFD, sin marcas combinantes, mayúsculas, espacios colapsados y recortados.
 * `"Historia clínica"` -> `"HISTORIA CLINICA"`. Es el nivel 0 de la escalera
 * (ADR-057).
 */
export function userTypeLabel(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_MARKS_RE, "")
    .toUpperCase()
    .replace(WHITESPACE_RE, " ")
    .trim();
}
