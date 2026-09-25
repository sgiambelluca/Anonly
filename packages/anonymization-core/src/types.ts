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
  EditPreview,
  EditPreviewRequest,
  IEventBus,
  ManualEntityRequest,
  PipelineState,
  ReanalyzeConfigPatch,
  TextMatch,
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

// ADR-061 §6 (errata): lo único que el caller no puede deducir por su
// cuenta. Objeto y no `number` pelado para poder crecer sin romper firmas.
// Vive acá y no en `shared` porque ningún motor lo produce ni lo consume: es
// el retorno de un método de `IPipelineOrchestrator` (errata de §6, punto 5).
export interface ManualEntityResult {
  readonly occurrenceCount: number; // apariciones del valor en el documento; 0 = no está
  // ADR-174 §2: conflictos sin resolver con `heldManual` que dejó este
  // agregado (la ocurrencia manual perdió una superposición y quedó
  // retenida). [] = ninguno. occurrenceCount > 0 con heldConflictIds no
  // vacío NO es un agregado exitoso.
  // ADR-175 §3: se identifican por el normalizedValue de las ocurrencias
  // Manual que emitió ESTE agregado, comparado con
  // normalizeEntityValue(candidate.value) — nunca por igualdad exacta de
  // texto (la puntuación pegada del documento, ADR-115).
  readonly heldConflictIds: ReadonlyArray<string>;
  // ADR-175 §3: grupos en los que quedaron las ocurrencias de este agregado,
  // incluidos los que ya existían (mismo criterio de normalizedValue contra
  // normalizeEntityValue(member.value)). [] = ninguno.
  // Invariante: occurrenceCount > 0 => heldConflictIds o groupIds no vacío.
  readonly groupIds: ReadonlyArray<string>;
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
   * Valor ausente del documento -> no crea grupo, sin error: devuelve
   * occurrenceCount 0. Es el único modo en que el caller lo distingue de un
   * agregado exitoso (ADR-061 §6 errata) -- 0 NO lanza.
   * Precondición: stage in {Ready, Failed} (si no, InvalidInputError).
   */
  addManualEntity(documentId: string, request: ManualEntityRequest): Promise<ManualEntityResult>;
  /**
   * ADR-061 §8 (errata): misma búsqueda literal de `addManualEntity`, salida
   * de solo lectura para el buscador del visor. Delega en
   * `RegexEngine.searchText` — sincrónico, sin tocar la sesión de Grouping ni
   * emitir nada: buscar no es agregar.
   */
  findText(documentId: string, query: string): ReadonlyArray<TextMatch>;
  /**
   * ADR-170 §2: delegación pura en `GroupingEngine.previewEdit`, sin estado
   * propio, sin emitir y sin pasar por `reopenSession`. Sincrónico, como
   * `findText`. `documentId` sin sesión de grouping -> `InvalidInputError`
   * (lo lanza el motor).
   */
  previewEdit(documentId: string, request: EditPreviewRequest): EditPreview;
  /**
   * ADR-172 §1: puntos de restauración del ESTADO DE EDICIÓN del documento
   * (sesión de Grouping completa + literales manuales retenidos, ADR-061
   * §5). `createEditCheckpoint` es sincrónico y devuelve un id opaco, hasta
   * `MAX_EDIT_CHECKPOINTS` (se descarta el más viejo). `restoreEditCheckpoint`
   * reemplaza el estado y emite la diferencia con los eventos de Grouping de
   * siempre (vía `GroupingEngine.restoreCheckpoint`); id desconocido o
   * descartado -> `InvalidInputError`. `reanalyze`, `closeDocument` y
   * `dispose` los descartan todos. Precondición de create/restore: sesión
   * existente y `stage` fuera de
   * `{Importing, Extracting, OCRing, Detecting, Grouping}`; si no,
   * `InvalidInputError`.
   */
  createEditCheckpoint(documentId: string): string;
  restoreEditCheckpoint(documentId: string, checkpointId: string): Promise<void>;
  discardEditCheckpoints(documentId: string): void;
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
