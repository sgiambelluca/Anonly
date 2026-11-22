/**
 * @anonly/regex-engine — El camino de un match de un formato del generador.
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §6, «Formatos del generador».
 * Es el único recorrido de los formatos del generador: `process` y
 * `testFormat` lo usan los dos, así que dan los mismos tramos (caso 49).
 */

import { passesRunGuard } from "../run-guard.js";

import {
  scanFormat,
  type CompiledFormat,
  type FormatSpan,
  type ScanStats,
} from "./format-automaton.js";

/**
 * Recorre `text` con el autómata y aplica lo que es común a todo match: el
 * recorte del espacio de borde (caso 29) y la guarda de corrida de ADR-075 §2.
 * Devuelve índices sobre `text`, `end` exclusivo.
 */
export function detectFormatSpans(
  format: CompiledFormat,
  text: string,
  stats?: ScanStats,
): FormatSpan[] {
  const detected: FormatSpan[] = [];
  for (const span of scanFormat(format, text, stats)) {
    const raw = text.slice(span.start, span.end);
    const value = raw.trim();
    if (value.length === 0) continue;
    const start = span.start + (raw.length - raw.trimStart().length);
    const end = start + value.length;
    if (!passesRunGuard(text, start, end, value)) continue;
    detected.push({ start, end });
  }
  return detected;
}
