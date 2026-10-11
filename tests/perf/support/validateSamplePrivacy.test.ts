import { describe, expect, it } from "vitest";

import type { ClassifiedTargetHeapSample } from "./cdpHeap.js";
import type { PhaseSegment, RunReport } from "./memoryProfile.js";
import { checkV1, type V1Run } from "./validateSampleCampaign.js";
import {
  projectV1Manifest,
  projectV1Run,
  safeV1ErrorName,
  sanitizeV1Report,
} from "./validateSamplePrivacy.js";

const PRIVATE = "PRIVATE-DOCUMENT-CONTENT-OR-PATH";
function report(): RunReport {
  const target: ClassifiedTargetHeapSample = {
    sessionId: PRIVATE,
    parentSessionId: PRIVATE,
    type: PRIVATE,
    url: PRIVATE,
    attachedAtMs: 4,
    usedSizeBytes: 12,
    totalSizeBytes: 24,
    embedderHeapUsedSizeBytes: 3,
    backingStorageSizeBytes: 60,
    readError: PRIVATE,
    label: PRIVATE,
    note: PRIVATE,
    factoryChunk: "unknown",
    workerRole: "unknown",
  };
  const segment: PhaseSegment = {
    fromEvent: "DOCUMENT_IMPORTED",
    toEvent: "PIPELINE_READY",
    fromAtMs: 0,
    toAtMs: 10,
    rssAtEntryBytes: 100,
    rssAtExitBytes: 200,
    sampleCountInWindow: 2,
    measurable: true,
    peakInternalBytes: 210,
    deltaBytes: 100,
    workerPeakByType: { "ocr-page": 2, [PRIVATE]: 999 },
    heapByTargetAtEntry: [target],
    heapByTargetAtEntryLagMs: 1,
    heapByTargetAtExit: [target],
    heapByTargetAtExitLagMs: 2,
    unattributedResidualAtEntryBytes: 28,
    unattributedResidualAtExitBytes: 30,
    targetCoverage: [{ sessionId: PRIVATE, label: PRIVATE, attempted: 2, succeeded: 1 }],
  };
  return Object.assign(
    {
      temperature: "cold" as const,
      baselineBytes: 100,
      peakSumBytes: 210,
      postReadyPeakBytes: 220,
      m1Bytes: null,
      phases: { DOCUMENT_IMPORTED: 100, PIPELINE_READY: 110, [PRIVATE]: 999 },
      workerPeakByType: { "ocr-page": 2, [PRIVATE]: 999 },
      startedAtMs: 0,
      readyAtMs: 10,
      totalMs: 10,
      readyDurationMs: 10,
      ocrDurationMs: 8,
      groupCount: 1,
      entityCount: 2,
      ok: true,
      phaseSegments: [segment],
      samples: [
        {
          atMs: 8,
          sumWorkingSetSizeBytes: 200,
          perProcess: [{ pid: 42, type: PRIVATE, workingSetSizeBytes: 200 }],
        },
      ],
      workerEvents: [
        { type: "ocr-page", atMs: 1, delta: 1 as const },
        { type: PRIVATE, atMs: 3, delta: -1 as const },
      ],
      peakPosition: "within-phases" as const,
      hotBaselineSettled: null,
      heapSamples: [{ atMs: 3, targets: [target] }],
      systemPressureAtStart: { available: false as const, reason: PRIVATE },
      systemPressureAtEnd: {
        available: true as const,
        freeBytes: 99,
        compressorBytes: undefined,
        compressorUnavailableReason: PRIVATE,
        swapUsedBytes: 1,
      },
      ocrWords: [],
    },
    { unexpectedDocumentText: PRIVATE },
  );
}
describe("M-V1 persisted-report allowlist", () => {
  it("removes messages, URLs, arbitrary labels/keys and future extra fields from all report depths", () => {
    const original = report();
    expect(JSON.stringify(original)).toContain(PRIVATE);
    const clean = sanitizeV1Report(original);
    expect(JSON.stringify(clean)).not.toContain(PRIVATE);
    expect("unexpectedDocumentText" in clean).toBe(false);
    expect(clean.phases).toEqual({ DOCUMENT_IMPORTED: 100, PIPELINE_READY: 110 });
    expect(clean.workerEvents).toEqual([{ type: "ocr-page", atMs: 1, delta: 1 }]);
    expect(clean.heapSamples[0]?.targets[0]?.readError).toBe("CdpReadError");
    expect(clean.peakSumBytes).toBe(original.peakSumBytes);
    expect(clean.phaseSegments[0]?.rssAtExitBytes).toBe(200);
    expect(clean.samples[0]?.perProcess[0]?.workingSetSizeBytes).toBe(200);
    expect(clean.heapSamples[0]?.targets[0]?.backingStorageSizeBytes).toBe(60);
    expect(clean.phaseSegments[0]?.heapByTargetAtEntry?.[0]?.sessionId).toBe(
      clean.heapSamples[0]?.targets[0]?.sessionId,
    );
    expect(original.heapSamples[0]?.targets[0]?.url).toBe(PRIVATE);
    expect(sanitizeV1Report(clean)).toEqual(clean);
  });
  it("refuses any OCR-word capture before writing rather than silently stripping evidence", () => {
    const source = { ...report(), ocrWords: [{ pageIndex: 0, words: [] }] };
    expect(() => sanitizeV1Report(source)).toThrow("OCR words captured");
  });
  it("preserves failed/null phase boundaries without inventing successful numbers", () => {
    const source = {
      ...report(),
      ok: false,
      phases: { PIPELINE_FAILED: 110 },
      phaseSegments: [],
      readyDurationMs: null,
      readyAtMs: null,
      peakSumBytes: null,
    };
    const clean = sanitizeV1Report(source);
    expect(clean.ok).toBe(false);
    expect(clean.readyDurationMs).toBeNull();
    expect(clean.readyAtMs).toBeNull();
    expect(clean.peakSumBytes).toBeNull();
  });
  it("retains observed failure data without labeling fallback peaks as a measured phase or post-Ready", () => {
    const source = {
      ...report(),
      ok: false,
      phases: { PIPELINE_FAILED: 110 },
      phaseSegments: [],
      readyDurationMs: null,
      readyAtMs: null,
      totalMs: null,
      peakSumBytes: 210,
      postReadyPeakBytes: 220,
      rssPeakGlobalBytes: 220,
    };
    const clean = sanitizeV1Report(source);
    expect(clean.peakSumBytes).toBeNull();
    expect(clean.postReadyPeakBytes).toBeNull();
    expect(clean.rssPeakGlobalBytes).toBe(220);
    expect(clean.samples[0]?.sumWorkingSetSizeBytes).toBe(200);
    expect(clean.heapSamples[0]?.targets[0]?.backingStorageSizeBytes).toBe(60);
    expect(clean.phases).toEqual({ PIPELINE_FAILED: 110 });
  });
  it("never persists arbitrary Error.name and never expands arbitrary manifest fields", () => {
    const error = new Error(PRIVATE);
    error.name = PRIVATE;
    const name = safeV1ErrorName(error);
    expect(name).toMatch(/^NonStandardError-[a-f0-9]{12}$/);
    expect(name).not.toContain(PRIVATE);
    const manifest = {
      schema: 1,
      phase: "M-V1",
      createdAtUtc: "2026-10-10T00:00:00.000Z",
      buildHash: "a".repeat(64),
      docs: ["R1"],
      fixtureHashes: { R1: "b".repeat(64) },
      batches: [{ id: "tanda-20261010T000000Z-1234", pendingRuns: 6, documentText: PRIVATE }],
      documentName: PRIVATE,
    };
    expect(JSON.stringify(projectV1Manifest(manifest))).not.toContain(PRIVATE);
    expect(() => projectV1Manifest({ ...manifest, buildHash: "" })).toThrow("incomplete manifest");
    expect(() =>
      projectV1Manifest({ ...manifest, fixtureHashes: { [PRIVATE]: "b".repeat(64) } }),
    ).toThrow("manifest fixture");
    expect(() => projectV1Manifest({ ...manifest, fixtureHashes: {} })).toThrow(
      "incomplete fixture manifest",
    );
    expect(() => projectV1Manifest({ ...manifest, batches: [] })).toThrow(
      "incomplete batch identity",
    );
  });
  it("projects a full checkpoint/export record, excluding future byte buffers and document strings", () => {
    const source: V1Run = Object.assign(
      {
        schema: 1 as const,
        doc: "R1" as const,
        preset: "low" as const,
        repetition: 1,
        capturedAtUtc: "2026-10-10T00:00:00.000Z",
        batchId: "tanda-20261010T000000Z-1234",
        fixtureSha256: "a".repeat(64),
        fixtureBytes: 500,
        sourcePages: 20,
        original: {
          report: report(),
          snapshot: Object.assign(
            {
              parsedPageIndices: [0],
              requiresOcrPageIndices: [0],
              completedOcrPageIndices: [0],
              unreadableInkPageIndices: [],
              failedOcrPageIndices: [],
              pipelineFailed: false,
              conflictCount: 0,
              pageCount: 20,
              words: 30,
            },
            { documentText: PRIVATE },
          ),
        },
        exported: Object.assign(
          {
            durationMs: 1,
            wallDurationMs: 2,
            sizeBytes: 500,
            sha256: "b".repeat(64),
            pages: 20,
            imageFormat: "jpeg" as const,
            jpegQuality: 0.92,
            dpi: 150,
            includeMarkerLegend: false,
            coveredPages: [],
            noGroupsConfirmationShown: false,
            unreadableConfirmationShown: false,
          },
          { filename: PRIVATE, buffer: Buffer.from(PRIVATE) },
        ),
        reimport: null,
        conflictPreparation: {
          status: "not-needed" as const,
          durationMs: 1,
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
      },
      { rawDocumentBytes: Buffer.from(PRIVATE), realPath: PRIVATE },
    );
    const clean = projectV1Run(source);
    expect(JSON.stringify(clean)).not.toContain(PRIVATE);
    expect("rawDocumentBytes" in clean).toBe(false);
    expect(clean.exported !== null && "buffer" in clean.exported).toBe(false);
    expect(clean.original !== null && "documentText" in clean.original.snapshot).toBe(false);
    expect(clean.conflictPreparation?.status).toBe("not-needed");
    expect(projectV1Run(clean)).toEqual(clean);
    const historicalRecord = {
      ...clean,
      reimport: clean.original,
    } as Omit<V1Run, "conflictPreparation"> & {
      conflictPreparation?: V1Run["conflictPreparation"];
    };
    delete historicalRecord.conflictPreparation;
    const historical = projectV1Run(historicalRecord as V1Run);
    expect(historical.conflictPreparation).toBeNull();
    expect(checkV1([historical], ["R1"]).issues).toContain(
      "R1-low-r1: conflict-preparation-missing",
    );
    const invalidStatus = JSON.parse(
      JSON.stringify({
        ...source,
        conflictPreparation: { ...source.conflictPreparation!, status: PRIVATE },
      }),
    ) as V1Run;
    expect(() => projectV1Run(invalidStatus)).toThrow("invalid conflict preparation metadata");
  });
});
