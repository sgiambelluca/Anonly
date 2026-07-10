/**
 * @anonly/regex-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/Regex_Engine.md §6, §9, §10.
 *
 * Nota de nombrado (no bloqueante, ver reporte de PR): el checklist §15 item 2
 * del spec dice literalmente "Definir types.ts", pero Code_Standards.md §4
 * ("Archivo de tipos | kebab-case + `.types.ts` | `pdf.types.ts`") y el
 * precedente real (pdf-engine/src/pdf.types.ts, ocr-engine/src/ocr.types.ts)
 * usan el prefijo del motor. Se sigue el precedente + la tabla de naming.
 */

import type { Document, EntityType } from "@anonly/shared";

export interface RegexPattern {
  readonly id: string; // "dni-ar", "cuit-ar", etc.
  readonly entityType: EntityType;
  readonly pattern: RegExp;
  readonly checksum?: (value: string) => boolean; // validación adicional (CUIT, tarjeta) — recibe normalizedValue.
  readonly normalizer: (value: string) => string; // produce normalizedValue a partir del valor crudo matcheado.
  readonly maskFormat: string; // "XX.XXX.XXX" — referenciado por Render/Export.
}

export interface RegexEngineConfig {
  readonly patterns: ReadonlyArray<RegexPattern>;
  readonly customPatterns: ReadonlyArray<RegexPattern>; // del usuario
}

export interface RegexEngineInput {
  readonly document: Document;
}

export interface RegexEngineOutput {
  readonly documentId: string;
  readonly occurrenceCount: number;
  readonly durationMs: number;
}
