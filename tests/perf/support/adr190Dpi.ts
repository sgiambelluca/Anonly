import type { Document, Word } from "@anonly/shared";

export const SOURCE_DPIS = [150, 200, 250, 300] as const;
export const DENSITIES = ["full", "header", "two-lines", "signature"] as const;
export const ANGLES = [0, 90, 180, 270] as const;
export type Arm = "native" | "forced300";
export type Density = (typeof DENSITIES)[number];
export interface Cell {
  readonly sourceDpi: number;
  readonly density: Density | "blank" | "noise" | "shapes" | "region";
  readonly angle: 0 | 90 | 180 | 270;
  readonly arm: Arm;
  readonly repetition: number;
}
export function fixtureKey(cell: Cell): string {
  return `${cell.density}-${cell.sourceDpi}-${cell.angle}`;
}
export function campaignCells(
  phase: "preflight" | "quality" | "time" | "memory" | "controls",
): Cell[] {
  const result: Cell[] = [];
  const reps = phase === "time" ? 3 : 1;
  for (let repetition = 1; repetition <= reps; repetition++) {
    for (const sourceDpi of SOURCE_DPIS) {
      const densities =
        phase === "controls"
          ? (["blank", "noise", "shapes", "region"] as const)
          : phase === "preflight"
            ? (["two-lines"] as const)
            : DENSITIES;
      for (const density of densities) {
        for (const angle of phase === "preflight"
          ? ([90] as const)
          : phase === "controls"
            ? ([0] as const)
            : ANGLES) {
          for (const arm of repetition === 2
            ? (["forced300", "native"] as const)
            : (["native", "forced300"] as const)) {
            result.push({ sourceDpi, density, angle, arm, repetition });
          }
        }
      }
    }
  }
  return result;
}

/** Harness only: preserve all fields/references except the optional cap. */
export function removeDpiCaps(document: Document): Document {
  return {
    ...document,
    pages: document.pages.map((page) => {
      if (page.ocrDpiCap === undefined) return page;
      const { ocrDpiCap: _cap, ...withoutCap } = page;
      return withoutCap;
    }),
  };
}

export interface Job {
  readonly worker: number;
  readonly jobId: string;
  readonly jobType: "ocr-orient" | "ocr-page";
  readonly documentId: string;
  readonly pageIndex: number;
  readonly startedAt: number;
  finishedAt: number | null;
  readonly dpi: number | null;
  readonly orientation: number | null;
  readonly dispatchedOrientation?: number | null;
  readonly upscale: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly imageBytes: number;
  terminal: string | null;
  result: unknown;
  error: unknown;
}
export interface Capture {
  jobs: Job[];
  issues: string[];
  workers: Array<{ id: number; url: string; createdAt: number; terminatedAt: number | null }>;
  /** Test-only opt-in copy of the source image sent to the real OSD worker. */
  orientationInputs?: Array<{
    jobId: string;
    documentId: string;
    pageIndex: number;
    widthPx: number;
    heightPx: number;
    format: string;
    bytesBase64: string;
  }>;
  /** Optional test-only copy of the exact OCR payload before transferring its raster buffer. */
  ocrPageInputs?: Array<{
    jobId: string;
    documentId: string;
    pageIndex: number;
    dpi: number | null;
    sourceOrientation: number | null;
    dispatchedOrientation: number | null;
    widthPx: number;
    heightPx: number;
    format: string;
    bytesBase64: string;
  }>;
}
export interface OrientationVerdict {
  readonly orientation: 0 | 90 | 180 | 270;
  readonly inkRatio: number;
}
export function decodeVerdict(value: unknown): OrientationVerdict {
  if (typeof value !== "object" || value === null) throw new Error("orientation result missing");
  const result = value as { orientation?: unknown; inkRatio?: unknown };
  const angle = result.orientation;
  const ink = result.inkRatio;
  if (
    (angle !== 0 && angle !== 90 && angle !== 180 && angle !== 270) ||
    typeof ink !== "number" ||
    !Number.isFinite(ink) ||
    ink < 0 ||
    ink > 1
  )
    throw new Error("invalid orientation result");
  return { orientation: angle, inkRatio: ink };
}
export function decodeWords(value: unknown): ReadonlyArray<Word> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("words" in value) ||
    !Array.isArray(value.words)
  )
    throw new Error("recognition result missing words");
  for (const word of value.words) {
    if (
      typeof word !== "object" ||
      word === null ||
      typeof word.text !== "string" ||
      !Number.isFinite(word.confidence) ||
      word.confidence < 0 ||
      word.confidence > 1 ||
      word.source !== "ocr" ||
      !Number.isInteger(word.pageIndex) ||
      typeof word.bbox !== "object" ||
      word.bbox === null ||
      ![word.bbox.x, word.bbox.y, word.bbox.width, word.bbox.height].every(
        (n: unknown) => typeof n === "number" && Number.isFinite(n),
      )
    )
      throw new Error("invalid recognition word");
  }
  // All public Word fields consumed by this instrument were checked above.
  return value.words as ReadonlyArray<Word>;
}
export function validateCapture(capture: Capture): void {
  if (capture.issues.length) throw new Error(capture.issues.join("; "));
  if (!capture.jobs.length) throw new Error("no real OCR dispatch observed");
  const ids = new Set<string>();
  const pageJobs = new Map<string, Job[]>();
  for (const job of capture.jobs) {
    const key = `${job.worker}:${job.jobId}:${job.startedAt}`;
    if (ids.has(key)) throw new Error("duplicate transport observation");
    ids.add(key);
    if (job.finishedAt === null || job.terminal === null) throw new Error("unsettled observed job");
    if (job.finishedAt < job.startedAt) throw new Error("negative job duration");
    if (job.terminal !== "COMPLETED" && job.terminal !== "FAILED" && job.terminal !== "CANCELLED")
      throw new Error(`invalid terminal state ${job.terminal}`);
    const pageKey = `${job.documentId}:${job.pageIndex}`;
    const page = pageJobs.get(pageKey) ?? [];
    page.push(job);
    pageJobs.set(pageKey, page);
    if (job.terminal === "COMPLETED") {
      if (job.jobType === "ocr-orient") decodeVerdict(job.result);
      else decodeWords(job.result);
    }
  }
  for (const [pageKey, jobs] of pageJobs) {
    const orientations = jobs.filter((job) => job.jobType === "ocr-orient");
    const recognitions = jobs.filter((job) => job.jobType === "ocr-page");
    if (!orientations.length) throw new Error(`page ${pageKey} has no ocr-orient dispatch`);
    if (!recognitions.length) throw new Error(`page ${pageKey} has no ocr-page dispatch`);
    if (!orientations.some((job) => job.terminal === "COMPLETED"))
      throw new Error(`page ${pageKey} has no completed ocr-orient result`);
    if (!recognitions.some((job) => job.terminal === "COMPLETED"))
      throw new Error(`page ${pageKey} has no completed ocr-page result`);
    for (const failed of jobs.filter(
      (job) => job.terminal === "FAILED" || job.terminal === "CANCELLED",
    )) {
      const completedStage = jobs.some(
        (candidate) => candidate.jobType === failed.jobType && candidate.terminal === "COMPLETED",
      );
      const completedFinalReading = jobs.some(
        (candidate) => candidate.jobType === "ocr-page" && candidate.terminal === "COMPLETED",
      );
      if (!completedStage && !completedFinalReading)
        throw new Error(
          `page ${pageKey} has unreconciled ${failed.terminal} ${failed.jobType} job`,
        );
    }
  }
}

/** Validate every real page dispatch, including failed transport attempts. */
export function validateCampaignPage(
  capture: Capture,
  pageIndex: number,
  expectedDpi: number,
): void {
  validateCapture(capture);
  const recognitions = capture.jobs.filter(
    (job) => job.jobType === "ocr-page" && job.pageIndex === pageIndex,
  );
  if (!recognitions.length) throw new Error(`page ${pageIndex} has no ocr-page dispatch`);
  if (recognitions.some((job) => job.dpi !== expectedDpi))
    throw new Error(`page ${pageIndex} recognition DPI differs from selected arm`);
}
/** JobId is stable across pool retries; new host steps receive new jobIds. */
export function classifyJobs(jobs: ReadonlyArray<Job>) {
  const seen = new Set<string>();
  return jobs.map((job) => {
    const transportRetry = seen.has(job.jobId);
    seen.add(job.jobId);
    return {
      ...job,
      transportRetry,
      durationMs: job.finishedAt === null ? null : job.finishedAt - job.startedAt,
    };
  });
}
export const NORMALIZATION =
  "NFC; lower case; remove combining diacritics; alphanumeric tokens, dotted digit groups retained and dots stripped; multiset exact matching";
export function tokens(text: string): string[] {
  return (
    text
      .normalize("NFC")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[\p{L}\p{N}]+(?:\.[0-9]+)*/gu) ?? []
  ).map((token) => token.replace(/\./g, ""));
}
export function scoreReading(
  expectedText: string,
  words: ReadonlyArray<Word>,
  dniValues: ReadonlyArray<string>,
  expectedDni: string | null,
) {
  const expected = tokens(expectedText);
  const observed = words.flatMap((word) => tokens(word.text));
  const counts = new Map<string, number>();
  expected.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));
  let matches = 0;
  for (const token of observed) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      matches++;
      counts.set(token, remaining - 1);
    }
  }
  const reliable = words.some((word) => word.confidence >= 0.6);
  const dniRecovered =
    expectedDni === null
      ? null
      : dniValues.some((value) => value.replace(/\D/g, "") === expectedDni.replace(/\D/g, ""));
  return {
    expectedTokens: expected,
    observedTokens: observed,
    matchedTokens: matches,
    tokenRecall: expected.length ? matches / expected.length : null,
    tokenPrecision: observed.length ? matches / observed.length : null,
    reliable,
    reliableNoTrueTokens: reliable && matches === 0,
    falseTokens: observed.length - matches,
    reliableExtraTokens: reliable && observed.length > matches,
    reliableMissingDni: expectedDni !== null && reliable && !dniRecovered,
    dniRecovered,
    reliableWordsWithoutText: expected.length === 0 && reliable,
    nameTokenRecall:
      expectedDni === null
        ? null
        : tokens("Juan Perez").filter((token) => observed.includes(token)).length / 2,
  };
}

/** Empty controls have no recall/precision denominator; only spurious tokens matter. */
export function hasQualityFailure(quality: ReturnType<typeof scoreReading>): boolean {
  if (quality.expectedTokens.length === 0)
    return quality.falseTokens > 0 || quality.reliableWordsWithoutText;
  return (
    quality.tokenRecall !== 1 ||
    quality.tokenPrecision !== 1 ||
    quality.dniRecovered === false ||
    quality.reliableWordsWithoutText
  );
}
