import { describe, expect, it } from "vitest";

import {
  decodeNerGapsReport,
  decodeNerGapsThreadObservation,
  validateNerGapsReportConsistency,
} from "./nerGapsDecode.js";
import type { NerGapImport, NerGapsArm, NerGapsReport } from "./nerGapsTypes.js";

const SHA = "a".repeat(64);

function measured(index: number): NerGapImport {
  const corpus = index < 2 ? "R1" : "R2";
  const marks = {
    selection: 10,
    DOCUMENT_IMPORTED: 20,
    NER_STARTED: 30,
    NER_MODEL_LOADING: index % 2 === 0 ? 100 : null,
    NER_MODEL_READY: index % 2 === 0 ? 120 : null,
    NER_FINISHED: 150,
    PIPELINE_READY: 160,
    PIPELINE_FAILED: null,
  } as const;
  return {
    corpus,
    sequenceIndex: index,
    ok: true,
    marks,
    durationMs: {
      selectionToPanelMs: 160,
      importedToPanelMs: 150,
      importedToReadyMs: 140,
      readyToPanelMs: 10,
      nerMs: 120,
      modelReadyToNerFinishedMs: index % 2 === 0 ? 30 : null,
      loadMs: index % 2 === 0 ? 20 : null,
    },
    panel: { visible: true, observedAtMs: 170 },
    peakNerJobs: 1,
    ner: { count: 1, sha256: SHA },
    ocr: { count: 0, sha256: SHA },
    grouping: { count: 1, sha256: SHA },
    pageCount: 1,
    pageWordCounts: [1],
    pageCharacterCounts: [2],
    nerJobCount: 1,
    intervalFromPreviousReadyToSelectionMs: index === 0 ? null : 5,
    errors: [],
  };
}

function validReport(arm: NerGapsArm = "A", runId = `time-${arm}-b1`): NerGapsReport {
  return {
    schemaVersion: 1,
    runId,
    phase: "timing",
    arm,
    block: 1,
    corpus: null,
    host: {
      platform: "darwin",
      arch: "arm64",
      cpuCount: 8,
      totalMemBytes: 100,
      electronVersion: "39.0.0",
      nodeVersion: "22.0.0",
    },
    product: {
      commit: "1234567890abcdef",
      dirty: false,
      sourceSha256: SHA,
      buildSha256: SHA,
      modelSha256: SHA,
      requestedThreads: arm === "A" ? "automatic" : Number(arm),
      observedThreads: null,
    },
    imports: [0, 1, 2, 3].map(measured),
    completed: true,
    createdAt: "2026-09-26T00:00:00.000Z",
  };
}

describe("nerGaps persisted report decoder", () => {
  it("accepts a complete report whose filename identity matches its metadata", () => {
    const report = validReport();
    expect(decodeNerGapsReport(report, report.runId)).toEqual(report);
  });

  it("rejects invalid hashes, inconsistent IDs, malformed marks, and missing host fields", () => {
    const base = validReport();
    expect(
      decodeNerGapsReport(
        { ...base, product: { ...base.product, modelSha256: "not-a-sha" } },
        base.runId,
      ),
    ).toBeNull();
    expect(decodeNerGapsReport({ ...base, runId: "time-4-b2" }, base.runId)).toBeNull();
    const first = base.imports[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      const malformed = {
        ...base,
        imports: [
          { ...first, marks: { ...first.marks, NER_FINISHED: "late" } },
          ...base.imports.slice(1),
        ],
      };
      expect(decodeNerGapsReport(malformed, base.runId)).toBeNull();
    }
    const { cpuCount: _cpuCount, ...hostWithoutCpuCount } = base.host;
    expect(decodeNerGapsReport({ ...base, host: hostWithoutCpuCount }, base.runId)).toBeNull();
  });

  it("rejects changes to sequence position or corpus even when report metadata otherwise looks valid", () => {
    const base = validReport();
    const imports = [...base.imports];
    const second = imports[1];
    expect(second).toBeDefined();
    if (second !== undefined) imports[1] = { ...second, sequenceIndex: 0 };
    expect(decodeNerGapsReport({ ...base, imports }, base.runId)).toBeNull();
  });

  it("requires common host and commit identity across all reports", () => {
    const first = validReport();
    const second = validReport("4", "time-4-b1");
    expect(validateNerGapsReportConsistency([first, second])).toEqual([]);
    const changedHost = { ...second, host: { ...second.host, nodeVersion: "23.0.0" } };
    const changedCommit = { ...second, product: { ...second.product, commit: "different-commit" } };
    expect(validateNerGapsReportConsistency([first, changedHost, changedCommit])).toEqual(
      expect.arrayContaining(["host-mismatch-time-4-b1", "commit-mismatch-time-4-b1"]),
    );
  });

  it("accepts only the separate P1 thread-observation run with an integer effective count", () => {
    const observation = {
      runId: "4-P1-r0",
      phase: "threads",
      profile: "P1",
      requestedThreads: 4,
      observedThreads: { effectiveThreads: 4, ownerUrls: ["worker://owner"] },
    };
    expect(decodeNerGapsThreadObservation(observation, "4")).toEqual({
      arm: "4",
      requestedThreads: 4,
      effectiveThreads: 4,
    });
    expect(decodeNerGapsThreadObservation({ ...observation, profile: "P2" }, "4")).toBeNull();
    expect(decodeNerGapsThreadObservation({ ...observation, requestedThreads: 6 }, "4")).toBeNull();
    expect(
      decodeNerGapsThreadObservation(
        { ...observation, observedThreads: { effectiveThreads: 0 } },
        "4",
      ),
    ).toBeNull();
  });
});
