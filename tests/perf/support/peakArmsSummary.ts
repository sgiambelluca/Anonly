import { createHash } from "node:crypto";

/**
 * Campaña de reducción de pico: resumen del A/B de `run-peak-ab.sh`, un brazo
 * de control contra uno candidato (`peakArmsTransform.ts`). Función pura sobre
 * los reportes de `memoryProfile.ts` (un `ProfileReport` por corrida, con su
 * corrida fría y su caliente). No promedia fallos: una corrida que no llegó a
 * `Ready` se cuenta aparte y no entra en las medianas.
 */

export interface RunPhaseSegment {
  readonly fromEvent: string;
  readonly toEvent: string;
  readonly peakInternalBytes: number | null;
}

export interface RunRecordInput {
  readonly ok: boolean;
  readonly peakSumBytes: number;
  readonly baselineBytes: number;
  readonly postReadyPeakBytes: number | null;
  readonly readyDurationMs: number;
  readonly groupCount: number;
  readonly entityCount: number;
  readonly processPeakRssBytes: Readonly<Record<string, number>>;
  readonly phaseSegments: ReadonlyArray<RunPhaseSegment>;
  readonly ocrWords?: ReadonlyArray<{
    readonly pageIndex: number;
    readonly words: ReadonlyArray<{ readonly text: string }>;
  }>;
}

export interface ProfileReportInput {
  readonly cold: RunRecordInput;
  readonly hot: RunRecordInput;
}

export interface LabeledReport {
  /** Ronda ABBA a la que pertenece la corrida (1..n). */
  readonly round: number;
  /** Nombre del brazo (`base`, `c1`, `c2`, `head`). */
  readonly arm: string;
  readonly report: ProfileReportInput;
}

export interface TemperatureRow {
  readonly ok: boolean;
  readonly peakMb: number;
  readonly parsePeakMb: number | null;
  readonly ocrPeakMb: number | null;
  readonly tabPeakMb: number | null;
  readonly postReadyPeakMb: number | null;
  readonly baselineMb: number;
  readonly readyMs: number;
  readonly groupCount: number;
  readonly entityCount: number;
  readonly ocrTextSha256: string;
}

export interface ArmSummary {
  readonly runs: number;
  readonly failed: number;
  readonly medianPeakMb: number | null;
  readonly medianParsePeakMb: number | null;
  readonly medianOcrPeakMb: number | null;
  readonly medianReadyMs: number | null;
  readonly ocrTextHashes: ReadonlyArray<string>;
  readonly groupCounts: ReadonlyArray<number>;
}

export interface PairedRound {
  readonly round: number;
  /** Media del candidato menos media del control dentro de la ronda (MB / ms). */
  readonly peakDeltaMb: number;
  readonly readyDeltaMs: number;
}

export interface TemperatureSummary {
  readonly control: ArmSummary;
  readonly candidate: ArmSummary;
  readonly paired: ReadonlyArray<PairedRound>;
}

export interface CampaignSummary {
  readonly controlArm: string;
  readonly candidateArm: string;
  readonly cold: TemperatureSummary;
  readonly hot: TemperatureSummary;
  /** Verdadero si los dos brazos leyeron exactamente el mismo texto de OCR en todas las corridas. */
  readonly ocrTextIdentical: boolean;
  readonly groupCountsIdentical: boolean;
}

const MB = 1_000_000;
const toMb = (bytes: number): number => Math.round((bytes / MB) * 10) / 10;

function segmentPeak(run: RunRecordInput, from: string, to: string): number | null {
  const segment = run.phaseSegments.find((s) => s.fromEvent === from && s.toEvent === to);
  return segment?.peakInternalBytes == null ? null : toMb(segment.peakInternalBytes);
}

function tabPeak(run: RunRecordInput): number | null {
  const tabs = Object.entries(run.processPeakRssBytes).filter(([key]) => key.startsWith("Tab"));
  if (tabs.length === 0) return null;
  return toMb(Math.max(...tabs.map(([, value]) => value)));
}

export function ocrTextSha256(run: RunRecordInput): string {
  const pages = [...(run.ocrWords ?? [])]
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((page) => `${page.pageIndex}:${page.words.map((w) => w.text).join(" ")}`);
  return createHash("sha256").update(pages.join("\n")).digest("hex");
}

export function toTemperatureRow(run: RunRecordInput): TemperatureRow {
  return {
    ok: run.ok,
    peakMb: toMb(run.peakSumBytes),
    parsePeakMb: segmentPeak(run, "DOCUMENT_IMPORTED", "DOCUMENT_PARSED"),
    ocrPeakMb: segmentPeak(run, "OCR_STARTED", "OCR_FINISHED"),
    tabPeakMb: tabPeak(run),
    postReadyPeakMb: run.postReadyPeakBytes == null ? null : toMb(run.postReadyPeakBytes),
    baselineMb: toMb(run.baselineBytes),
    readyMs: run.readyDurationMs,
    groupCount: run.groupCount,
    entityCount: run.entityCount,
    ocrTextSha256: ocrTextSha256(run),
  };
}

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(value * 10) / 10;
}

const mean = (values: ReadonlyArray<number>): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function summarizeArm(rows: ReadonlyArray<TemperatureRow>): ArmSummary {
  const ok = rows.filter((row) => row.ok);
  const nonNull = (values: ReadonlyArray<number | null>): number[] =>
    values.filter((value): value is number => value !== null);
  return {
    runs: rows.length,
    failed: rows.length - ok.length,
    medianPeakMb: median(ok.map((row) => row.peakMb)),
    medianParsePeakMb: median(nonNull(ok.map((row) => row.parsePeakMb))),
    medianOcrPeakMb: median(nonNull(ok.map((row) => row.ocrPeakMb))),
    medianReadyMs: median(ok.map((row) => row.readyMs)),
    ocrTextHashes: [...new Set(ok.map((row) => row.ocrTextSha256))],
    groupCounts: [...new Set(ok.map((row) => row.groupCount))],
  };
}

function pairRounds(
  labeled: ReadonlyArray<{ round: number; arm: string; row: TemperatureRow }>,
  control: string,
  candidate: string,
): PairedRound[] {
  const rounds = [...new Set(labeled.map((entry) => entry.round))].sort((a, b) => a - b);
  const paired: PairedRound[] = [];
  for (const round of rounds) {
    const inRound = labeled.filter((entry) => entry.round === round && entry.row.ok);
    const a = inRound.filter((entry) => entry.arm === control).map((entry) => entry.row);
    const b = inRound.filter((entry) => entry.arm === candidate).map((entry) => entry.row);
    if (a.length === 0 || b.length === 0) continue;
    paired.push({
      round,
      peakDeltaMb:
        Math.round((mean(b.map((r) => r.peakMb)) - mean(a.map((r) => r.peakMb))) * 10) / 10,
      readyDeltaMs: Math.round(mean(b.map((r) => r.readyMs)) - mean(a.map((r) => r.readyMs))),
    });
  }
  return paired;
}

export function summarizeCampaign(
  reports: ReadonlyArray<LabeledReport>,
  control: string,
  candidate: string,
): CampaignSummary {
  const build = (temperature: "cold" | "hot"): TemperatureSummary => {
    const labeled = reports.map((entry) => ({
      round: entry.round,
      arm: entry.arm,
      row: toTemperatureRow(entry.report[temperature]),
    }));
    return {
      control: summarizeArm(
        labeled.filter((entry) => entry.arm === control).map((entry) => entry.row),
      ),
      candidate: summarizeArm(
        labeled.filter((entry) => entry.arm === candidate).map((entry) => entry.row),
      ),
      paired: pairRounds(labeled, control, candidate),
    };
  };
  const cold = build("cold");
  const hot = build("hot");
  const arms = [cold.control, cold.candidate, hot.control, hot.candidate];
  const allHashes = new Set(arms.flatMap((arm) => arm.ocrTextHashes));
  const allGroups = new Set(arms.flatMap((arm) => arm.groupCounts));
  return {
    controlArm: control,
    candidateArm: candidate,
    cold,
    hot,
    ocrTextIdentical: allHashes.size === 1,
    groupCountsIdentical: allGroups.size === 1,
  };
}

/** `NN-r<ronda>-<brazo>-memory-...json` → ronda y brazo; `undefined` si el nombre no es de la campaña. */
export function parseRunFileName(name: string): { round: number; arm: string } | undefined {
  const match = /^\d{2}-r(\d+)-(base|c1|c2|head)-memory-.+\.json$/.exec(name);
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  return { round: Number(match[1]), arm: match[2] };
}
