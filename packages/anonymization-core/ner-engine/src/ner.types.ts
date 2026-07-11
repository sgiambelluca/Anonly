/**
 * @anonly/ner-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/NER_Engine.md §6, §9, §10.
 *
 * Nota de nombrado (no bloqueante, mismo precedente que regex-engine/src/regex.types.ts
 * y ocr-engine/src/ocr.types.ts): el checklist §15.2 del spec dice literalmente
 * "Definir types.ts", pero Code_Standards.md §4 ("Archivo de tipos | kebab-case +
 * `.types.ts` | `pdf.types.ts`") y el precedente real usan el prefijo del motor.
 * Se sigue el precedente + la tabla de naming.
 *
 * `NerConfig` NO se redefine acá: es el tipo canónico de @anonly/shared
 * (Contracts.md §6, ADR-023 — el alias "NerEngineConfig" que aparecía en el
 * texto de NER_Engine.md §6/§15.2 fue eliminado por ADR-023 §1 y nunca existió
 * en código). Se re-exporta desde index.ts para conveniencia del caller, igual
 * que ocr-engine hace con OcrConfig.
 */

import type { Occurrence, Word } from "@anonly/shared";

export interface NerPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  /** Page.text normalizado. */
  readonly text: string;
  /** Page.words, para mapear bbox. Debe estar ordenado por bbox.y asc, luego bbox.x asc. */
  readonly words: ReadonlyArray<Word>;
}

export interface NerPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly occurrences: ReadonlyArray<Occurrence>;
  readonly durationMs: number;
}
