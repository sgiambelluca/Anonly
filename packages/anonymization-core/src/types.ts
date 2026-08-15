/**
 * Tipos públicos del façade (Contracts.md §3.5, Orchestrator.md §6).
 *
 * `IAnonymizationCore`/`IPipelineOrchestrator`/`ImportDocumentInput` se
 * comparten con la UI (ADR-034 §7): la UI los importa desde
 * `@anonly/anonymization-core` (`ui/React_Client.md` §4).
 */

import type { ExportEngine } from "@anonly/export-engine";
import type { GroupingEngine } from "@anonly/grouping-engine";
import type { NerEngine } from "@anonly/ner-engine";
import type { OcrEngine } from "@anonly/ocr-engine";
import type { PdfEngine } from "@anonly/pdf-engine";
import type { RegexEngine } from "@anonly/regex-engine";
import type { RenderEngine } from "@anonly/render-engine";
import type {
  IEventBus,
  ManualEntityRequest,
  PipelineState,
  ReanalyzeConfigPatch,
  Word,
} from "@anonly/shared";

export interface AnonymizationCoreEngines {
  readonly pdf: PdfEngine;
  readonly ocr: OcrEngine;
  readonly regex: RegexEngine;
  readonly ner: NerEngine;
  readonly grouping: GroupingEngine;
  readonly render: RenderEngine;
  readonly export: ExportEngine;
}

export interface IAnonymizationCore {
  readonly bus: IEventBus;
  readonly engines: AnonymizationCoreEngines;
  readonly orchestrator: IPipelineOrchestrator;
  dispose(): Promise<void>;
}

export interface ImportDocumentInput {
  readonly documentId: string; // UUID v4 generado por el caller
  readonly name: string;
  readonly buffer: ArrayBuffer; // PDF binario
  readonly password?: string;
}

export interface IPipelineOrchestrator {
  /** Dispara etapas 0..7 (hasta Ready). Resuelve en Ready, Failed o Cancelled. */
  importDocument(input: ImportDocumentInput): Promise<void>;
  retryWithPassword(documentId: string, password: string): Promise<void>;
  /**
   * Re-análisis parcial preservando ediciones (ADR-038 §1, Orchestrator.md
   * §6/§13.18-§13.22): re-corre Regex/NER y/o re-OCR sobre un documento ya
   * cargado sin perder grupos/reglas/conflictos editados por el usuario.
   * Precondición: `stage ∈ {Ready, Failed}` (si no, `InvalidInputError`).
   */
  reanalyze(documentId: string, patch: ReanalyzeConfigPatch): Promise<void>;
  /**
   * ADR-061 §6: agrega a mano una entidad que el detector no encontró.
   * Orquesta reopenSession -> regex.findLiteral -> ENTITY_FOUND (source: Manual)
   * -> finishSession. Idempotente por el dedup de identidad de ADR-038 §3.
   * Valor ausente del documento -> no crea grupo, sin error.
   * Precondición: stage in {Ready, Failed} (si no, InvalidInputError).
   */
  addManualEntity(documentId: string, request: ManualEntityRequest): Promise<void>;
  // NOTA (ADR-061 §8, Contracts.md §3.5): `findText(documentId, query):
  // ReadonlyArray<TextMatch>` queda deliberadamente fuera de esta interfaz
  // en este PR. Es una ambigüedad reportada, no una omisión — ver el reporte
  // final del PR: `RegexEngine.findLiteral` (el único método del motor que
  // hace este matcheo) requiere un `entityType` que `findText` no tiene, y
  // solo expone su resultado emitiendo `ENTITY_FOUND` sobre `ctx.bus` — un
  // bus real haría que una simple búsqueda mute la sesión de Grouping en
  // vivo (crea/fusiona grupos por buscar texto). No hay forma de construir
  // `TextMatch[]` sin reimplementar el matcheo de `regex-engine` o
  // recurrir a una captura por evento no especificada en ningún doc.
  /** ADR-061 §4: habilitan el hit-test de selección sobre el canvas del original. */
  getPageWords(documentId: string, pageIndex: number): ReadonlyArray<Word>;
  getPageSize(
    documentId: string,
    pageIndex: number,
  ): { readonly width: number; readonly height: number };
  cancel(documentId: string, jobId?: string): Promise<void>;
  closeDocument(documentId: string): Promise<void>;
  getState(documentId: string): PipelineState;
  dispose(): Promise<void>;
}
