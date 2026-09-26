import type { NerGapImport, NerGapsArm, NerGapsCorpus, NerGapsReport } from "./nerGapsTypes.js";

const ARMS = ["A", "4", "6", "8"] as const;
const CORPORA = ["P1", "P2", "R1", "R2"] as const;
const SEQUENCE = ["R1", "R1", "R2", "R2"] as const;
const SHA256 = /^[a-f0-9]{64}$/;

export interface NerGapsThreadObservation {
  readonly arm: NerGapsArm;
  readonly requestedThreads: number | "automatic";
  readonly effectiveThreads: number;
}

export function validateNerGapsReportConsistency(
  reports: ReadonlyArray<NerGapsReport>,
): ReadonlyArray<string> {
  const reasons: string[] = [];
  const first = reports[0];
  if (first === undefined) return reasons;
  const hostIdentity = JSON.stringify(first.host);
  for (const report of reports) {
    if (JSON.stringify(report.host) !== hostIdentity) reasons.push(`host-mismatch-${report.runId}`);
    if (report.product.commit !== first.product.commit)
      reasons.push(`commit-mismatch-${report.runId}`);
    const expectedThreads = report.arm === "A" ? "automatic" : Number(report.arm);
    if (report.product.requestedThreads !== expectedThreads)
      reasons.push(`requested-threads-mismatch-${report.runId}`);
  }
  return reasons;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function finiteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function integerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function validCorpus(value: unknown): value is NerGapsCorpus {
  return typeof value === "string" && (CORPORA as ReadonlyArray<string>).includes(value);
}

function validArm(value: unknown): value is NerGapsArm {
  return typeof value === "string" && (ARMS as ReadonlyArray<string>).includes(value);
}

function isImport(value: unknown): value is NerGapImport {
  if (!record(value) || !record(value.marks) || !record(value.durationMs) || !record(value.panel))
    return false;
  if (
    !validCorpus(value.corpus) ||
    !integerAtLeast(value.sequenceIndex, 0) ||
    typeof value.ok !== "boolean"
  )
    return false;
  if (!Array.isArray(value.errors) || !value.errors.every((error) => typeof error === "string"))
    return false;
  const marks = value.marks;
  const durationMs = value.durationMs;
  const panel = value.panel;
  const markKeys = [
    "selection",
    "DOCUMENT_IMPORTED",
    "NER_STARTED",
    "NER_MODEL_LOADING",
    "NER_MODEL_READY",
    "NER_FINISHED",
    "PIPELINE_READY",
    "PIPELINE_FAILED",
  ] as const;
  if (!markKeys.every((key) => key in marks && finiteOrNull(marks[key]))) return false;
  const durationKeys = [
    "selectionToPanelMs",
    "importedToPanelMs",
    "importedToReadyMs",
    "readyToPanelMs",
    "nerMs",
    "modelReadyToNerFinishedMs",
    "loadMs",
  ] as const;
  if (!durationKeys.every((key) => key in durationMs && finiteOrNull(durationMs[key])))
    return false;
  if (typeof panel.visible !== "boolean" || !finiteOrNull(panel.observedAtMs)) return false;
  if (
    !integerAtLeast(value.peakNerJobs, 0) ||
    !integerAtLeast(value.pageCount, 0) ||
    !integerAtLeast(value.nerJobCount, 0)
  )
    return false;
  for (const field of ["ner", "ocr", "grouping"] as const) {
    const quality = value[field];
    if (
      !record(quality) ||
      !integerAtLeast(quality.count, 0) ||
      typeof quality.sha256 !== "string" ||
      !SHA256.test(quality.sha256)
    )
      return false;
  }
  if (
    !Array.isArray(value.pageWordCounts) ||
    !value.pageWordCounts.every((count) => integerAtLeast(count, 0))
  )
    return false;
  if (
    !Array.isArray(value.pageCharacterCounts) ||
    !value.pageCharacterCounts.every((count) => integerAtLeast(count, 0))
  )
    return false;
  return (
    value.intervalFromPreviousReadyToSelectionMs === null ||
    (typeof value.intervalFromPreviousReadyToSelectionMs === "number" &&
      Number.isFinite(value.intervalFromPreviousReadyToSelectionMs) &&
      value.intervalFromPreviousReadyToSelectionMs >= 0)
  );
}

function matchesRunIdentity(value: Record<string, unknown>, expectedRunId: string): boolean {
  if (value.runId !== expectedRunId) return false;
  const preflight = /^preflight-([A468])-(P[12])$/.exec(expectedRunId);
  if (preflight !== null) {
    return (
      value.phase === "preflight" &&
      value.arm === preflight[1] &&
      value.block === null &&
      value.corpus === preflight[2]
    );
  }
  const timing = /^time-([A468])-b([123])$/.exec(expectedRunId);
  if (timing !== null) {
    return (
      value.phase === "timing" &&
      value.arm === timing[1] &&
      value.block === Number(timing[2]) &&
      value.corpus === null
    );
  }
  return false;
}

function isDecodedNerGapsReport(value: unknown, expectedRunId: string): value is NerGapsReport {
  if (!record(value) || !matchesRunIdentity(value, expectedRunId)) return false;
  if (
    value.schemaVersion !== 1 ||
    !validArm(value.arm) ||
    !Array.isArray(value.imports) ||
    !value.imports.every(isImport)
  )
    return false;
  if (value.imports.length > (value.phase === "preflight" ? 1 : SEQUENCE.length)) return false;
  if (
    value.completed !==
    (value.imports.length === (value.phase === "preflight" ? 1 : SEQUENCE.length))
  )
    return false;
  if (!nonemptyString(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)))
    return false;
  if (
    !record(value.host) ||
    !nonemptyString(value.host.platform) ||
    !nonemptyString(value.host.arch)
  )
    return false;
  if (!integerAtLeast(value.host.cpuCount, 1) || !integerAtLeast(value.host.totalMemBytes, 1))
    return false;
  if (!nonemptyString(value.host.electronVersion) || !nonemptyString(value.host.nodeVersion))
    return false;
  if (
    !record(value.product) ||
    !nonemptyString(value.product.commit) ||
    typeof value.product.dirty !== "boolean"
  )
    return false;
  if (
    ![value.product.sourceSha256, value.product.buildSha256, value.product.modelSha256].every(
      (hash) => typeof hash === "string" && SHA256.test(hash),
    )
  )
    return false;
  const requested = value.arm === "A" ? "automatic" : Number(value.arm);
  if (value.product.requestedThreads !== requested) return false;
  if (value.product.observedThreads !== null && !integerAtLeast(value.product.observedThreads, 1))
    return false;
  if (typeof value.completed !== "boolean") return false;
  for (const [index, item] of value.imports.entries()) {
    if (item.sequenceIndex !== index) return false;
    const expectedCorpus = value.phase === "preflight" ? value.corpus : SEQUENCE[index];
    if (!validCorpus(expectedCorpus) || item.corpus !== expectedCorpus) return false;
  }
  return true;
}

export function decodeNerGapsReport(value: unknown, expectedRunId: string): NerGapsReport | null {
  return isDecodedNerGapsReport(value, expectedRunId) ? value : null;
}

export function decodeNerGapsThreadObservation(
  value: unknown,
  expectedArm: NerGapsArm,
): NerGapsThreadObservation | null {
  if (
    !record(value) ||
    value.runId !== `${expectedArm}-P1-r0` ||
    value.phase !== "threads" ||
    value.profile !== "P1"
  )
    return null;
  const requestedThreads = expectedArm === "A" ? "automatic" : Number(expectedArm);
  if (value.requestedThreads !== requestedThreads || !record(value.observedThreads)) return null;
  const effectiveThreads = value.observedThreads.effectiveThreads;
  if (!integerAtLeast(effectiveThreads, 1)) return null;
  return { arm: expectedArm, requestedThreads, effectiveThreads };
}
