/**
 * @anonly/shared — Modelos de datos del Core.
 *
 * Fuente de verdad semántica: docs/architecture/03_Data_Model.md.
 * Fuente de verdad de tipos: docs/core/Contracts.md §5.
 *
 * Todos los tipos son inmutables: `readonly` en props, `ReadonlyArray<T>` en colecciones.
 * Ver ADR-008-Immutability.md.
 */

import type {
  AnnotationKind,
  ConflictReason,
  DetectionSource,
  EntityType,
  PipelineStage,
  ReplacementMode,
  RuleScope,
  WorkerJobType,
} from "./enums.js";

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WordSpan {
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

export interface Word {
  readonly text: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  readonly confidence: number;
  readonly source: "pdf" | "ocr";
}

export interface Page {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly words: ReadonlyArray<Word>;
  readonly text: string;
  readonly requiresOCR: boolean;
  readonly ocrCompleted: boolean;
  readonly dpi?: number;
}

export interface DocumentMetadata {
  readonly title?: string;
  readonly producer?: string;
  readonly creationTool?: string;
  readonly pdfVersion: string;
  readonly encrypted: boolean;
  readonly hasForms: boolean;
}

export type DocumentSourceKind = "text" | "scanned" | "mixed";

export interface Document {
  readonly id: string;
  readonly name: string;
  readonly pageCount: number;
  readonly pages: ReadonlyArray<Page>;
  readonly metadata: DocumentMetadata;
  readonly sourceKind: DocumentSourceKind;
  readonly importedAt: number;
}

export interface Occurrence {
  readonly id: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly bbox: BoundingBox;
  readonly pageIndex: number;
  readonly source: DetectionSource;
  readonly confidence: number;
  readonly entityType: EntityType;
  /** Formato de máscara del patrón que matcheó (Regex lo copia de `RegexPattern.maskFormat`; ausente en NER). ADR-029. */
  readonly maskFormat?: string;
  readonly wordSpan?: WordSpan;
}

export interface OccurrenceRef {
  readonly occurrenceId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly source: DetectionSource;
}

export interface EntityGroup {
  readonly id: string;
  readonly type: EntityType;
  readonly canonicalValue: string;
  readonly members: ReadonlyArray<OccurrenceRef>;
  readonly replacementMode: ReplacementMode;
  readonly replacementValue: string;
  readonly indexInType: number;
  readonly enabled: boolean;
  readonly aliases: ReadonlyArray<string>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Replacement {
  readonly groupId: string;
  readonly occurrenceId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly originalValue: string;
  readonly replacementValue: string;
  readonly mode: ReplacementMode;
}

export interface RuleTarget {
  readonly kind: RuleScope;
  readonly groupId?: string;
  readonly entityType?: EntityType;
}

export interface Rule {
  readonly id: string;
  readonly scope: RuleScope;
  readonly target: RuleTarget;
  readonly mode: ReplacementMode;
  readonly priority: number;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Annotation {
  readonly id: string;
  readonly groupId: string;
  readonly pageIndex: number;
  readonly bbox: BoundingBox;
  readonly kind: AnnotationKind;
}

export interface ConflictCandidate {
  readonly source: DetectionSource;
  readonly entityType: EntityType;
  readonly confidence: number;
  readonly value: string;
}

export interface Conflict {
  readonly id: string;
  readonly groupId: string;
  readonly reason: ConflictReason;
  readonly candidates: ReadonlyArray<ConflictCandidate>;
  readonly resolved: boolean;
  readonly resolvedMode?: ReplacementMode;
}

export interface PipelineError {
  readonly stage: PipelineStage;
  readonly code: string;
  readonly message: string;
  readonly documentId: string;
}

export interface PipelineState {
  readonly documentId: string;
  readonly stage: PipelineStage;
  readonly progress: number;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly errors: ReadonlyArray<PipelineError>;
  readonly cancelRequested: boolean;
}

export interface WorkerJob {
  readonly id: string;
  readonly type: WorkerJobType;
  readonly payload: WorkerJobPayload;
  readonly priority: number;
  readonly signalId: string;
  readonly createdAt: number;
  readonly retries: number;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

export type WorkerJobPayload =
  | PdfParsePayload
  | OcrPagePayload
  | NerPagePayload
  | RenderPagePayload
  | ExportPagePayload;

export interface PdfParsePayload {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  readonly password?: string;
  readonly pageRange?: ReadonlyArray<number>;
}

export interface OcrPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly imageData: ArrayBuffer;
  readonly dpi: number;
  readonly languages: ReadonlyArray<string>;
}

export interface NerPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly text: string;
  readonly modelId: string;
}

export interface RenderPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly replacements?: ReadonlyArray<Replacement>;
  readonly annotations?: ReadonlyArray<Annotation>;
  readonly scale?: number;
  readonly imageFormat?: "png" | "jpeg";
}

export interface ExportPagePayload {
  readonly documentId: string;
  readonly pageIndex: number;
  readonly pageImage: ArrayBuffer;
  readonly metadata: ExportMetadata;
}

export interface ExportOptions {
  readonly imageFormat: "png" | "jpeg";
  readonly jpegQuality: number;
  readonly dpi: number;
  readonly includeOriginalMetadata: false;
  readonly title?: string;
  readonly filename: string;
}

export interface ExportMetadata {
  readonly producer: "Anonly";
  readonly creator: "Anonly";
  readonly creationDate: Date;
  readonly title?: string;
}

export interface WorkerCapabilities {
  readonly maxPageBatchSize: number;
  readonly languages?: ReadonlyArray<string>;
  readonly modelVersion?: string;
}

/**
 * Imagen de página codificada (PNG/JPEG), lista para `embedPng`/`embedJpg` de
 * pdf-lib. Definida originalmente en `export-engine` (ADR-032 §1) y promovida
 * a `@anonly/shared` al aparecer el segundo consumidor: Render la produce
 * (`RenderPageOutput.encoded`), Export la consume
 * (`RenderPageProvider.renderFull`), el Orchestrator la transporta
 * (ADR-034 §3). Fuente de verdad: Contracts.md §7.
 */
export interface EncodedPageImage {
  readonly bytes: ArrayBuffer; // imagen codificada (PNG o JPEG)
  readonly format: "png" | "jpeg";
  readonly widthPx: number;
  readonly heightPx: number;
}
