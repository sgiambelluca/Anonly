/**
 * El rótulo de páginas del aviso de reemplazo ilegible (ADR-062, ADR-215 §1).
 *
 * Vive en un `.ts` aparte y no dentro de `DegradedBadge.tsx` por la razón de
 * siempre en este repo: `vitest.config.ts` corre con `environment: node` y no
 * hay tests de render, así que lo que se quiera testear tiene que estar fuera
 * del `.tsx` (mismo motivo que `personGenderVisibility.ts` y
 * `replacementFit.ts`).
 *
 * Regla de redacción, no negociable: **sin jerga**. Nada de "token",
 * "placeholder", "bbox", "degradado" ni umbrales. Las páginas se cuentan desde
 * 1, como las cuenta el usuario, no desde 0 como las cuenta el `pageIndex`.
 */

/** Cuántas páginas se listan antes de contar el resto (ADR-215 §1). */
const MAX_LISTED_PAGES = 3;

/**
 * El rótulo de páginas del diálogo de espacio justo (ADR-215 §1):
 * "Página 3" / "Páginas 3 y 7" / "Páginas 3, 7 y 12". Con más de tres se
 * listan las tres primeras y se cuenta el resto: "Páginas 3, 7, 12 y 5 más".
 * 1-based, como las cuenta el usuario. Sin páginas, vacío.
 */
export function pagesLabel(pageIndices: ReadonlyArray<number>): string {
  const numbers = pageIndices.map((index) => String(index + 1));
  const [first] = numbers;
  if (first === undefined) return "";
  if (numbers.length === 1) return `Página ${first}`;
  if (numbers.length > MAX_LISTED_PAGES) {
    const listed = numbers.slice(0, MAX_LISTED_PAGES).join(", ");
    return `Páginas ${listed} y ${String(numbers.length - MAX_LISTED_PAGES)} más`;
  }
  const last = numbers[numbers.length - 1] ?? first;
  return `Páginas ${numbers.slice(0, -1).join(", ")} y ${last}`;
}
