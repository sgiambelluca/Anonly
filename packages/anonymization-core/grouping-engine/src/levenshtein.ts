/**
 * Levenshtein propio (Grouping_Engine.md §5: prohibido usar libs de fuzzy
 * matching externas como fuse.js/fast-levenshtein sin ADR). Implementación
 * DP clásica de distancia de edición, O(n*m), suficiente para comparar
 * `normalizedValue` de entidades (strings cortos, decenas de caracteres).
 *
 * No exportado desde index.ts: es un detalle interno del algoritmo de
 * matching (grouping.engine.ts), igual que patterns/default-ar.ts en
 * regex-engine no es re-exportado como implementación (solo su tabla de
 * datos DEFAULT_PATTERNS_AR sí se re-exporta ahí; acá no hay dato público
 * análogo, solo funciones).
 */

/** Distancia de edición (Levenshtein) cruda entre dos strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  let previousRow = new Array<number>(bLen + 1);
  let currentRow = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j++) {
    previousRow[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    currentRow[0] = i;
    const aChar = a.charAt(i - 1);
    for (let j = 1; j <= bLen; j++) {
      const bChar = b.charAt(j - 1);
      const substitutionCost = aChar === bChar ? 0 : 1;
      const deletion = (previousRow[j] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const substitution = (previousRow[j - 1] ?? 0) + substitutionCost;
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }
    const swap = previousRow;
    previousRow = currentRow;
    currentRow = swap;
  }

  return previousRow[bLen] ?? 0;
}

/**
 * Levenshtein normalizado a similitud [0,1] (Grouping_Engine.md
 * §"Algoritmos clave"): 1 - distancia / max(a.length, b.length).
 * Caso ambos vacíos: similitud 1.0. Caso uno vacío: similitud 0.0.
 */
export function levenshteinNormalized(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}
