/**
 * @anonly/render-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/Render_Engine.md §6, §9, §10 (v1.1.1, ADR-030).
 *
 * Nota de nombrado (mismo precedente que pdf-engine/src/pdf.types.ts,
 * ocr-engine/src/ocr.types.ts, ner-engine/src/ner.types.ts,
 * grouping-engine/src/grouping.types.ts): se sigue Code_Standards.md §4
 * (prefijo del motor) en vez del nombre literal "types.ts" del checklist §15
 * item 2.
 *
 * `RenderConfig` NO se redefine acá: es el tipo canónico de @anonly/shared
 * (Contracts.md §6, ADR-027 — el alias "RenderEngineConfig" que aparecía en
 * el texto de Render_Engine.md §6/§15.2 fue eliminado por ADR-027 y nunca
 * existió en código). Se re-exporta desde index.ts para conveniencia del
 * caller, igual que grouping-engine hace con GroupingConfig.
 */

import type { Annotation, Replacement } from "@anonly/shared";

export interface RenderPageInput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly replacements?: ReadonlyArray<Replacement>;
  readonly annotations?: ReadonlyArray<Annotation>;
  readonly scale?: number;
  readonly imageFormat?: "png" | "jpeg";
}

export interface RenderPageOutput {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly imageData: ImageData;
  readonly durationMs: number;
}
