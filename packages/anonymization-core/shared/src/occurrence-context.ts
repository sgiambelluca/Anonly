/**
 * ADR-105: la frase que rodea a una ocurrencia, para que el separador pueda
 * distinguir apariciones del **mismo** valor.
 *
 * Vive en `shared` y no en cada motor porque `regex-engine` y `ner-engine`
 * necesitan exactamente lo mismo y no pueden importarse entre sí (P-1/P-2).
 * Mismo criterio y mismo lugar que `sharesVerticalBand` y
 * `normalizeForComparison` (ADR-061 §2 errata).
 */
import type { OccurrenceContext } from "./types.js";

/**
 * Caracteres de contexto a cada lado (ADR-105 §3). Ventana fija y no corte
 * por oración: partir oraciones en español jurídico es un problema propio
 * —`Dr.`, `N°`, `art.`, `I.P.P.` son puntos que no terminan nada— y una
 * ventana es predecible y no falla raro.
 */
export const OCCURRENCE_CONTEXT_CHARS = 40;

/**
 * Retrocede hasta el comienzo de la palabra que la ventana cortó por la
 * mitad. Sin esto el contexto empieza con un fragmento (`"…nalmente, se"`)
 * que se lee peor que empezar un poco más adentro.
 */
function trimToWordStart(text: string, from: number): number {
  if (from <= 0) return 0;
  const nextSpace = text.indexOf(" ", from);
  return nextSpace === -1 ? from : nextSpace + 1;
}

/** Avanza hasta el final de la palabra que la ventana cortó por la mitad. */
function trimToWordEnd(text: string, to: number): number {
  if (to >= text.length) return text.length;
  const prevSpace = text.lastIndexOf(" ", to);
  return prevSpace === -1 ? to : prevSpace;
}

/**
 * Contexto de `[startIndex, endIndexExclusive)` dentro de `text`.
 *
 * El valor **no** se incluye: ya viaja en `Occurrence.value` /
 * `OccurrenceRef.value` (ADR-104). Devuelve `undefined` cuando no hay nada
 * alrededor, para que el consumidor distinga "sin contexto" de "contexto
 * vacío" (ADR-105 §4).
 */
export function buildOccurrenceContext(
  text: string,
  startIndex: number,
  endIndexExclusive: number,
): OccurrenceContext | undefined {
  if (startIndex < 0 || endIndexExclusive > text.length || startIndex >= endIndexExclusive) {
    return undefined;
  }

  const rawFrom = Math.max(0, startIndex - OCCURRENCE_CONTEXT_CHARS);
  const rawTo = Math.min(text.length, endIndexExclusive + OCCURRENCE_CONTEXT_CHARS);

  const before = text.slice(trimToWordStart(text, rawFrom), startIndex).trimStart();
  const after = text.slice(endIndexExclusive, trimToWordEnd(text, rawTo)).trimEnd();

  if (before.length === 0 && after.length === 0) return undefined;
  return { before, after };
}
