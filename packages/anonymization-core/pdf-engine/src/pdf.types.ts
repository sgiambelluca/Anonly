import type { Document, DocumentSourceKind } from "@anonly/shared";

export interface PdfEngineInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  readonly password?: string;
}

export interface PdfEngineOutput {
  readonly document: Document;
  readonly pageCount: number;
  readonly textlessPages: ReadonlyArray<number>;
  readonly sourceKind: DocumentSourceKind;
}
