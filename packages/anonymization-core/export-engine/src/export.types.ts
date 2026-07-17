/**
 * @anonly/export-engine — Tipos propios del motor.
 *
 * Fuente de verdad: docs/core/Export_Engine.md §6, §9, §10 (v1.1.0, ADR-032).
 *
 * Nota de nombrado (mismo precedente que render-engine/src/render.types.ts,
 * grouping-engine/src/grouping.types.ts, etc.): se sigue Code_Standards.md §4
 * (prefijo del motor) en vez del nombre literal "types.ts" del checklist §15
 * item 2.
 *
 * `ExportConfig` NO se redefine acá: es el tipo canónico de @anonly/shared
 * (Contracts.md §6, ADR-027). `ExportOptions`/`ExportMetadata` tampoco: viven
 * en @anonly/shared (03_Data_Model.md §19, ADR-032 §4). Se re-exportan desde
 * index.ts para conveniencia del caller.
 *
 * `EncodedPageImage`/`RenderPageProvider` sí se definen acá (ADR-032 §1): el
 * contrato del provider lo consume Export y lo implementa el Orchestrator, que
 * ya importa motores — no corresponden a @anonly/shared (superficie global)
 * mientras Export sea su único consumidor.
 */

import type { Document, EntityGroup, ExportOptions, Replacement, Rule } from "@anonly/shared";

export interface EncodedPageImage {
  readonly bytes: ArrayBuffer; // imagen codificada (PNG o JPEG), lista para embedPng/embedJpg
  readonly format: "png" | "jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RenderPageProvider {
  renderFull(
    pageIndex: number,
    replacements: ReadonlyArray<Replacement>,
    abortSignal: AbortSignal,
  ): Promise<EncodedPageImage>;
}

export interface ExportEngineInput {
  readonly documentId: string;
  readonly document: Document; // para dimensiones de página
  readonly groups: ReadonlyArray<EntityGroup>; // solo los enabled se procesan (§9)
  readonly rules: ReadonlyArray<Rule>;
  readonly options: ExportOptions;
  readonly renderPageProvider: RenderPageProvider;
}

export interface ExportEngineOutput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer; // PDF final, transferido
  readonly sizeBytes: number;
  readonly durationMs: number;
}
