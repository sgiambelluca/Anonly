import { describe, expect, it } from "vitest";

import {
  aggregateNerGapsReports,
  compareNerGapsPreflight,
  expectedNerGapsRunIds,
  NER_GAPS_ARMS,
  validateNerGapsImport,
} from "./nerGaps.js";
import type { NerGapImport, NerGapsArm, NerGapsCorpus, NerGapsReport } from "./nerGapsTypes.js";

function measuredImport(
  corpus: NerGapsCorpus = "R1",
  sequenceIndex = 0,
  overrides: Partial<NerGapImport> = {},
): NerGapImport {
  const loading = sequenceIndex === 0 ? 100 : null;
  const ready = sequenceIndex === 0 ? 120 : null;
  return {
    corpus,
    sequenceIndex,
    ok: true,
    marks: {
      selection: 10,
      DOCUMENT_IMPORTED: 20,
      NER_STARTED: 30,
      NER_MODEL_LOADING: loading,
      NER_MODEL_READY: ready,
      NER_FINISHED: 150,
      PIPELINE_READY: 160,
      PIPELINE_FAILED: null,
    },
    durationMs: {
      selectionToPanelMs: 160,
      importedToPanelMs: 150,
      importedToReadyMs: 140,
      readyToPanelMs: 10,
      nerMs: 120,
      modelReadyToNerFinishedMs: ready === null ? null : 30,
      loadMs: loading === null || ready === null ? null : ready - loading,
    },
    panel: { visible: true, observedAtMs: 170 },
    peakNerJobs: 1,
    ner: { count: 2, sha256: `ner-${corpus}` },
    ocr: { count: 0, sha256: `ocr-${corpus}` },
    grouping: { count: 2, sha256: `groups-${corpus}` },
    pageCount: 2,
    pageWordCounts: [10, 12],
    pageCharacterCounts: [50, 60],
    nerJobCount: 2,
    intervalFromPreviousReadyToSelectionMs: null,
    errors: [],
    ...overrides,
  };
}

function report(
  runId: string,
  arm: NerGapsArm,
  block: number,
  imports = [
    measuredImport("R1", 0),
    measuredImport("R1", 1, {
      marks: { ...measuredImport("R1", 1).marks, NER_MODEL_LOADING: null, NER_MODEL_READY: null },
      durationMs: {
        ...measuredImport("R1", 1).durationMs,
        loadMs: null,
        modelReadyToNerFinishedMs: null,
      },
    }),
    measuredImport("R2", 2),
    measuredImport("R2", 3, {
      marks: { ...measuredImport("R2", 3).marks, NER_MODEL_LOADING: null, NER_MODEL_READY: null },
      durationMs: {
        ...measuredImport("R2", 3).durationMs,
        loadMs: null,
        modelReadyToNerFinishedMs: null,
      },
    }),
  ],
): NerGapsReport {
  return {
    schemaVersion: 1,
    runId,
    phase: "timing",
    arm,
    block,
    corpus: null,
    host: {
      platform: "darwin",
      arch: "arm64",
      cpuCount: 8,
      totalMemBytes: 1000,
      electronVersion: "x",
      nodeVersion: "x",
    },
    product: {
      commit: "x",
      dirty: false,
      sourceSha256: "x",
      buildSha256: "x",
      modelSha256: "x",
      requestedThreads: arm === "A" ? "automatic" : Number(arm),
      observedThreads: null,
    },
    imports,
    completed: imports.length === 4,
    createdAt: "fixed",
  };
}

describe("nerGaps validation", () => {
  it("accepts absent loading and ready marks as a model reuse, but rejects a lone mark", () => {
    const reused = measuredImport("R1", 1, {
      marks: { ...measuredImport("R1", 1).marks, NER_MODEL_LOADING: null, NER_MODEL_READY: null },
      durationMs: {
        ...measuredImport("R1", 1).durationMs,
        loadMs: null,
        modelReadyToNerFinishedMs: null,
      },
    });
    expect(validateNerGapsImport(reused).valid).toBe(true);
    const incomplete = { ...reused, marks: { ...reused.marks, NER_MODEL_READY: 120 } };
    expect(validateNerGapsImport(incomplete).reasons).toContain("incomplete-model-load-marks");
  });

  it("requires observed load marks for a cold preflight and detects inverted monotonic marks", () => {
    const cold = measuredImport("P1");
    expect(validateNerGapsImport(cold, undefined, true).valid).toBe(true);
    expect(validateNerGapsImport(measuredImport("P1", 1), undefined, true).reasons).toContain(
      "cold-model-load-not-observed",
    );
    const inverted = { ...cold, marks: { ...cold.marks, NER_FINISHED: 25 } };
    expect(validateNerGapsImport(inverted).reasons).toContain("ner-marks-inverted");
  });

  it("requires selection, pipeline, NER and panel timestamps in causal order", () => {
    const base = measuredImport("R1");
    const selectionAfterReady = {
      ...base,
      marks: { ...base.marks, selection: 180 },
      panel: { visible: true, observedAtMs: 190 },
    };
    expect(validateNerGapsImport(selectionAfterReady).reasons).toContain(
      "monotonic-mark-sequence-inverted",
    );
    const loadingBeforeNer = {
      ...base,
      marks: { ...base.marks, NER_MODEL_LOADING: 25, NER_MODEL_READY: 35 },
    };
    expect(validateNerGapsImport(loadingBeforeNer).reasons).toContain(
      "model-load-outside-ner-interval",
    );
  });

  it("rejects missing, negative, or mark-inconsistent durations", () => {
    const base = measuredImport("R1", 0);
    const malformed = {
      ...base,
      durationMs: {
        ...base.durationMs,
        selectionToPanelMs: null,
        readyToPanelMs: -123,
        nerMs: null,
      },
    };
    const validation = validateNerGapsImport(malformed);
    expect(validation.valid).toBe(false);
    expect(validation.reasons).toEqual(
      expect.arrayContaining([
        "invalid-duration-selectionToPanelMs",
        "invalid-duration-readyToPanelMs",
        "invalid-duration-nerMs",
      ]),
    );
    const reusedWithFakeLoadDuration = measuredImport("R1", 1, {
      durationMs: { ...measuredImport("R1", 1).durationMs, modelReadyToNerFinishedMs: 1 },
    });
    expect(validateNerGapsImport(reusedWithFakeLoadDuration).reasons).toContain(
      "model-reuse-duration-must-be-null",
    );
  });

  it("fails closed for empty output, panel absence, multiple jobs and footprint mismatch", () => {
    const broken = measuredImport("R1", 0, {
      ner: { count: 0, sha256: "" },
      panel: { visible: false, observedAtMs: null },
      peakNerJobs: 2,
    });
    const result = validateNerGapsImport(broken, { R1: "expected" });
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "empty-quality-output",
        "panel-not-observed",
        "concurrent-ner-jobs-over-one",
        "ner-footprint-mismatch",
      ]),
    );
  });

  it("allows an empty OCR-word set when that is the exact native-PDF output", () => {
    const reports: NerGapsReport[] = [];
    for (const arm of NER_GAPS_ARMS) {
      for (const corpus of ["P1", "P2"] as const) {
        const item = measuredImport(corpus, 0, {
          ner: { count: 1, sha256: `ner-${corpus}` },
          ocr:
            corpus === "P2"
              ? { count: 5, sha256: `ocr-${corpus}` }
              : { count: 0, sha256: `ocr-${corpus}` },
          grouping: { count: 1, sha256: `groups-${corpus}` },
        });
        reports.push({
          ...report(`preflight-${arm}-${corpus}`, arm, 0, [item]),
          phase: "preflight",
          corpus,
          block: null,
        });
      }
    }
    expect(
      reports.every((item) => item.imports[0]?.ocr.count === (item.corpus === "P2" ? 5 : 0)),
    ).toBe(true);
    expect(compareNerGapsPreflight(reports).valid).toBe(true);
    const changed = reports.map((item) =>
      item.runId === "preflight-8-P1"
        ? { ...item, imports: [{ ...item.imports[0]!, ocr: { count: 1, sha256: "unexpected" } }] }
        : item,
    );
    expect(compareNerGapsPreflight(changed).reasons).toContain("quality-mismatch-8-P1-ocr");
  });
});

describe("nerGaps aggregation", () => {
  it("aggregates the full interleaved design and exact repeated corpus fingerprints", () => {
    const ids = expectedNerGapsRunIds();
    const reports = ids.map((id) => {
      const [, armText, blockText] = /^time-([A468])-b([123])$/.exec(id) ?? [];
      const arm = armText as NerGapsArm;
      return report(id, arm, Number(blockText));
    });
    const result = aggregateNerGapsReports(reports, ids, { R1: "ner-R1", R2: "ner-R2" });
    expect(result.valid).toBe(true);
    expect(result.importCount).toBe(48);
    expect(result.byArmCorpusPosition).toHaveLength(16);
    expect(result.byArmCorpusPosition[0]?.sampleCount).toBe(3);
    expect(result.byArmCorpusPosition[0]?.medianWordsPerPage).toBe(11);
    expect(result.byArmCorpusPosition[0]?.p95CharactersPerPage).toBe(60);
  });

  it("fails closed on an incomplete run and a quality difference between positions", () => {
    const ids = expectedNerGapsRunIds();
    const complete = ids.map((id) => {
      const [, armText, blockText] = /^time-([A468])-b([123])$/.exec(id) ?? [];
      return report(id, armText as NerGapsArm, Number(blockText));
    });
    const incomplete = complete.slice(1);
    expect(aggregateNerGapsReports(incomplete, ids, { R1: "ner-R1", R2: "ner-R2" }).valid).toBe(
      false,
    );
    const mismatch = complete.map((item) =>
      item.runId === "time-4-b2"
        ? report(item.runId, "4", 2, [
            measuredImport("R1"),
            measuredImport("R1", 1, { ner: { count: 1, sha256: "different" } }),
            ...item.imports.slice(2),
          ])
        : item,
    );
    expect(
      aggregateNerGapsReports(mismatch, ids, { R1: "ner-R1", R2: "ner-R2" }).reasons,
    ).toContain("quality-mismatch-4-R1:ner");
  });

  it("fails closed when every sample has malformed durations", () => {
    const ids = expectedNerGapsRunIds();
    const malformed = ids.map((id) => {
      const [, armText, blockText] = /^time-([A468])-b([123])$/.exec(id) ?? [];
      const base = report(id, armText as NerGapsArm, Number(blockText));
      return {
        ...base,
        imports: base.imports.map((item) => ({
          ...item,
          durationMs: { ...item.durationMs, readyToPanelMs: -123, nerMs: null },
        })),
      };
    });
    const aggregate = aggregateNerGapsReports(malformed, ids, { R1: "ner-R1", R2: "ner-R2" });
    expect(aggregate.valid).toBe(false);
    expect(aggregate.reasons).toContain("time-A-b1-0-invalid-duration-readyToPanelMs");
    expect(aggregate.reasons).toContain("time-A-b1-0-invalid-duration-nerMs");
  });
});
