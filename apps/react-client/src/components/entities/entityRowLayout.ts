/**
 * `entityRowLayout.ts` — la grilla de columnas de la lista de entidades
 * (ADR-169 §2, `Components.md` §3.3).
 *
 * **Columnas de ancho fijo** (UX-10): casilla · N.º · nombre (la única que
 * absorbe el encogido) · avisos (52 px: dos avisos juntos entran) ·
 * apariciones · género (ranura siempre reservada, ADR-169 §4) · reemplazo ·
 * ⋯. Los avisos no corren a las apariciones, y que un grupo pase a
 * `placeholder` y gane el botón de género no mueve el selector de modo.
 *
 * La comparten la fila (`EntityGroupItem`) y el encabezado de columnas
 * (`EntitiesPanel`), para que N.º, Avisos y Apar. queden alineados con lo que
 * rotulan.
 */

export const ENTITY_ROW_GRID =
  "grid grid-cols-[18px_24px_minmax(0,1fr)_52px_30px_26px_6.75rem_28px] items-center gap-x-1";

/** Relleno horizontal de la fila (y del encabezado), para que la grilla calce. */
export const ENTITY_ROW_PADDING = "pl-4 pr-2";
