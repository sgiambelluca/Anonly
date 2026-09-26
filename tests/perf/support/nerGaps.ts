import type { NerGapImport, NerGapsReport } from "./nerGapsTypes.js";

export const NER_GAPS_ARMS = ["A", "4", "6", "8"] as const;
export const NER_GAPS_BLOCK_ORDERS: ReadonlyArray<ReadonlyArray<(typeof NER_GAPS_ARMS)[number]>> = [
  ["A", "4", "6", "8"],
  ["8", "6", "4", "A"],
  ["A", "6", "8", "4"],
];
export const NER_GAPS_SEQUENCE = ["R1", "R1", "R2", "R2"] as const;

export interface NerGapsValidation {
  readonly valid: boolean;
  readonly reasons: ReadonlyArray<string>;
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function validateNerGapsImport(
  item: NerGapImport,
  expectedFootprints?: Readonly<Record<string, string>>,
  requireModelLoad = false,
  requireOcrWords = false,
): NerGapsValidation {
  const reasons: string[] = [];
  for (const error of item.errors) reasons.push(`recorded-${error}`);
  if (!item.ok) reasons.push("pipeline-failed");
  if (!item.panel.visible || !finite(item.panel.observedAtMs)) reasons.push("panel-not-observed");
  const marks = item.marks;
  const required = [
    "selection",
    "DOCUMENT_IMPORTED",
    "NER_STARTED",
    "NER_FINISHED",
    "PIPELINE_READY",
  ] as const;
  for (const key of required) if (!finite(marks[key])) reasons.push(`missing-${key}`);
  const orderedMarks = [
    marks.selection,
    marks.DOCUMENT_IMPORTED,
    marks.NER_STARTED,
    marks.NER_FINISHED,
    marks.PIPELINE_READY,
    item.panel.observedAtMs,
  ];
  if (!orderedMarks.every(finite)) {
    reasons.push("incomplete-monotonic-mark-sequence");
  } else {
    let previous: number | null = null;
    for (const value of orderedMarks) {
      if (!finite(value)) continue;
      if (previous !== null && value < previous) reasons.push("monotonic-mark-sequence-inverted");
      previous = value;
    }
  }
  const validateDuration = (
    name: keyof NerGapImport["durationMs"],
    actual: number | null,
    start: number | null,
    end: number | null,
  ): void => {
    if (!finite(actual) || actual < 0 || !finite(start) || !finite(end) || actual !== end - start) {
      reasons.push(`invalid-duration-${name}`);
    }
  };
  validateDuration(
    "selectionToPanelMs",
    item.durationMs.selectionToPanelMs,
    marks.selection,
    item.panel.observedAtMs,
  );
  validateDuration(
    "importedToPanelMs",
    item.durationMs.importedToPanelMs,
    marks.DOCUMENT_IMPORTED,
    item.panel.observedAtMs,
  );
  validateDuration(
    "importedToReadyMs",
    item.durationMs.importedToReadyMs,
    marks.DOCUMENT_IMPORTED,
    marks.PIPELINE_READY,
  );
  validateDuration(
    "readyToPanelMs",
    item.durationMs.readyToPanelMs,
    marks.PIPELINE_READY,
    item.panel.observedAtMs,
  );
  validateDuration("nerMs", item.durationMs.nerMs, marks.NER_STARTED, marks.NER_FINISHED);
  if (
    finite(marks.PIPELINE_READY) &&
    finite(item.panel.observedAtMs) &&
    item.panel.observedAtMs < marks.PIPELINE_READY
  ) {
    reasons.push("panel-mark-inverted");
  }
  if (
    finite(marks.NER_STARTED) &&
    finite(marks.NER_FINISHED) &&
    marks.NER_FINISHED < marks.NER_STARTED
  ) {
    reasons.push("ner-marks-inverted");
  }
  if (
    finite(marks.NER_MODEL_READY) &&
    finite(marks.NER_FINISHED) &&
    marks.NER_FINISHED < marks.NER_MODEL_READY
  ) {
    reasons.push("model-ready-after-ner-finished");
  }
  if (finite(marks["NER_MODEL_LOADING"]) !== finite(marks.NER_MODEL_READY)) {
    reasons.push("incomplete-model-load-marks");
  }
  if (
    finite(marks["NER_MODEL_LOADING"]) &&
    finite(marks.NER_MODEL_READY) &&
    marks["NER_MODEL_READY"] < marks["NER_MODEL_LOADING"]
  ) {
    reasons.push("model-load-marks-inverted");
  }
  const hasModelLoading = finite(marks.NER_MODEL_LOADING);
  const hasModelReady = finite(marks.NER_MODEL_READY);
  if (!hasModelLoading && !hasModelReady) {
    if (item.durationMs.loadMs !== null || item.durationMs.modelReadyToNerFinishedMs !== null) {
      reasons.push("model-reuse-duration-must-be-null");
    }
  } else {
    validateDuration(
      "loadMs",
      item.durationMs.loadMs,
      marks.NER_MODEL_LOADING,
      marks.NER_MODEL_READY,
    );
    validateDuration(
      "modelReadyToNerFinishedMs",
      item.durationMs.modelReadyToNerFinishedMs,
      marks.NER_MODEL_READY,
      marks.NER_FINISHED,
    );
  }
  if (
    finite(marks.NER_STARTED) &&
    finite(marks["NER_MODEL_LOADING"]) &&
    (marks["NER_MODEL_LOADING"] < marks.NER_STARTED ||
      (finite(marks.NER_FINISHED) &&
        finite(marks["NER_MODEL_READY"]) &&
        marks["NER_MODEL_READY"] > marks.NER_FINISHED))
  )
    reasons.push("model-load-outside-ner-interval");
  if (requireModelLoad && item.durationMs.loadMs === null)
    reasons.push("cold-model-load-not-observed");
  if (requireOcrWords && item.ocr.count === 0) reasons.push("preflight-ocr-output-empty");
  if (item.ner.count === 0 || item.grouping.count === 0) reasons.push("empty-quality-output");
  if (item.nerJobCount === 0) reasons.push("no-ner-job-observed");
  if (
    item.pageCount === 0 ||
    item.pageWordCounts.length !== item.pageCount ||
    item.pageCharacterCounts.length !== item.pageCount ||
    [...item.pageWordCounts, ...item.pageCharacterCounts].some(
      (count) => !Number.isFinite(count) || count < 0,
    )
  ) {
    reasons.push("incomplete-page-work-counts");
  }
  if (item.peakNerJobs > 1) reasons.push("concurrent-ner-jobs-over-one");
  if (item.peakNerJobs < 1) reasons.push("no-ner-job-observed");
  if (expectedFootprints !== undefined) {
    const expected = expectedFootprints[item.corpus];
    if (expected === undefined || item.ner.sha256 !== expected)
      reasons.push("ner-footprint-mismatch");
  }
  if (
    item.intervalFromPreviousReadyToSelectionMs !== null &&
    (!Number.isFinite(item.intervalFromPreviousReadyToSelectionMs) ||
      item.intervalFromPreviousReadyToSelectionMs < 0)
  ) {
    reasons.push("invalid-document-interval");
  }
  return { valid: reasons.length === 0, reasons };
}

export interface NerGapsAggregate {
  readonly valid: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly importCount: number;
  readonly byArmCorpusPosition: ReadonlyArray<{
    readonly arm: string;
    readonly corpus: string;
    readonly position: number;
    readonly sampleCount: number;
    readonly medianImportedToReadyMs: number | null;
    readonly rangeImportedToReadyMs: readonly [number, number] | null;
    readonly medianNerMs: number | null;
    readonly medianReadyToPanelMs: number | null;
    readonly medianLoadMs: number | null;
    readonly medianModelReadyToNerFinishedMs: number | null;
    readonly medianWordsPerPage: number | null;
    readonly p95WordsPerPage: number | null;
    readonly rangeWordsPerPage: readonly [number, number] | null;
    readonly medianCharactersPerPage: number | null;
    readonly p95CharactersPerPage: number | null;
    readonly rangeCharactersPerPage: readonly [number, number] | null;
  }>;
}

export function compareNerGapsPreflight(reports: ReadonlyArray<NerGapsReport>): NerGapsValidation {
  const reasons: string[] = [];
  const byArmCorpus = new Map(reports.map((report) => [`${report.arm}:${report.corpus}`, report]));
  for (const corpus of ["P1", "P2"] as const) {
    const control = byArmCorpus.get(`A:${corpus}`);
    if (control === undefined || control.imports.length !== 1) {
      reasons.push(`missing-control-${corpus}`);
      continue;
    }
    const controlImport = control.imports[0];
    if (controlImport === undefined) {
      reasons.push(`empty-control-${corpus}`);
      continue;
    }
    for (const arm of NER_GAPS_ARMS) {
      const candidate = byArmCorpus.get(`${arm}:${corpus}`)?.imports[0];
      if (candidate === undefined) {
        reasons.push(`missing-${arm}-${corpus}`);
        continue;
      }
      for (const key of ["ner", "ocr", "grouping"] as const) {
        if (
          candidate[key].count !== controlImport[key].count ||
          candidate[key].sha256 !== controlImport[key].sha256
        ) {
          reasons.push(`quality-mismatch-${arm}-${corpus}-${key}`);
        }
      }
      const validation = validateNerGapsImport(candidate, undefined, true, corpus === "P2");
      for (const reason of validation.reasons) reasons.push(`${arm}-${corpus}-${reason}`);
    }
  }
  if (reports.length !== 8) reasons.push("preflight-report-count-mismatch");
  return { valid: reasons.length === 0, reasons };
}

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (sorted.length % 2 === 1) return upper ?? null;
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}

function percentile(values: ReadonlyArray<number>, percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function aggregateNerGapsReports(
  reports: ReadonlyArray<NerGapsReport>,
  expectedRunIds: ReadonlyArray<string>,
  expectedFootprints: Readonly<Record<string, string>>,
): NerGapsAggregate {
  const reasons: string[] = [];
  const byRun = new Map(reports.map((report) => [report.runId, report]));
  for (const runId of expectedRunIds) {
    const report = byRun.get(runId);
    if (report === undefined) {
      reasons.push(`missing-report-${runId}`);
      continue;
    }
    if (report.imports.length !== 4) reasons.push(`incomplete-sequence-${runId}`);
    for (const [index, item] of report.imports.entries()) {
      if (item.corpus !== NER_GAPS_SEQUENCE[index])
        reasons.push(`wrong-sequence-${runId}-${index}`);
      const validation = validateNerGapsImport(item, expectedFootprints);
      for (const reason of validation.reasons) reasons.push(`${runId}-${index}-${reason}`);
    }
  }
  if (reports.length !== expectedRunIds.length)
    reasons.push("unexpected-or-duplicate-report-count");

  const rows: NerGapsAggregate["byArmCorpusPosition"][number][] = [];
  const qualityByCorpusPosition = new Map<string, string>();
  for (const report of reports) {
    if (report.phase !== "timing") continue;
    for (const item of report.imports) {
      const key = item.corpus;
      for (const field of ["ner", "ocr", "grouping"] as const) {
        const qualityKey = `${key}:${field}`;
        const fingerprint = `${item[field].count}:${item[field].sha256}`;
        const prior = qualityByCorpusPosition.get(qualityKey);
        if (prior !== undefined && prior !== fingerprint)
          reasons.push(`quality-mismatch-${report.arm}-${qualityKey}`);
        qualityByCorpusPosition.set(qualityKey, fingerprint);
      }
    }
  }
  for (const arm of NER_GAPS_ARMS) {
    for (const corpus of ["R1", "R2"] as const) {
      for (const position of corpus === "R1" ? [0, 1] : [2, 3]) {
        const values = reports.flatMap((report) =>
          report.arm === arm
            ? report.imports.filter((item, index) => item.corpus === corpus && index === position)
            : [],
        );
        const totals = values.map((item) => item.durationMs.importedToReadyMs).filter(finite);
        const sorted = [...totals].sort((a, b) => a - b);
        const pageWords = values.flatMap((item) => item.pageWordCounts);
        const pageCharacters = values.flatMap((item) => item.pageCharacterCounts);
        const sortedWords = [...pageWords].sort((a, b) => a - b);
        const sortedCharacters = [...pageCharacters].sort((a, b) => a - b);
        rows.push({
          arm,
          corpus,
          position,
          sampleCount: values.length,
          medianImportedToReadyMs: median(totals),
          rangeImportedToReadyMs: sorted.length === 0 ? null : [sorted[0] ?? 0, sorted.at(-1) ?? 0],
          medianNerMs: median(values.map((item) => item.durationMs.nerMs).filter(finite)),
          medianReadyToPanelMs: median(
            values.map((item) => item.durationMs.readyToPanelMs).filter(finite),
          ),
          medianLoadMs: median(values.map((item) => item.durationMs.loadMs).filter(finite)),
          medianModelReadyToNerFinishedMs: median(
            values.map((item) => item.durationMs.modelReadyToNerFinishedMs).filter(finite),
          ),
          medianWordsPerPage: median(pageWords),
          p95WordsPerPage: percentile(pageWords, 0.95),
          rangeWordsPerPage:
            sortedWords.length === 0 ? null : [sortedWords[0] ?? 0, sortedWords.at(-1) ?? 0],
          medianCharactersPerPage: median(pageCharacters),
          p95CharactersPerPage: percentile(pageCharacters, 0.95),
          rangeCharactersPerPage:
            sortedCharacters.length === 0
              ? null
              : [sortedCharacters[0] ?? 0, sortedCharacters.at(-1) ?? 0],
        });
        if (values.length !== 3) reasons.push(`sample-count-${arm}-${corpus}-${position}`);
      }
    }
  }
  return {
    valid: reasons.length === 0,
    reasons,
    importCount: reports.reduce((count, report) => count + report.imports.length, 0),
    byArmCorpusPosition: rows,
  };
}

export function expectedNerGapsRunIds(): ReadonlyArray<string> {
  return NER_GAPS_BLOCK_ORDERS.flatMap((order, block) =>
    order.map((arm) => `time-${arm}-b${block + 1}`),
  );
}
