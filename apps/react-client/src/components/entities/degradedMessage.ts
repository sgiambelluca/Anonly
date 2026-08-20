/**
 * El texto del aviso de reemplazo ilegible (ADR-062).
 *
 * Vive en un `.ts` aparte y no dentro de `DegradedBadge.tsx` por la razón de
 * siempre en este repo: `vitest.config.ts` corre con `environment: node` y no
 * hay tests de render, así que lo que se quiera testear tiene que estar fuera
 * del `.tsx` (mismo motivo que `personGenderVisibility.ts` y
 * `replacementFit.ts`). Y este texto **se quiere** testear: es lo único de
 * ADR-062 que el usuario efectivamente lee.
 *
 * Regla de redacción, no negociable: **sin jerga**. Nada de "token",
 * "placeholder", "bbox", "degradado" ni umbrales. El usuario necesita tres
 * cosas —qué pasó, dónde, y que el dato sigue oculto— y las páginas se cuentan
 * desde 1, como las cuenta él, no desde 0 como las cuenta el `pageIndex`.
 */

/** "la página 3" / "las páginas 3 y 7" / "las páginas 3, 7 y 12". 1-based. */
export function describePages(pageIndices: ReadonlyArray<number>): string {
  const numbers = pageIndices.map((index) => index + 1);
  if (numbers.length === 0) return "";
  if (numbers.length === 1) return `la página ${String(numbers[0])}`;
  const last = numbers[numbers.length - 1];
  const rest = numbers.slice(0, -1).map(String).join(", ");
  return `las páginas ${rest} y ${String(last)}`;
}
