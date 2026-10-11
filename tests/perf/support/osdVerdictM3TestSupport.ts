/**
 * Fábricas de corridas de M-O3 para los tests. No se usan fuera de `*.test.ts`.
 */

import type { ProfileReport, RunReport } from "./memoryProfile.js";
import {
  INK_PRESENT_RATIO,
  M3_PAGES,
  type M3Arm,
  type M3Doc,
  type M3Run,
  type M3RunSide,
} from "./osdVerdictM3.js";
import type { PageSnapshot } from "./osdVerdictM3Collector.js";

export interface PageSpec {
  readonly ink?: number;
  /** El OSD natural dio un veredicto. */
  readonly naturalVerdict?: boolean;
  /** Ángulos de los reconocimientos, en orden. */
  readonly angles?: ReadonlyArray<number>;
  /** Palabras confiables de la primera lectura. */
  readonly reliableFirst?: number;
  /** Índice del reconocimiento que entregó la cadena. */
  readonly deliveredAttempt?: number;
  readonly textHash?: string;
  readonly words?: number;
  readonly entities?: Readonly<Record<string, number>>;
  readonly unreadable?: boolean;
}

/** Una página tal como la deja el brazo: el brazo cambia el resultado de orientación que recibe el host. */
export function makePage(arm: M3Arm, index: number, spec: PageSpec = {}): PageSnapshot {
  const ink = spec.ink ?? 0.05;
  const naturalVerdict = spec.naturalVerdict ?? true;
  const natural = { orientation: 0, osdHadVerdict: naturalVerdict, inkRatio: ink };
  const forced = arm === "B" || arm === "C";
  const delivered = forced
    ? {
        orientation: 0,
        osdHadVerdict: false,
        inkRatio: arm === "C" && ink < INK_PRESENT_RATIO ? INK_PRESENT_RATIO : ink,
      }
    : natural;
  const angles = spec.angles ?? (forced ? [0, 90, 180, 270] : [0]);
  const attempts = angles.map((angle, order) => ({
    order,
    angle,
    upscale: 1,
    dpi: 150,
    terminal: "COMPLETED",
    durationMs: 1000,
    wordCount: order === 0 ? (spec.words ?? 100) : 10,
    reliableWordCount: order === 0 ? (spec.reliableFirst ?? 50) : 2,
    confidence: order === 0 ? 0.9 : 0.4,
    key: `key-${spec.textHash ?? "t"}-${index}-${order}`,
  }));
  const chosen = attempts[spec.deliveredAttempt ?? 0];
  return {
    pageIndex: index,
    natural,
    orientation: delivered,
    attempts,
    delivered: {
      wordCount: chosen?.wordCount ?? 0,
      reliableWordCount: chosen?.reliableWordCount ?? 0,
      textSha256: `sha-${spec.textHash ?? "t"}-${index}`,
      key: chosen?.key ?? "none",
    },
    confidence: chosen?.confidence ?? null,
    unreadableInk: spec.unreadable ?? false,
    entityCounts: spec.entities ?? {},
  };
}

export interface RunSpec {
  readonly doc: M3Doc;
  readonly arm: M3Arm;
  readonly rep?: number;
  readonly pages?: number;
  readonly coldPeakMb?: number;
  readonly hotPeakMb?: number;
  readonly coldReadyMs?: number;
  readonly hotReadyMs?: number;
  readonly pageSpec?: (index: number) => PageSpec;
  readonly ok?: boolean;
  readonly fixtureSha?: string;
}

function side(spec: RunSpec, temperature: "cold" | "hot"): M3RunSide {
  const count = spec.pages ?? M3_PAGES[spec.doc];
  const pages = Array.from({ length: count }, (_, index) =>
    makePage(spec.arm, index, spec.pageSpec?.(index)),
  );
  const dispatches = pages.reduce((sum, page) => sum + page.attempts.length, 0);
  const observer = spec.arm !== "A0";
  return {
    ok: spec.ok ?? true,
    peakSumBytes:
      (temperature === "cold" ? (spec.coldPeakMb ?? 1500) : (spec.hotPeakMb ?? 1600)) * 1e6,
    postReadyPeakBytes: null,
    baselineBytes: 500e6,
    rssPeakGlobalBytes: null,
    rssPeakDuringOcrBytes: null,
    peakPosition: "within-phases",
    hotBaselineSettled: temperature === "hot" ? true : null,
    readyDurationMs:
      temperature === "cold" ? (spec.coldReadyMs ?? 60_000) : (spec.hotReadyMs ?? 50_000),
    totalMs: 61_000,
    ocrDurationMs: 40_000,
    workerPeakByType: { "ocr-page": 2 },
    ocrPageDispatches: dispatches,
    groupCount: 3,
    entityCount: 5,
    observer,
    ocrPageJobsObserved: observer ? dispatches : 0,
    pages: observer
      ? pages
      : pages.map((page) => ({ ...page, attempts: [], natural: null, orientation: null })),
  };
}

export function makeRun(spec: RunSpec): M3Run {
  return {
    schema: 3,
    doc: spec.doc,
    arm: spec.arm,
    rep: spec.rep ?? 1,
    observerInstalled: spec.arm !== "A0",
    fixtureSha256: spec.fixtureSha ?? `sha-${spec.doc}`,
    pageCount: spec.pages ?? M3_PAGES[spec.doc],
    identity: {
      commit: undefined,
      platform: "win32",
      arch: "x64",
      cpuModel: "test",
      cpuCount: 12,
      totalMemBytes: 16e9,
    },
    capturedAt: "2026-10-09T00:00:00.000Z",
    cold: side(spec, "cold"),
    hot: side(spec, "hot"),
    issues: [],
  };
}

export function makeRunReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    temperature: "cold",
    baselineBytes: 400e6,
    peakSumBytes: 1500e6,
    postReadyPeakBytes: null,
    m1Bytes: null,
    phases: {},
    workerPeakByType: { "ocr-page": 2 },
    startedAtMs: 0,
    readyAtMs: 1000,
    totalMs: 1200,
    groupCount: 1,
    entityCount: 2,
    readyDurationMs: 1000,
    ocrDurationMs: 800,
    rssPeakGlobalBytes: 1500e6,
    rssPeakDuringOcrBytes: 1400e6,
    ok: true,
    phaseSegments: [],
    samples: [],
    workerEvents: [
      { type: "ocr-page", atMs: 1, delta: 1 },
      { type: "ocr-page", atMs: 2, delta: -1 },
      { type: "ocr-page", atMs: 3, delta: 1 },
      { type: "ner-page", atMs: 3, delta: 1 },
    ],
    peakPosition: "within-phases",
    hotBaselineSettled: null,
    heapSamples: [],
    systemPressureAtStart: { available: false, reason: "test" },
    systemPressureAtEnd: { available: false, reason: "test" },
    ...overrides,
  };
}

export function makeProfileReport(): ProfileReport {
  return {
    profile: "m3-test",
    identity: {
      commit: undefined,
      platform: "win32",
      arch: "x64",
      cpuModel: "test",
      cpuCount: 12,
      totalMemBytes: 16e9,
    },
    cold: makeRunReport(),
    hot: makeRunReport({ temperature: "hot", hotBaselineSettled: true }),
    capturedAt: "2026-10-09T00:00:00.000Z",
  };
}
