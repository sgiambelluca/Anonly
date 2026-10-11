/** M-V1 identity, matrix and validation. No document content belongs here. */
import type { RunReport } from "./memoryProfile.js";

export const V1_DOCS = ["R1", "R4", "digital10", "digital50", "scan10", "scan50"] as const;
export type V1Doc = (typeof V1_DOCS)[number];
export const V1_PRESETS = ["low", "medium"] as const;
export type V1Preset = (typeof V1_PRESETS)[number];
export const V1_PAGES: Readonly<Record<V1Doc, number>> = {
  R1: 20,
  R4: 51,
  digital10: 10,
  digital50: 50,
  scan10: 10,
  scan50: 50,
};
export interface V1Id {
  readonly doc: V1Doc;
  readonly preset: V1Preset;
  readonly repetition: number;
}
export interface V1ImportSnapshot {
  readonly parsedPageIndices: ReadonlyArray<number>;
  readonly requiresOcrPageIndices: ReadonlyArray<number>;
  readonly completedOcrPageIndices: ReadonlyArray<number>;
  readonly unreadableInkPageIndices: ReadonlyArray<number>;
  readonly failedOcrPageIndices: ReadonlyArray<number>;
  readonly pipelineFailed: boolean;
  readonly conflictCount: number | null;
  readonly pageCount: number | null;
  readonly words: number | null;
}
export interface V1Import {
  readonly report: RunReport;
  readonly snapshot: V1ImportSnapshot;
}
export interface V1Export {
  readonly durationMs: number;
  readonly wallDurationMs: number;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly pages: number;
  readonly imageFormat: "jpeg" | "png";
  readonly jpegQuality: number;
  readonly dpi: number;
  readonly includeMarkerLegend: boolean;
  readonly coveredPages: ReadonlyArray<number>;
  readonly noGroupsConfirmationShown: boolean;
  readonly unreadableConfirmationShown: boolean;
}
export type V1ConflictPreparationStatus =
  | "not-needed"
  | "prepared"
  | "blocked-held-manual"
  | "blocked-default-inconsistent"
  | "blocked-timeout";
export interface V1ConflictPreparation {
  readonly status: V1ConflictPreparationStatus;
  readonly durationMs: number;
  readonly pendingBefore: number;
  readonly pendingAfter: number;
  readonly resolvedCount: number;
  readonly heldManualCount: number;
  readonly defaultInconsistentCount: number;
  readonly groupCount: number;
  readonly groupInvariantsPreserved: boolean;
  readonly conflictInvariantsPreserved: boolean;
  readonly exportEnabled: boolean;
}
export interface V1Run extends V1Id {
  readonly schema: 1;
  readonly capturedAtUtc: string;
  readonly batchId: string;
  readonly fixtureSha256: string;
  readonly fixtureBytes: number;
  readonly sourcePages: number;
  readonly original: V1Import | null;
  readonly exported: V1Export | null;
  readonly reimport: V1Import | null;
  readonly conflictPreparation: V1ConflictPreparation | null;
  readonly failedAt: "original" | "conflicts" | "export" | "reimport" | null;
  readonly failureKind: "product" | "instrument" | "blocked" | null;
  readonly errorName: string | null;
  readonly issues: ReadonlyArray<string>;
}
export function v1Key(id: V1Id): string {
  return `${id.doc}-${id.preset}-r${id.repetition}`;
}
export function v1Plan(docs: ReadonlyArray<V1Doc> = V1_DOCS): ReadonlyArray<V1Id> {
  return docs.flatMap((doc) =>
    V1_PRESETS.flatMap((preset) => [1, 2, 3].map((repetition) => ({ doc, preset, repetition }))),
  );
}
export function importIssues(value: V1Import, pages: number, allOcr: boolean): string[] {
  const issues: string[] = [];
  const { report, snapshot } = value;
  const failed = importProductFailed(value);
  if (
    !failed &&
    (report.readyDurationMs === null ||
      report.readyDurationMs === undefined ||
      report.phases.PIPELINE_READY === undefined ||
      report.phases.DOCUMENT_IMPORTED === undefined)
  )
    issues.push("ready-timing-missing");
  if (report.samples.length === 0 || (!failed && report.peakSumBytes === null))
    issues.push("M2-missing");
  const expectedIndices = Array.from({ length: pages }, (_, index) => index);
  const completePages = (indices: ReadonlyArray<number>): boolean =>
    indices.length === pages &&
    indices.every((index, position) => index === expectedIndices[position]);
  if (!failed && (snapshot.pageCount !== pages || !completePages(snapshot.parsedPageIndices)))
    issues.push("page-count-mismatch");
  if (
    !failed &&
    ((allOcr &&
      (!completePages(snapshot.requiresOcrPageIndices) ||
        !completePages(snapshot.completedOcrPageIndices))) ||
      snapshot.requiresOcrPageIndices.some(
        (index) => !snapshot.completedOcrPageIndices.includes(index),
      ))
  )
    issues.push("ocr-page-coverage-incomplete");
  if ((report.ocrWords?.length ?? 0) > 0) issues.push("privacy-ocr-words-captured");
  return issues;
}
export function importProductFailed(value: V1Import): boolean {
  return (
    !value.report.ok ||
    value.snapshot.pipelineFailed ||
    value.snapshot.failedOcrPageIndices.length > 0
  );
}
export function checkV1(
  runs: ReadonlyArray<V1Run>,
  docs: ReadonlyArray<V1Doc>,
  invalidBatchIds: ReadonlyArray<string> = [],
) {
  const expected = new Set(v1Plan(docs).map(v1Key));
  const seen = new Map<string, number>();
  const identities = new Map<V1Doc, string>();
  const issues: string[] = [];
  const invalidRuns: string[] = [];
  for (const run of runs) {
    const key = v1Key(run);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!expected.has(key)) issues.push(`${key}: unexpected`);
    const previous = identities.get(run.doc);
    if (previous !== undefined && previous !== run.fixtureSha256)
      issues.push(`${key}: fixture-identity-mismatch`);
    identities.set(run.doc, run.fixtureSha256);
    if (run.sourcePages !== V1_PAGES[run.doc]) issues.push(`${key}: source-pages-mismatch`);
    if (invalidBatchIds.includes(run.batchId)) invalidRuns.push(key);
    for (const issue of run.issues) issues.push(`${key}: ${issue}`);
    if (run.conflictPreparation !== null) {
      const preparation = run.conflictPreparation;
      if (
        !Number.isFinite(preparation.durationMs) ||
        preparation.durationMs < 0 ||
        [
          preparation.pendingBefore,
          preparation.pendingAfter,
          preparation.resolvedCount,
          preparation.heldManualCount,
          preparation.defaultInconsistentCount,
          preparation.groupCount,
        ].some((count) => !Number.isInteger(count) || count < 0) ||
        preparation.pendingBefore - preparation.pendingAfter !== preparation.resolvedCount
      )
        issues.push(`${key}: conflict-preparation-counts-invalid`);
      if (
        preparation.status === "prepared" &&
        (preparation.pendingAfter !== 0 ||
          !preparation.exportEnabled ||
          !preparation.groupInvariantsPreserved ||
          !preparation.conflictInvariantsPreserved)
      )
        issues.push(`${key}: conflict-preparation-not-ready`);
      if (
        preparation.status === "not-needed" &&
        (preparation.pendingBefore !== 0 ||
          preparation.pendingAfter !== 0 ||
          preparation.resolvedCount !== 0)
      )
        issues.push(`${key}: conflict-preparation-not-needed-invalid`);
    }
    if (
      run.failedAt === "conflicts" &&
      (run.original === null ||
        run.exported !== null ||
        run.reimport !== null ||
        run.conflictPreparation === null ||
        !["blocked-held-manual", "blocked-default-inconsistent", "blocked-timeout"].includes(
          run.conflictPreparation.status,
        ) ||
        run.failureKind !==
          (run.conflictPreparation.status === "blocked-held-manual" ? "blocked" : "instrument"))
    )
      issues.push(`${key}: conflict-preparation-outcome-incomplete`);
    if (run.failureKind === "instrument") issues.push(`${key}: instrument-failed-${run.failedAt}`);
    if (run.failureKind === "blocked")
      issues.push(
        `${key}: conflict-preparation-blocked-${run.conflictPreparation?.status ?? "unknown"}`,
      );
    if ((run.failedAt === null) !== (run.failureKind === null))
      issues.push(`${key}: failure-classification-mismatch`);
    if (run.fixtureSha256.length === 0 || run.fixtureBytes <= 0 || run.batchId.length === 0)
      issues.push(`${key}: record-identity-incomplete`);
    if (run.failureKind === "blocked" && run.failedAt !== "conflicts")
      issues.push(`${key}: blocked-outcome-stage-invalid`);
    if (run.failureKind === "product") {
      if (
        run.failedAt === "original" &&
        (run.original === null ||
          !importProductFailed(run.original) ||
          run.exported !== null ||
          run.reimport !== null)
      )
        issues.push(`${key}: original-failed-outcome-incomplete`);
      if (
        run.failedAt === "export" &&
        (run.original === null ||
          importProductFailed(run.original) ||
          run.exported !== null ||
          run.reimport !== null)
      )
        issues.push(`${key}: export-failed-outcome-incomplete`);
      if (
        run.failedAt === "reimport" &&
        (run.original === null ||
          run.exported === null ||
          run.reimport === null ||
          !importProductFailed(run.reimport))
      )
        issues.push(`${key}: reimport-failed-outcome-incomplete`);
    }
    if (run.original !== null) {
      for (const issue of importIssues(
        run.original,
        run.sourcePages,
        run.doc === "R1" || run.doc.startsWith("scan"),
      ))
        issues.push(`${key}: original/${issue}`);
      if (importProductFailed(run.original) && run.failedAt !== "original")
        issues.push(`${key}: original-failure-declared-successful`);
    }
    if (run.reimport !== null) {
      for (const issue of importIssues(run.reimport, run.exported?.pages ?? run.sourcePages, true))
        issues.push(`${key}: reimport/${issue}`);
      if (importProductFailed(run.reimport) && run.failedAt !== "reimport")
        issues.push(`${key}: reimport-failure-declared-successful`);
    }
    if (run.failedAt === null) {
      if (run.original === null || run.exported === null || run.reimport === null)
        issues.push(`${key}: incomplete-success-record`);
      else {
        if (
          run.conflictPreparation === null ||
          !["prepared", "not-needed"].includes(run.conflictPreparation.status)
        )
          issues.push(`${key}: conflict-preparation-missing`);
        if (run.exported.pages !== run.sourcePages || run.exported.sizeBytes <= 0)
          issues.push(`${key}: export-pages-or-bytes-mismatch`);
      }
    }
  }
  const missing = [...expected].filter((key) => !seen.has(key));
  const duplicates = [...seen].filter(([, count]) => count > 1).map(([key]) => key);
  return {
    expectedRuns: expected.size,
    recordedRuns: runs.length,
    complete:
      missing.length === 0 &&
      duplicates.length === 0 &&
      issues.length === 0 &&
      invalidRuns.length === 0,
    missing,
    duplicates,
    issues,
    invalidRuns,
    failedRuns: runs
      .filter((run) => run.failedAt !== null)
      .map((run) => ({
        id: v1Key(run),
        stage: run.failedAt,
        kind: run.failureKind,
        errorName: run.errorName,
      })),
  };
}
export function spread(values: ReadonlyArray<number | null | undefined>) {
  const sorted = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    values: sorted,
    min: sorted[0] ?? null,
    median:
      sorted.length === 0
        ? null
        : sorted.length % 2 === 1
          ? (sorted[middle] ?? null)
          : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2,
    max: sorted.at(-1) ?? null,
  };
}
export function summarizeV1(
  runs: ReadonlyArray<V1Run>,
  docs: ReadonlyArray<V1Doc>,
  invalidBatchIds: ReadonlyArray<string> = [],
) {
  const check = checkV1(runs, docs, invalidBatchIds);
  const valid = runs.filter(
    (run) =>
      !check.invalidRuns.includes(v1Key(run)) &&
      run.failedAt === null &&
      run.issues.length === 0 &&
      !check.issues.some((issue) => issue.startsWith(`${v1Key(run)}:`)),
  );
  const cells = V1_DOCS.filter((doc) => docs.includes(doc)).flatMap((doc) =>
    V1_PRESETS.map((preset) => {
      const values = valid.filter((run) => run.doc === doc && run.preset === preset);
      return {
        doc,
        preset,
        pages: V1_PAGES[doc],
        successfulRuns: values.length,
        originalReadyMs: spread(values.map((run) => run.original?.report.readyDurationMs)),
        originalOcrMs: spread(values.map((run) => run.original?.report.ocrDurationMs)),
        originalM2Bytes: spread(values.map((run) => run.original?.report.peakSumBytes)),
        originalPostReadyBytes: spread(
          values.map((run) => run.original?.report.postReadyPeakBytes),
        ),
        exportMs: spread(values.map((run) => run.exported?.durationMs)),
        exportBytes: spread(values.map((run) => run.exported?.sizeBytes)),
        reimportReadyMs: spread(values.map((run) => run.reimport?.report.readyDurationMs)),
        reimportOcrMs: spread(values.map((run) => run.reimport?.report.ocrDurationMs)),
        reimportM2Bytes: spread(values.map((run) => run.reimport?.report.peakSumBytes)),
        reimportPostReadyBytes: spread(
          values.map((run) => run.reimport?.report.postReadyPeakBytes),
        ),
        originalWarnings: values.map(
          (run) => run.original?.snapshot.unreadableInkPageIndices.length ?? null,
        ),
        reimportWarnings: values.map(
          (run) => run.reimport?.snapshot.unreadableInkPageIndices.length ?? null,
        ),
        coveredPages: values.map((run) => run.exported?.coveredPages.length ?? null),
      };
    }),
  );
  return { check, cells };
}
