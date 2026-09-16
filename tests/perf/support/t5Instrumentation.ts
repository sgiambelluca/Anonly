import { createHash } from "node:crypto";
import { mkdir, access } from "node:fs/promises";

import type { Word } from "@anonly/shared";

export interface T5WorkerEvent {
  readonly type: string;
  readonly atMs: number;
  readonly delta: 1 | -1;
}

export interface T5WorkerTopology {
  readonly lstmPeak: number;
  readonly orientationPeak: number;
  readonly lstmJobs: number;
  readonly orientationJobs: number;
  /** Distinct CDP worker parent instances, when a target map is supplied. */
  readonly lstmInstances?: number;
  readonly orientationInstances?: number;
  /** Distinct Tesseract child targets, separate from pool parent instances. */
  readonly tesseractLstmInstances?: number;
  readonly tesseractOrientationInstances?: number;
}

export interface T5TopologyTarget {
  readonly sessionId: string;
  readonly label: string;
  readonly workerRole: "lstm" | "orientation" | "unknown";
}

export interface T5QualityFingerprint {
  readonly sha256: string;
  readonly pages: number;
  readonly words: number;
}

export interface T5QualityPage {
  readonly pageIndex: number;
  readonly wordCount: number;
  readonly confidence: number;
}

export type T5CampaignCondition = "A" | "B" | "C";
export type T5CampaignStage = "AB" | "BC";

export function peakSimultaneous(events: ReadonlyArray<T5WorkerEvent>, type: string): number {
  let current = 0;
  let peak = 0;
  for (const event of [...events]
    .filter((entry) => entry.type === type)
    .sort((a, b) => a.atMs - b.atMs)) {
    current = Math.max(0, current + event.delta);
    peak = Math.max(peak, current);
  }
  return peak;
}

export function countJobs(events: ReadonlyArray<T5WorkerEvent>, type: string): number {
  return events.filter((event) => event.type === type && event.delta === 1).length;
}

export function classifyTopology(
  events: ReadonlyArray<T5WorkerEvent>,
  targets: ReadonlyArray<T5TopologyTarget> = [],
): T5WorkerTopology {
  const parents = new Map<string, "lstm" | "orientation">();
  for (const target of targets) {
    if (target.label.includes("/")) continue;
    if (target.workerRole === "lstm" || target.workerRole === "orientation") {
      parents.set(target.sessionId, target.workerRole);
    }
  }
  return {
    lstmPeak: peakSimultaneous(events, "ocr-page"),
    orientationPeak: peakSimultaneous(events, "ocr-orient"),
    lstmJobs: countJobs(events, "ocr-page"),
    orientationJobs: countJobs(events, "ocr-orient"),
    ...(targets.length > 0
      ? {
          lstmInstances: [...parents.values()].filter((role) => role === "lstm").length,
          orientationInstances: [...parents.values()].filter((role) => role === "orientation")
            .length,
          tesseractLstmInstances: targets.filter((target) =>
            target.label.includes("/tesseract-lstm"),
          ).length,
          tesseractOrientationInstances: targets.filter((target) =>
            target.label.includes("/tesseract-osd"),
          ).length,
        }
      : {}),
  };
}

export function qualityFingerprint(
  pages: ReadonlyArray<ReadonlyArray<Word>>,
): T5QualityFingerprint {
  const canonical = [...pages]
    .sort((left, right) => (left[0]?.pageIndex ?? -1) - (right[0]?.pageIndex ?? -1))
    .map((words) =>
      words.map((word) => ({
        text: word.text,
        source: word.source,
        pageIndex: word.pageIndex,
        confidence: word.confidence,
        bbox: {
          x: word.bbox.x,
          y: word.bbox.y,
          width: word.bbox.width,
          height: word.bbox.height,
          rotation: word.bbox.rotation ?? null,
        },
      })),
    );
  const bytes = Buffer.from(JSON.stringify(canonical), "utf8");
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pages: pages.length,
    words: pages.reduce((total, words) => total + words.length, 0),
  };
}

/** Huella de la señal OCR pública cuando no se expone el detalle de palabras al bus. */
export function qualitySummaryFingerprint(
  pages: ReadonlyArray<T5QualityPage>,
): T5QualityFingerprint {
  const canonical = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const bytes = Buffer.from(JSON.stringify(canonical), "utf8");
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pages: canonical.length,
    words: canonical.reduce((total, page) => total + page.wordCount, 0),
  };
}

export async function createUniqueOutputDir(path: string): Promise<void> {
  await access(path).then(
    () => {
      throw new Error(`T5 output directory already exists: ${path}`);
    },
    () => undefined,
  );
  await mkdir(path, { recursive: true });
}

export function requireT5Environment(env: NodeJS.ProcessEnv): {
  readonly fixture: string;
  readonly outputDir: string;
  readonly condition: T5CampaignCondition;
  readonly stage: T5CampaignStage;
  readonly pair: number;
  readonly factoryChunks: string;
} {
  const fixture = env.ANONLY_T5_FIXTURE;
  const outputDir = env.ANONLY_T5_OUTPUT_DIR;
  const condition = env.ANONLY_T5_CONDITION;
  const stage = env.ANONLY_T5_STAGE;
  const pair = Number(env.ANONLY_T5_PAIR);
  const factoryChunks = env.ANONLY_T5_FACTORY_CHUNKS;
  if (
    fixture === undefined ||
    outputDir === undefined ||
    (condition !== "A" && condition !== "B" && condition !== "C") ||
    (stage !== "AB" && stage !== "BC") ||
    !Number.isInteger(pair) ||
    pair < 1 ||
    pair > 3 ||
    factoryChunks === undefined
  ) {
    throw new Error(
      "ANONLY_T5_FIXTURE, ANONLY_T5_OUTPUT_DIR, ANONLY_T5_STAGE, ANONLY_T5_CONDITION, ANONLY_T5_PAIR and ANONLY_T5_FACTORY_CHUNKS are required",
    );
  }
  return { fixture, outputDir, condition, stage, pair, factoryChunks };
}
