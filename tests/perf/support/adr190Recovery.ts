import type { Capture, Job } from "./adr190Dpi.js";
import { hashBytes } from "./adr190Fixtures.js";

export type CapturedOcrPageInput = NonNullable<Capture["ocrPageInputs"]>[number];

export interface OcrAttempt {
  readonly job: Job;
  readonly input: Omit<CapturedOcrPageInput, "bytesBase64">;
  readonly imageSha256: string;
}

/** Join every real OCR dispatch to its pre-transfer raster, retaining retries in order. */
export function correlateOcrAttempts(capture: Capture): OcrAttempt[] {
  const jobs = capture.jobs
    .filter((job) => job.jobType === "ocr-page")
    .sort((a, b) => a.startedAt - b.startedAt || a.jobId.localeCompare(b.jobId));
  const inputs = capture.ocrPageInputs ?? [];
  if (jobs.length !== inputs.length)
    throw new Error(
      `OCR input count mismatch: ${jobs.length} dispatches / ${inputs.length} rasters`,
    );
  const seen = new Set<string>();
  return jobs.map((job) => {
    if (seen.has(job.jobId)) throw new Error(`duplicate OCR dispatch ${job.jobId}`);
    seen.add(job.jobId);
    const matches = inputs.filter((input) => input.jobId === job.jobId);
    if (matches.length !== 1) throw new Error(`OCR raster missing or ambiguous ${job.jobId}`);
    const input = matches[0]!;
    if (
      input.dpi !== job.dpi ||
      input.sourceOrientation !== job.orientation ||
      input.dispatchedOrientation !== job.dispatchedOrientation ||
      input.widthPx !== job.widthPx ||
      input.heightPx !== job.heightPx ||
      Buffer.from(input.bytesBase64, "base64").byteLength !== job.imageBytes
    )
      throw new Error(`OCR raster metadata differs from dispatched job ${job.jobId}`);
    return {
      job,
      input: {
        jobId: input.jobId,
        documentId: input.documentId,
        pageIndex: input.pageIndex,
        dpi: input.dpi,
        sourceOrientation: input.sourceOrientation,
        dispatchedOrientation: input.dispatchedOrientation,
        widthPx: input.widthPx,
        heightPx: input.heightPx,
        format: input.format,
      },
      imageSha256: hashBytes(Buffer.from(input.bytesBase64, "base64")),
    };
  });
}

export function firstOcrAttempt(attempts: ReadonlyArray<OcrAttempt>): OcrAttempt | null {
  return attempts[0] ?? null;
}

export function dispatchedOrientationForPage(
  seenPages: Set<string>,
  documentId: string,
  pageIndex: number,
  sourceOrientation: number | null,
  forcedOrientation: 0 | 90 | 180 | 270 | undefined,
): number | null {
  const key = `${documentId}:${pageIndex}`;
  const shouldForce = forcedOrientation !== undefined && !seenPages.has(key);
  seenPages.add(key);
  return shouldForce ? forcedOrientation : sourceOrientation;
}

export interface RankingCandidate {
  readonly mode: "production-osd" | "forced";
  readonly requestedAngle: number | null;
  readonly angle: number | null;
  readonly reliableWordCount: number;
  readonly pageConfidence: number | null;
}

export function summarizeReliableWordEvidence(
  attempts: ReadonlyArray<ReadonlyArray<{ readonly confidence: number }>>,
  finalWords: ReadonlyArray<{ readonly confidence: number }>,
) {
  const countReliable = (words: ReadonlyArray<{ readonly confidence: number }>) =>
    words.filter((word) => word.confidence >= 0.6).length;
  const attemptReliableWordCounts = attempts.map(countReliable);
  const firstAttemptReliableWords = attemptReliableWordCounts[0] ?? 0;
  const maxAttemptReliableWords = Math.max(0, ...attemptReliableWordCounts);
  const finalReliableWords = countReliable(finalWords);
  return {
    firstAttemptReliableWords,
    attemptReliableWordCounts,
    anyAttemptReliableWords: attemptReliableWordCounts.some((count) => count > 0),
    maxAttemptReliableWords,
    finalReliableWords,
    anyFinalReliableWords: finalReliableWords > 0,
    anyAttemptOrFinalReliableWords:
      attemptReliableWordCounts.some((count) => count > 0) || finalReliableWords > 0,
  };
}

export function collectInstrumentFailures(
  observations: ReadonlyArray<{
    readonly key: string;
    readonly angle: number | null;
    readonly issues: ReadonlyArray<string>;
  }>,
) {
  return observations.flatMap((observation) =>
    observation.issues.map((issue) => ({
      key: observation.key,
      angle: observation.angle,
      issue,
    })),
  );
}

export function rankCandidates(
  candidates: ReadonlyArray<RankingCandidate>,
  mode: "current" | "page-confidence-first",
): RankingCandidate[] {
  return [...candidates].sort((a, b) => {
    const confidenceFirst = mode === "page-confidence-first";
    const confidenceDelta = (b.pageConfidence ?? -1) - (a.pageConfidence ?? -1);
    const wordDelta = b.reliableWordCount - a.reliableWordCount;
    return confidenceFirst ? confidenceDelta || wordDelta : wordDelta || confidenceDelta;
  });
}

export function hasExactDniToken(
  words: ReadonlyArray<{ readonly text: string }>,
  expectedDni: string,
): boolean {
  const expected = expectedDni.replace(/\D/g, "");
  return words.some((word) => word.text.replace(/\D/g, "") === expected);
}

export function firstReadingMatchesQuality(
  actual: {
    readonly words: unknown;
    readonly rawOrientation: unknown;
    readonly rawConfidence: unknown;
    readonly rawError: unknown;
    readonly inkRatio: unknown;
    readonly productionOrientation: unknown;
  },
  baseline: {
    readonly words: unknown;
    readonly rawOrientation: unknown;
    readonly rawConfidence: unknown;
    readonly rawError: unknown;
    readonly inkRatio: unknown;
    readonly productionOrientation: unknown;
  },
) {
  const wordsMatch = JSON.stringify(actual.words) === JSON.stringify(baseline.words);
  const rawOrientationMatch = actual.rawOrientation === baseline.rawOrientation;
  const rawConfidenceMatch = actual.rawConfidence === baseline.rawConfidence;
  const rawErrorMatch = actual.rawError === baseline.rawError;
  const inkRatioMatch = actual.inkRatio === baseline.inkRatio;
  const productionOrientationMatch =
    actual.productionOrientation === baseline.productionOrientation;
  return {
    wordsMatch,
    rawOrientationMatch,
    rawConfidenceMatch,
    rawErrorMatch,
    inkRatioMatch,
    productionOrientationMatch,
    matches:
      wordsMatch &&
      rawOrientationMatch &&
      rawConfidenceMatch &&
      rawErrorMatch &&
      inkRatioMatch &&
      productionOrientationMatch,
  };
}
