import type { Document, OcrRegion } from "@anonly/shared";

export interface PdfEngineInput {
  readonly documentId: string;
  readonly buffer: ArrayBuffer;
  readonly password?: string;
}

export interface PdfEngineOutput {
  readonly document: Document;
  readonly pageCount: number;
  readonly textlessPages: ReadonlyArray<number>;
  readonly sourceKind: "text" | "scanned" | "mixed";
  // ADR-065 §4: regiones a OCR-ear en páginas que SÍ tienen texto nativo.
  // Disjunto de textlessPages (ningún pageIndex aparece en los dos), máximo
  // una entrada por página (ADR-065 §2). Vacío es el caso normal.
  readonly ocrRegions: ReadonlyArray<OcrRegion>;
}
