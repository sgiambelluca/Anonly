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

/**
 * Exact threshold predicate with a conservative Levenshtein band.
 * Keeps the current floating point comparison as the final decision.
 */
export function levenshteinNormalizedAtLeast(a: string, b: string, threshold: number): boolean {
  if (
    a.length === 0 ||
    b.length === 0 ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold >= 1
  ) {
    return levenshteinNormalized(a, b) >= threshold;
  }

  const maxLen = Math.max(a.length, b.length);
  const radius = Math.min(maxLen, Math.ceil((1 - threshold) * maxLen) + 1);
  if (radius >= maxLen) return levenshteinNormalized(a, b) >= threshold;
  if (Math.abs(a.length - b.length) > radius) return false;

  const sentinel = radius + 1;
  let prefixLength = 0;
  while (
    prefixLength < a.length &&
    prefixLength < b.length &&
    a.charAt(prefixLength) === b.charAt(prefixLength)
  ) {
    prefixLength += 1;
  }
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > prefixLength && bEnd > prefixLength && a.charAt(aEnd - 1) === b.charAt(bEnd - 1)) {
    aEnd -= 1;
    bEnd -= 1;
  }
  const trimmedA = a.slice(prefixLength, aEnd);
  const trimmedB = b.slice(prefixLength, bEnd);
  if (trimmedA.length === 0 || trimmedB.length === 0) {
    const distance = Math.max(trimmedA.length, trimmedB.length);
    return distance <= radius && 1 - distance / maxLen >= threshold;
  }
  if (Math.abs(trimmedA.length - trimmedB.length) > radius) return false;

  let previousRow = new Array<number>(trimmedB.length + 1).fill(sentinel);
  let currentRow = new Array<number>(trimmedB.length + 1).fill(sentinel);
  for (let j = 0; j <= Math.min(trimmedB.length, radius); j++) previousRow[j] = j;

  for (let i = 1; i <= trimmedA.length; i++) {
    const start = Math.max(1, i - radius);
    const end = Math.min(trimmedB.length, i + radius);
    if (i <= radius) currentRow[0] = i;
    else currentRow[0] = sentinel;
    if (start > 1) currentRow[start - 1] = sentinel;
    if (end < trimmedB.length) previousRow[end] = sentinel;
    let rowMinimum = currentRow[0] ?? sentinel;
    for (let j = start; j <= end; j++) {
      const substitutionCost = trimmedA.charAt(i - 1) === trimmedB.charAt(j - 1) ? 0 : 1;
      const deletion = (previousRow[j] ?? sentinel) + 1;
      const insertion = (currentRow[j - 1] ?? sentinel) + 1;
      const substitution = (previousRow[j - 1] ?? sentinel) + substitutionCost;
      const distance = Math.min(deletion, insertion, substitution);
      currentRow[j] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > radius) return false;
    const swap = previousRow;
    previousRow = currentRow;
    currentRow = swap;
  }

  const distance = previousRow[trimmedB.length] ?? sentinel;
  return distance <= radius && 1 - distance / maxLen >= threshold;
}
