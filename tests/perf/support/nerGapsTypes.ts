export type NerGapsArm = "A" | "4" | "6" | "8";
export type NerGapsCorpus = "P1" | "P2" | "R1" | "R2";

export interface NerGapMarkSet {
  readonly selection: number | null;
  readonly DOCUMENT_IMPORTED: number | null;
  readonly NER_STARTED: number | null;
  readonly NER_MODEL_LOADING: number | null;
  readonly NER_MODEL_READY: number | null;
  readonly NER_FINISHED: number | null;
  readonly PIPELINE_READY: number | null;
  readonly PIPELINE_FAILED: number | null;
}

export interface NerGapQuality {
  readonly count: number;
  readonly sha256: string;
}

export interface NerGapImport {
  readonly corpus: NerGapsCorpus;
  readonly sequenceIndex: number;
  readonly ok: boolean;
  readonly marks: NerGapMarkSet;
  readonly durationMs: {
    readonly selectionToPanelMs: number | null;
    readonly importedToPanelMs: number | null;
    readonly importedToReadyMs: number | null;
    readonly readyToPanelMs: number | null;
    readonly nerMs: number | null;
    readonly modelReadyToNerFinishedMs: number | null;
    readonly loadMs: number | null;
  };
  readonly panel: { readonly visible: boolean; readonly observedAtMs: number | null };
  readonly peakNerJobs: number;
  readonly ner: NerGapQuality;
  readonly ocr: NerGapQuality;
  readonly grouping: NerGapQuality;
  readonly pageCount: number;
  readonly pageWordCounts: ReadonlyArray<number>;
  readonly pageCharacterCounts: ReadonlyArray<number>;
  readonly nerJobCount: number;
  readonly intervalFromPreviousReadyToSelectionMs: number | null;
  readonly errors: ReadonlyArray<string>;
}

export interface NerGapsReport {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly phase: "preflight" | "timing";
  readonly arm: NerGapsArm;
  readonly block: number | null;
  readonly corpus: NerGapsCorpus | null;
  readonly host: {
    readonly platform: string;
    readonly arch: string;
    readonly cpuCount: number;
    readonly totalMemBytes: number;
    readonly electronVersion: string;
    readonly nodeVersion: string;
  };
  readonly product: {
    readonly commit: string;
    readonly dirty: boolean;
    readonly sourceSha256: string;
    readonly buildSha256: string;
    readonly modelSha256: string;
    readonly requestedThreads: number | "automatic";
    readonly observedThreads: number | null;
  };
  readonly imports: ReadonlyArray<NerGapImport>;
  readonly completed: boolean;
  readonly createdAt: string;
}
