import { describe, expect, it } from "vitest";

import type { RunReport } from "./memoryProfile.js";
import {
  checkV1,
  importIssues,
  spread,
  summarizeV1,
  V1_PAGES,
  v1Key,
  v1Plan,
  type V1Id,
  type V1Import,
  type V1Run,
} from "./validateSampleCampaign.js";
import { invalidV1BatchSeals } from "./validateSampleIdentity.js";

function report(): RunReport {
  return {
    temperature: "cold",
    baselineBytes: 100,
    peakSumBytes: 300,
    postReadyPeakBytes: 400,
    m1Bytes: null,
    phases: { DOCUMENT_IMPORTED: 0, PIPELINE_READY: 10 },
    workerPeakByType: {},
    startedAtMs: 100,
    readyAtMs: 20,
    totalMs: 10,
    readyDurationMs: 10,
    ocrDurationMs: 8,
    groupCount: 1,
    entityCount: 2,
    ok: true,
    phaseSegments: [],
    samples: [{ atMs: 10, sumWorkingSetSizeBytes: 300, perProcess: [] }],
    workerEvents: [],
    peakPosition: "within-phases",
    hotBaselineSettled: null,
    heapSamples: [],
    systemPressureAtStart: { available: false, reason: "test" },
    systemPressureAtEnd: { available: false, reason: "test" },
    ocrWords: [],
  };
}
function imported(pages: number): V1Import {
  const indices = Array.from({ length: pages }, (_, index) => index);
  return {
    report: report(),
    snapshot: {
      parsedPageIndices: indices,
      requiresOcrPageIndices: indices,
      completedOcrPageIndices: indices,
      unreadableInkPageIndices: [],
      failedOcrPageIndices: [],
      pipelineFailed: false,
      conflictCount: 0,
      pageCount: pages,
      words: 30,
    },
  };
}
function run(id: V1Id): V1Run {
  const pages = V1_PAGES[id.doc];
  return {
    schema: 1,
    ...id,
    capturedAtUtc: "2026-10-10T00:00:00Z",
    batchId: "batch",
    fixtureSha256: id.doc,
    fixtureBytes: 50,
    sourcePages: pages,
    original: imported(pages),
    reimport: imported(pages),
    exported: {
      durationMs: 4,
      wallDurationMs: 5,
      sizeBytes: 100,
      sha256: "export",
      pages,
      imageFormat: "jpeg",
      jpegQuality: 0.92,
      dpi: 150,
      includeMarkerLegend: false,
      coveredPages: [],
      noGroupsConfirmationShown: false,
      unreadableConfirmationShown: false,
    },
    conflictPreparation: {
      status: "not-needed",
      durationMs: 0,
      pendingBefore: 0,
      pendingAfter: 0,
      resolvedCount: 0,
      heldManualCount: 0,
      defaultInconsistentCount: 0,
      groupCount: 0,
      groupInvariantsPreserved: true,
      conflictInvariantsPreserved: true,
      exportEnabled: true,
    },
    failedAt: null,
    failureKind: null,
    errorName: null,
    issues: [],
  };
}

describe("M-V1 campaign integrity", () => {
  it("keeps all 36 cells, real20/51 separate from the synthetic10/50 matrix", () => {
    const ids = v1Plan();
    expect(ids).toHaveLength(36);
    expect(new Set(ids.map(v1Key)).size).toBe(36);
    expect(ids.filter((id) => id.doc === "R1")).toHaveLength(6);
    expect(V1_PAGES.R1).toBe(20);
    expect(V1_PAGES.R4).toBe(51);
    expect(
      checkV1(ids.map(run), ["R1", "R4", "digital10", "digital50", "scan10", "scan50"]).complete,
    ).toBe(true);
  });
  it("requires each expected repetition and rejects duplicates and unexpected cells", () => {
    const ids = v1Plan(["R1"]);
    const rows = ids.map(run);
    expect(checkV1(rows.slice(1), ["R1"]).missing).toEqual([v1Key(ids[0]!)]);
    expect(checkV1([...rows, rows[0]!], ["R1"]).duplicates).toEqual([v1Key(ids[0]!)]);
    expect(
      checkV1([...rows, run({ doc: "R4", preset: "low", repetition: 1 })], ["R1"]).issues,
    ).toContain("R4-low-r1: unexpected");
  });
  it("does not combine source identities across presets/repetitions", () => {
    const rows = v1Plan(["R1"]).map(run);
    rows[1] = { ...rows[1]!, fixtureSha256: "different" };
    expect(checkV1(rows, ["R1"]).complete).toBe(false);
    expect(checkV1(rows, ["R1"]).issues.some((issue) => issue.includes("fixture-identity"))).toBe(
      true,
    );
  });
  it("excludes every row affected by a suspended batch from aggregates", () => {
    const rows = v1Plan(["R1"]).map(run);
    const summary = summarizeV1(rows, ["R1"], ["batch"]);
    expect(summary.check.complete).toBe(false);
    expect(summary.check.invalidRuns).toHaveLength(6);
    expect(
      summary.cells.every((cell) => cell.successfulRuns === 0 && cell.originalM2Bytes.count === 0),
    ).toBe(true);
  });
  it("retains observed outcomes but excludes uncertain detection batches from costs and campaign completion", () => {
    const rows = v1Plan(["R1"]).map(run);
    const invalid = invalidV1BatchSeals(["batch"], {
      batch: {
        schema: 1,
        batchId: "batch",
        state: "finished",
        detectionConfirmedAtStart: true,
        detectionConfirmedAtEnd: false,
        sleepWakeEventObserved: false,
        invalidReason: null,
      },
    });
    const summary = summarizeV1(rows, ["R1"], invalid);
    expect(summary.check.recordedRuns).toBe(6);
    expect(summary.check.complete).toBe(false);
    expect(summary.check.invalidRuns).toHaveLength(6);
    expect(
      summary.cells.every(
        (cell) =>
          cell.successfulRuns === 0 &&
          cell.originalM2Bytes.count === 0 &&
          cell.reimportReadyMs.count === 0,
      ),
    ).toBe(true);
  });
  it("keeps a failed export as an explicit outcome, without fabricating reimport metrics", () => {
    const rows = v1Plan(["R1"]).map(run);
    rows[0] = {
      ...rows[0]!,
      exported: null,
      reimport: null,
      failedAt: "export",
      failureKind: "product",
      errorName: "Error",
    };
    const summary = summarizeV1(rows, ["R1"]);
    expect(summary.check.failedRuns).toEqual([
      { id: "R1-low-r1", stage: "export", kind: "product", errorName: "Error" },
    ]);
    expect(summary.check.complete).toBe(true);
    expect(summary.cells[0]?.reimportReadyMs.count).toBe(2);
  });
  it("rejects missing stage records declared successful", () => {
    const rows = v1Plan(["R1"]).map(run);
    rows[0] = { ...rows[0]!, reimport: null };
    expect(checkV1(rows, ["R1"]).issues).toContain("R1-low-r1: incomplete-success-record");
  });
  it("requires all export pages to take OCR and complete it", () => {
    const value = imported(10);
    const missing = { ...value, snapshot: { ...value.snapshot, completedOcrPageIndices: [0] } };
    expect(importIssues(missing, 10, true)).toContain("ocr-page-coverage-incomplete");
    expect(importIssues(missing, 10, false)).toContain("ocr-page-coverage-incomplete");
    expect(
      importIssues(
        {
          ...value,
          snapshot: { ...value.snapshot, requiresOcrPageIndices: [], completedOcrPageIndices: [] },
        },
        10,
        false,
      ),
    ).toEqual([]);
    const wrongIndices = {
      ...value,
      snapshot: {
        ...value.snapshot,
        completedOcrPageIndices: Array.from({ length: 10 }, (_, index) => index + 10),
      },
    };
    expect(importIssues(wrongIndices, 10, true)).toContain("ocr-page-coverage-incomplete");
  });
  it("reports absent memory/readiness, page failures and content capture as errors", () => {
    const value = imported(10);
    const broken: V1Import = {
      report: {
        ...value.report,
        ok: false,
        readyDurationMs: null,
        peakSumBytes: null,
        samples: [],
        ocrWords: [{ pageIndex: 0, words: [] }],
      },
      snapshot: {
        ...value.snapshot,
        pageCount: 9,
        failedOcrPageIndices: [1],
        pipelineFailed: true,
      },
    };
    expect(importIssues(broken, 10, true)).toEqual(["M2-missing", "privacy-ocr-words-captured"]);
    const successfulButIncomplete = {
      ...broken,
      report: { ...broken.report, ok: true, ocrWords: [] },
      snapshot: { ...broken.snapshot, pipelineFailed: false, failedOcrPageIndices: [] },
    };
    expect(importIssues(successfulButIncomplete, 10, true)).toEqual([
      "ready-timing-missing",
      "M2-missing",
      "page-count-mismatch",
    ]);
  });
  it("retains valid zero durations and has no silent zero for absent samples", () => {
    expect(spread([null, undefined, NaN, Infinity])).toEqual({
      count: 0,
      values: [],
      min: null,
      median: null,
      max: null,
    });
    expect(spread([8, 0, 4, null]).median).toBe(4);
    expect(spread([8, 0]).median).toBe(4);
    expect(spread([0]).median).toBe(0);
  });
  it("never counts an observed failed import as successful verification", () => {
    const rows = v1Plan(["R1"]).map(run);
    const original = rows[0]!.original!;
    rows[0] = { ...rows[0]!, original: { ...original, report: { ...original.report, ok: false } } };
    const summary = summarizeV1(rows, ["R1"]);
    expect(summary.check.complete).toBe(false);
    expect(summary.check.issues).toContain("R1-low-r1: original-failure-declared-successful");
    expect(summary.cells[0]?.successfulRuns).toBe(2);
    rows[0] = { ...rows[0]!, failedAt: "original" };
    expect(checkV1(rows, ["R1"]).issues).toContain("R1-low-r1: failure-classification-mismatch");
  });
  it("requires observed stage records before accepting product failures", () => {
    const rows = v1Plan(["R1"]).map(run);
    rows[0] = {
      ...rows[0]!,
      original: null,
      exported: null,
      conflictPreparation: null,
      reimport: null,
      failedAt: "original",
      failureKind: "product",
    };
    expect(checkV1(rows, ["R1"]).issues).toContain("R1-low-r1: original-failed-outcome-incomplete");
    rows[0] = { ...rows[0]!, failedAt: "reimport" };
    expect(checkV1(rows, ["R1"]).issues).toContain("R1-low-r1: reimport-failed-outcome-incomplete");
  });
  it("keeps held-manual preparation blocks distinct and incomplete", () => {
    const rows = v1Plan(["R1"]).map(run);
    rows[0] = {
      ...rows[0]!,
      exported: null,
      reimport: null,
      conflictPreparation: {
        status: "blocked-held-manual",
        durationMs: 25,
        pendingBefore: 1,
        pendingAfter: 1,
        resolvedCount: 0,
        heldManualCount: 1,
        defaultInconsistentCount: 0,
        groupCount: 1,
        groupInvariantsPreserved: true,
        conflictInvariantsPreserved: true,
        exportEnabled: false,
      },
      failedAt: "conflicts",
      failureKind: "blocked",
    };
    const check = checkV1(rows, ["R1"]);
    expect(check.complete).toBe(false);
    expect(check.failedRuns[0]?.kind).toBe("blocked");
    expect(check.issues).toContain("R1-low-r1: conflict-preparation-blocked-blocked-held-manual");
  });
  it("accepts a failed pipeline outcome with no invented Ready or M2 and separates instrument failures", () => {
    const value = imported(20);
    const failed: V1Import = {
      ...value,
      report: { ...value.report, ok: false, readyDurationMs: null, peakSumBytes: null },
      snapshot: { ...value.snapshot, pipelineFailed: true, parsedPageIndices: [], pageCount: null },
    };
    expect(importIssues(failed, 20, true)).toEqual([]);
    const rows = v1Plan(["R1"]).map(run);
    rows[0] = {
      ...rows[0]!,
      original: failed,
      exported: null,
      conflictPreparation: null,
      reimport: null,
      failedAt: "original",
      failureKind: "product",
      errorName: "PipelineFailed",
    };
    expect(summarizeV1(rows, ["R1"]).check.complete).toBe(true);
    expect(summarizeV1(rows, ["R1"]).cells[0]?.successfulRuns).toBe(2);
    rows[0] = { ...rows[0]!, failureKind: "instrument" };
    expect(summarizeV1(rows, ["R1"]).check.complete).toBe(false);
  });
});
