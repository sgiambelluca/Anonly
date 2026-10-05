export interface ReadableForcedTargetRow {
  readonly id: string;
  readonly truthCount: number;
  readonly sourceReadable: boolean;
  readonly forcedOcr: {
    readonly truthFoundCount: number;
    readonly truthMissingCount: number;
    readonly inconclusive: boolean;
  } | null;
}

export interface ReadableForcedTargetSummary {
  readonly readableSourceCount: number;
  readonly attemptedCount: number;
  readonly recoveredCount: number;
  readonly missCaseIds: ReadonlyArray<string>;
  readonly inconclusiveCaseIds: ReadonlyArray<string>;
  readonly noForcedOcrCaseIds: ReadonlyArray<string>;
}

/** Scores only rows that actually produced an isolated forced-OCR result. */
export function summarizeReadableForcedTargets(
  rows: ReadonlyArray<ReadableForcedTargetRow>,
): ReadableForcedTargetSummary {
  const readable = rows.filter((row) => row.truthCount > 0 && row.sourceReadable);
  const attempted = readable.filter((row) => row.forcedOcr !== null);
  return {
    readableSourceCount: readable.length,
    attemptedCount: attempted.length,
    recoveredCount: attempted.filter((row) => row.forcedOcr?.truthFoundCount === row.truthCount)
      .length,
    missCaseIds: attempted
      .filter((row) => (row.forcedOcr?.truthMissingCount ?? 0) > 0)
      .map((row) => row.id),
    inconclusiveCaseIds: attempted
      .filter((row) => row.forcedOcr?.inconclusive)
      .map((row) => row.id),
    noForcedOcrCaseIds: readable.filter((row) => row.forcedOcr === null).map((row) => row.id),
  };
}
