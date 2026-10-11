/** Strict allowlist projection before any M-V1 report reaches disk. */
import { createHash } from "node:crypto";

import type { ClassifiedTargetHeapSample } from "./cdpHeap.js";
import { PHASE_EVENTS, type PhaseSegment, type RunReport } from "./memoryProfile.js";
import type { SystemMemoryPressureSample } from "./systemMemoryPressure.js";
import {
  V1_DOCS,
  V1_PRESETS,
  type V1ConflictPreparation,
  type V1Export,
  type V1ImportSnapshot,
  type V1Run,
} from "./validateSampleCampaign.js";

const WORKERS = new Set([
  "pdf-parse",
  "ocr-page",
  "ocr-orient",
  "ner-page",
  "render-page",
  "export-page",
]);
const EVENTS = new Set(PHASE_EVENTS.map(([, event]) => event));
const opaque = (value: string): string => createHash("sha256").update(value).digest("hex");
const targetIdentity = (value: string): string =>
  /^[a-f0-9]{64}$/.test(value) ? value : opaque(value);
export const V1_BATCH_PATTERN = /^tanda-\d{8}T\d{6}Z(?:-\d+)?$/;
export interface V1ManifestIdentity {
  readonly createdAtUtc: string;
  readonly buildHash: string;
  readonly docs: ReadonlyArray<(typeof V1_DOCS)[number]>;
  readonly fixtureHashes: Readonly<Record<string, string>>;
  readonly batches: ReadonlyArray<{ readonly id: string; readonly pendingRuns: number }>;
}
export function projectV1Manifest(value: unknown): V1ManifestIdentity {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schema" in value) ||
    value.schema !== 1 ||
    !("phase" in value) ||
    value.phase !== "M-V1" ||
    !("createdAtUtc" in value) ||
    typeof value.createdAtUtc !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAtUtc) ||
    !("buildHash" in value) ||
    typeof value.buildHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.buildHash) ||
    !("docs" in value) ||
    !Array.isArray(value.docs) ||
    !("fixtureHashes" in value) ||
    typeof value.fixtureHashes !== "object" ||
    value.fixtureHashes === null ||
    !("batches" in value) ||
    !Array.isArray(value.batches)
  )
    throw new Error("M-V1 incomplete manifest");
  const docs: Array<(typeof V1_DOCS)[number]> = [];
  for (const doc of value.docs) {
    const found = V1_DOCS.find((known) => known === doc);
    if (found === undefined || docs.includes(found))
      throw new Error("M-V1 invalid manifest documents");
    docs.push(found);
  }
  const fixtureHashes: Record<string, string> = {};
  for (const [doc, hash] of Object.entries(value.fixtureHashes)) {
    if (
      !V1_DOCS.some((known) => known === doc) ||
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw new Error("M-V1 invalid manifest fixture");
    fixtureHashes[doc] = hash;
  }
  if (docs.some((doc) => fixtureHashes[doc] === undefined))
    throw new Error("M-V1 incomplete fixture manifest");
  const batches: Array<{ id: string; pendingRuns: number }> = [];
  for (const batch of value.batches) {
    if (
      typeof batch !== "object" ||
      batch === null ||
      !("id" in batch) ||
      typeof batch.id !== "string" ||
      !V1_BATCH_PATTERN.test(batch.id) ||
      !("pendingRuns" in batch) ||
      typeof batch.pendingRuns !== "number" ||
      !Number.isInteger(batch.pendingRuns) ||
      batch.pendingRuns < 0 ||
      batch.pendingRuns > 36 ||
      batches.some((previous) => previous.id === batch.id)
    )
      throw new Error("M-V1 invalid manifest batch");
    batches.push({ id: batch.id, pendingRuns: batch.pendingRuns });
  }
  if (batches.length === 0) throw new Error("M-V1 incomplete batch identity");
  return {
    createdAtUtc: value.createdAtUtc,
    buildHash: value.buildHash,
    docs,
    fixtureHashes,
    batches,
  };
}
export function safeV1ErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  const standard = [
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "TimeoutError",
    "AbortError",
    "URIError",
    "EvalError",
    "AggregateError",
  ];
  return standard.includes(error.name)
    ? error.name
    : `NonStandardError-${opaque(error.name).slice(0, 12)}`;
}
function assertReportStrings(value: unknown, key = ""): void {
  if (typeof value === "string") {
    const permitted: Readonly<Record<string, ReadonlyArray<string>>> = {
      temperature: ["cold", "hot"],
      fromEvent: [...EVENTS, "UNKNOWN_EVENT"],
      toEvent: [...EVENTS, "UNKNOWN_EVENT"],
      type: [
        "page",
        "worker",
        "service_worker",
        "unknown",
        "Browser",
        "Tab",
        "GPU",
        "Utility",
        "Zygote",
        "Sandbox helper",
        "Unknown",
        ...WORKERS,
      ],
      url: ["[asset-url-omitted]"],
      readError: ["CdpReadError"],
      note: ["classification-note-omitted"],
      factoryChunk: ["ocr-entry", "orientation-entry", "unknown"],
      workerRole: ["lstm", "orientation", "unknown"],
      reason: ["SystemMemoryPressureUnavailable"],
      compressorUnavailableReason: ["CompressorMetricUnavailable"],
      peakPosition: ["before-imported", "within-phases", "after-last-phase", "no-phase-data"],
    };
    if ((key === "sessionId" || key === "parentSessionId") && /^[a-f0-9]{64}$/.test(value)) return;
    if (key === "label" && /^target-[a-f0-9]{12}$/.test(value)) return;
    if (permitted[key]?.includes(value)) return;
    throw new Error("M-V1 invalid report field");
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertReportStrings(entry, key);
    return;
  }
  if (typeof value === "object" && value !== null)
    for (const [field, entry] of Object.entries(value)) assertReportStrings(entry, field);
}
const workers = (value: Readonly<Record<string, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => WORKERS.has(key)));
function target(value: ClassifiedTargetHeapSample): ClassifiedTargetHeapSample {
  return {
    sessionId: targetIdentity(value.sessionId),
    parentSessionId:
      value.parentSessionId === undefined ? undefined : targetIdentity(value.parentSessionId),
    type: ["page", "worker", "service_worker"].includes(value.type) ? value.type : "unknown",
    url: "[asset-url-omitted]",
    attachedAtMs: value.attachedAtMs,
    usedSizeBytes: value.usedSizeBytes,
    totalSizeBytes: value.totalSizeBytes,
    embedderHeapUsedSizeBytes: value.embedderHeapUsedSizeBytes,
    backingStorageSizeBytes: value.backingStorageSizeBytes,
    readError: value.readError === undefined ? undefined : "CdpReadError",
    label: `target-${targetIdentity(value.sessionId).slice(0, 12)}`,
    note: "classification-note-omitted",
    factoryChunk: ["ocr-entry", "orientation-entry"].includes(value.factoryChunk)
      ? value.factoryChunk
      : "unknown",
    workerRole: ["lstm", "orientation"].includes(value.workerRole) ? value.workerRole : "unknown",
  };
}
function pressure(value: SystemMemoryPressureSample): SystemMemoryPressureSample {
  if (!value.available) return { available: false, reason: "SystemMemoryPressureUnavailable" };
  return {
    available: true,
    freeBytes: value.freeBytes,
    compressorBytes: value.compressorBytes,
    compressorUnavailableReason:
      value.compressorUnavailableReason === undefined ? undefined : "CompressorMetricUnavailable",
    swapUsedBytes: value.swapUsedBytes,
  };
}
function segment(value: PhaseSegment): PhaseSegment {
  return {
    fromEvent: EVENTS.has(value.fromEvent) ? value.fromEvent : "UNKNOWN_EVENT",
    toEvent: EVENTS.has(value.toEvent) ? value.toEvent : "UNKNOWN_EVENT",
    fromAtMs: value.fromAtMs,
    toAtMs: value.toAtMs,
    rssAtEntryBytes: value.rssAtEntryBytes,
    rssAtExitBytes: value.rssAtExitBytes,
    sampleCountInWindow: value.sampleCountInWindow,
    measurable: value.measurable,
    peakInternalBytes: value.peakInternalBytes,
    deltaBytes: value.deltaBytes,
    workerPeakByType: workers(value.workerPeakByType),
    heapByTargetAtEntry: value.heapByTargetAtEntry?.map(target),
    heapByTargetAtEntryLagMs: value.heapByTargetAtEntryLagMs,
    heapByTargetAtExit: value.heapByTargetAtExit?.map(target),
    heapByTargetAtExitLagMs: value.heapByTargetAtExitLagMs,
    unattributedResidualAtEntryBytes: value.unattributedResidualAtEntryBytes,
    unattributedResidualAtExitBytes: value.unattributedResidualAtExitBytes,
    targetCoverage: value.targetCoverage.map((coverage) => ({
      sessionId: targetIdentity(coverage.sessionId),
      label: `target-${targetIdentity(coverage.sessionId).slice(0, 12)}`,
      attempted: coverage.attempted,
      succeeded: coverage.succeeded,
    })),
  };
}
export function sanitizeV1Report(value: RunReport): RunReport {
  if ((value.ocrWords?.length ?? 0) !== 0) throw new Error("M-V1 privacy: OCR words captured");
  // A failed run keeps the raw observed global peak and series. The legacy
  // instrument falls back to that peak when it has no phase window; M-V1 must
  // not present that fallback as a measured phase peak or a post-Ready value.
  const failedWithoutPhaseWindow =
    !value.ok &&
    (value.phaseSegments.length === 0 ||
      value.phases.DOCUMENT_IMPORTED === undefined ||
      (value.phases.PIPELINE_FAILED === undefined && value.phases.PIPELINE_READY === undefined));
  const failedWithoutReady = !value.ok && value.phases.PIPELINE_READY === undefined;
  const projected: RunReport = {
    temperature: value.temperature,
    baselineBytes: value.baselineBytes,
    peakSumBytes: failedWithoutPhaseWindow ? null : value.peakSumBytes,
    postReadyPeakBytes: failedWithoutReady ? null : value.postReadyPeakBytes,
    m1Bytes: failedWithoutPhaseWindow ? null : value.m1Bytes,
    phases: Object.fromEntries(Object.entries(value.phases).filter(([key]) => EVENTS.has(key))),
    workerPeakByType: workers(value.workerPeakByType),
    startedAtMs: value.startedAtMs,
    readyAtMs: failedWithoutReady ? null : value.readyAtMs,
    totalMs: failedWithoutReady ? null : value.totalMs,
    groupCount: value.groupCount,
    entityCount: value.entityCount,
    groupPageIndices: value.groupPageIndices ?? [],
    groupPageIndicesComplete: value.groupPageIndicesComplete === true,
    ocrPages:
      value.ocrPages?.map((page) => ({
        pageIndex: page.pageIndex,
        wordCount: page.wordCount,
        confidence: page.confidence,
      })) ?? [],
    ocrWords: [],
    ocrStartedAtMs: value.ocrStartedAtMs ?? null,
    ocrFinishedAtMs: value.ocrFinishedAtMs ?? null,
    ocrDurationMs: value.ocrDurationMs ?? null,
    readyDurationMs: failedWithoutReady ? null : (value.readyDurationMs ?? null),
    panelVisible: value.panelVisible === true,
    rssPeakDuringOcrBytes: value.rssPeakDuringOcrBytes ?? null,
    ...(value.rssPeakGlobalBytes === undefined
      ? {}
      : { rssPeakGlobalBytes: value.rssPeakGlobalBytes }),
    ok: value.ok,
    phaseSegments: value.phaseSegments.map(segment),
    samples: value.samples.map((sample) => ({
      atMs: sample.atMs,
      sumWorkingSetSizeBytes: sample.sumWorkingSetSizeBytes,
      perProcess: sample.perProcess.map((process) => ({
        pid: process.pid,
        type: ["Browser", "Tab", "GPU", "Utility", "Zygote", "Sandbox helper", "Unknown"].includes(
          process.type,
        )
          ? process.type
          : "Unknown",
        workingSetSizeBytes: process.workingSetSizeBytes,
      })),
    })),
    workerEvents: value.workerEvents
      .filter((event) => WORKERS.has(event.type))
      .map((event) => ({ type: event.type, atMs: event.atMs, delta: event.delta })),
    peakPosition: value.peakPosition,
    hotBaselineSettled: value.hotBaselineSettled,
    heapSamples: value.heapSamples.map((sample) => ({
      atMs: sample.atMs,
      targets: sample.targets.map(target),
    })),
    systemPressureAtStart: pressure(value.systemPressureAtStart),
    systemPressureAtEnd: pressure(value.systemPressureAtEnd),
  };
  assertReportStrings(projected);
  return projected;
}
export function projectV1Snapshot(value: V1ImportSnapshot): V1ImportSnapshot {
  const arrays = [
    value.parsedPageIndices,
    value.requiresOcrPageIndices,
    value.completedOcrPageIndices,
    value.unreadableInkPageIndices,
    value.failedOcrPageIndices,
  ];
  if (
    arrays.some(
      (indices) =>
        !Array.isArray(indices) ||
        indices.some((index) => typeof index !== "number" || !Number.isInteger(index) || index < 0),
    ) ||
    typeof value.pipelineFailed !== "boolean" ||
    [value.conflictCount, value.pageCount, value.words].some(
      (n) => n !== null && (typeof n !== "number" || !Number.isInteger(n) || n < 0),
    )
  )
    throw new Error("M-V1 invalid snapshot metadata");
  return {
    parsedPageIndices: [...value.parsedPageIndices],
    requiresOcrPageIndices: [...value.requiresOcrPageIndices],
    completedOcrPageIndices: [...value.completedOcrPageIndices],
    unreadableInkPageIndices: [...value.unreadableInkPageIndices],
    failedOcrPageIndices: [...value.failedOcrPageIndices],
    pipelineFailed: value.pipelineFailed,
    conflictCount: value.conflictCount,
    pageCount: value.pageCount,
    words: value.words,
  };
}
export function projectV1Export(value: V1Export): V1Export {
  if (!/^[a-f0-9]{64}$/.test(value.sha256) || !["jpeg", "png"].includes(value.imageFormat))
    throw new Error("M-V1 invalid export identity");
  if (
    [
      value.durationMs,
      value.wallDurationMs,
      value.sizeBytes,
      value.pages,
      value.jpegQuality,
      value.dpi,
    ].some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0) ||
    [
      value.includeMarkerLegend,
      value.noGroupsConfirmationShown,
      value.unreadableConfirmationShown,
    ].some((b) => typeof b !== "boolean") ||
    !Array.isArray(value.coveredPages) ||
    value.coveredPages.some(
      (index) => typeof index !== "number" || !Number.isInteger(index) || index < 0,
    )
  )
    throw new Error("M-V1 invalid export metadata");
  return {
    durationMs: value.durationMs,
    wallDurationMs: value.wallDurationMs,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    pages: value.pages,
    imageFormat: value.imageFormat,
    jpegQuality: value.jpegQuality,
    dpi: value.dpi,
    includeMarkerLegend: value.includeMarkerLegend,
    coveredPages: [...value.coveredPages],
    noGroupsConfirmationShown: value.noGroupsConfirmationShown,
    unreadableConfirmationShown: value.unreadableConfirmationShown,
  };
}
/** Re-project on every write and after reading a resume file: future extras cannot leak. */
export function projectV1Run(value: V1Run): V1Run {
  if (
    value.schema !== 1 ||
    !V1_DOCS.includes(value.doc) ||
    !V1_PRESETS.includes(value.preset) ||
    ![1, 2, 3].includes(value.repetition) ||
    !V1_BATCH_PATTERN.test(value.batchId) ||
    !/^[a-f0-9]{64}$/.test(value.fixtureSha256) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.capturedAtUtc)
  )
    throw new Error("M-V1 invalid record identity");
  if (
    ![null, "original", "conflicts", "export", "reimport"].includes(value.failedAt) ||
    ![null, "product", "instrument", "blocked"].includes(value.failureKind)
  )
    throw new Error("M-V1 invalid outcome");
  if (
    [value.fixtureBytes, value.sourcePages].some(
      (n) => typeof n !== "number" || !Number.isInteger(n) || n <= 0,
    )
  )
    throw new Error("M-V1 invalid source metadata");
  const knownIssues = [
    "ready-timing-missing",
    "M2-missing",
    "page-count-mismatch",
    "ocr-page-coverage-incomplete",
    "privacy-ocr-words-captured",
    "export-page-count-mismatch",
  ];
  if (value.issues.some((issue) => !knownIssues.includes(issue)))
    throw new Error("M-V1 invalid issue code");
  const projected: V1Run = {
    schema: 1,
    doc: value.doc,
    preset: value.preset,
    repetition: value.repetition,
    capturedAtUtc: value.capturedAtUtc,
    batchId: value.batchId,
    fixtureSha256: value.fixtureSha256,
    fixtureBytes: value.fixtureBytes,
    sourcePages: value.sourcePages,
    original:
      value.original === null
        ? null
        : {
            report: sanitizeV1Report(value.original.report),
            snapshot: projectV1Snapshot(value.original.snapshot),
          },
    exported: value.exported === null ? null : projectV1Export(value.exported),
    conflictPreparation:
      !Object.hasOwn(value, "conflictPreparation") || value.conflictPreparation === null
        ? null
        : projectV1ConflictPreparation(value.conflictPreparation),
    reimport:
      value.reimport === null
        ? null
        : {
            report: sanitizeV1Report(value.reimport.report),
            snapshot: projectV1Snapshot(value.reimport.snapshot),
          },
    failedAt: value.failedAt,
    failureKind: value.failureKind,
    errorName:
      value.errorName === null
        ? null
        : /^(Error|TypeError|RangeError|SyntaxError|ReferenceError|TimeoutError|AbortError|URIError|EvalError|AggregateError|NonError|NonStandardError-[a-f0-9]{12})$/.test(
              value.errorName,
            )
          ? value.errorName
          : `NonStandardError-${opaque(value.errorName).slice(0, 12)}`,
    issues: [...value.issues],
  };
  // Metadata contains a small declared set of string fields. Everything else
  // must be numeric/boolean/null, including snapshot arrays and export metrics.
  const walk = (entry: unknown, key = ""): void => {
    if (typeof entry === "string") {
      if (
        key === "status" &&
        [
          "not-needed",
          "prepared",
          "blocked-held-manual",
          "blocked-default-inconsistent",
          "blocked-timeout",
        ].includes(entry)
      )
        return;
      if (
        [
          "doc",
          "preset",
          "capturedAtUtc",
          "batchId",
          "fixtureSha256",
          "sha256",
          "imageFormat",
          "failedAt",
          "failureKind",
          "errorName",
          "issues",
        ].includes(key)
      )
        return;
      throw new Error("M-V1 invalid numeric metadata");
    }
    if (Array.isArray(entry)) {
      for (const child of entry) walk(child, key);
      return;
    }
    if (typeof entry === "object" && entry !== null)
      for (const [field, child] of Object.entries(entry))
        if (field !== "report") walk(child, field);
  };
  walk(projected);
  return projected;
}

function projectV1ConflictPreparation(value: V1ConflictPreparation): V1ConflictPreparation {
  const statuses = [
    "not-needed",
    "prepared",
    "blocked-held-manual",
    "blocked-default-inconsistent",
    "blocked-timeout",
  ];
  if (
    !statuses.includes(value.status) ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0 ||
    [
      value.pendingBefore,
      value.pendingAfter,
      value.resolvedCount,
      value.heldManualCount,
      value.defaultInconsistentCount,
      value.groupCount,
    ].some((count) => !Number.isInteger(count) || count < 0) ||
    [value.groupInvariantsPreserved, value.conflictInvariantsPreserved, value.exportEnabled].some(
      (flag) => typeof flag !== "boolean",
    )
  )
    throw new Error("M-V1 invalid conflict preparation metadata");
  return {
    status: value.status,
    durationMs: value.durationMs,
    pendingBefore: value.pendingBefore,
    pendingAfter: value.pendingAfter,
    resolvedCount: value.resolvedCount,
    heldManualCount: value.heldManualCount,
    defaultInconsistentCount: value.defaultInconsistentCount,
    groupCount: value.groupCount,
    groupInvariantsPreserved: value.groupInvariantsPreserved,
    conflictInvariantsPreserved: value.conflictInvariantsPreserved,
    exportEnabled: value.exportEnabled,
  };
}
