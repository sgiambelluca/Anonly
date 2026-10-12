import { describe, expect, it } from "vitest";

import type { EffectiveProfileEvidence } from "./ocrPoolLowProfile.js";
import {
  LOW_MEMORY_CEILING_BYTES,
  lowArtifactName,
  lowResultLine,
  lowRunId,
  summarizeLow,
  toDecimalGb,
  type LowRunData,
} from "./ocrPoolLowSummary.js";

const LOW: EffectiveProfileEvidence = {
  performancePreset: "low",
  engineOverridesPresent: false,
  workerPool: { pdfPoolSize: 1, ocrPoolSize: 1, nerPoolSize: 1, renderPoolSize: 1 },
  maxLiveImageBytes: 128 * 1024 * 1024,
};

function run(
  round: number,
  rssPeak: number,
  overrides: Partial<LowRunData> = {},
  withProfile = true,
): LowRunData {
  return {
    runId: lowRunId(round),
    startedAtUtc: "2026-10-07T10:00:00.000Z",
    completedAtUtc: "2026-10-07T10:02:00.000Z",
    ...(withProfile ? { effectiveProfile: LOW } : {}),
    probe: {
      armLabel: "low",
      profile: "P2H",
      failed: false,
      ocrPageFailures: 0,
      missingWordCachePages: 0,
      startedAt: 1_000,
      finishedAt: 61_000,
      ocrPageCount: 20,
      effectiveBusyRecognizersPeak: 1,
      effectiveBusyOsdPeak: 1,
      effectiveConfiguredRecognizerPoolSize: 1,
      effectiveMaxLiveImageBytes: 128 * 1024 * 1024,
      ocrQualitySha256: "a",
      occurrenceSha256: "b",
      groupSha256: "c",
      workerEvents: [
        { type: "ocr-page", epochMs: 1_100, delta: 1 },
        { type: "ner-page", epochMs: 2_000, delta: 1 },
        { type: "ner-page", epochMs: 2_500, delta: -1 },
        { type: "ocr-page", epochMs: 3_000, delta: -1 },
        { type: "ner-page", epochMs: 90_000, delta: 1 },
      ],
    },
    natural: {
      rssPeakDuringOcrBytes: rssPeak,
      samples: [
        {
          atMs: 0,
          sumWorkingSetSizeBytes: 100,
          perProcess: [{ pid: 1, type: "Tab", workingSetSizeBytes: 100 }],
        },
        {
          atMs: 150,
          sumWorkingSetSizeBytes: rssPeak,
          perProcess: [
            { pid: 1, type: "Tab", workingSetSizeBytes: rssPeak - 300 },
            { pid: 2, type: "Browser", workingSetSizeBytes: 200 },
            { pid: 3, type: "GPU", workingSetSizeBytes: 100 },
          ],
        },
      ],
    },
    ...overrides,
  };
}

const three = (peaks: ReadonlyArray<number>, extra: Partial<LowRunData> = {}, withProfile = true) =>
  summarizeLow({
    rounds: [0, 1, 2],
    readRun: (round) => run(round, peaks[round] ?? 0, extra, withProfile),
    sleepDetection: { available: true, note: null },
  });

describe("nombres de la fase low-memory", () => {
  it("el run ID y el artefacto de memoria siguen la convención de la fase pool-rss", () => {
    expect(lowRunId(1)).toBe("memory-low-P2H-r1");
    expect(lowArtifactName(1)).toBe("ocr-pool-pool-rss-low-P2H-r1.json");
  });

  it("GB decimales, como ADR-194 §7", () => {
    expect(toDecimalGb(3_160_000_000)).toBe(3.16);
    expect(toDecimalGb(LOW_MEMORY_CEILING_BYTES)).toBe(2.5);
  });
});

describe("summarizeLow", () => {
  it("tres corridas válidas: el máximo, la mediana y el margen contra el techo de 2,5 GB", () => {
    const summary = three([2_000_000_000, 2_045_000_000, 2_020_000_000]);
    expect(summary.complete).toBe(true);
    expect(summary.maxRssPeakBytes).toBe(2_045_000_000);
    expect(summary.maxRssPeakGbDecimal).toBe(2.045);
    expect(summary.minRssPeakBytes).toBe(2_000_000_000);
    expect(summary.medianRssPeakBytes).toBe(2_020_000_000);
    expect(summary.ceiling).toMatchObject({
      bytes: 2_500_000_000,
      maxExceedsCeiling: false,
      marginBytes: 455_000_000,
    });
    expect(summary.fingerprintsIdenticalAcrossRuns).toBe(true);
    expect(lowResultLine(summary)).toBe(
      "complete=true max=2.045GB techo=2.5GB supera=false salvedades=0",
    );
  });

  it("un máximo por encima del techo se informa y no se sube el techo", () => {
    const summary = three([2_400_000_000, 2_600_000_000, 2_500_000_000]);
    expect(summary.ceiling.maxExceedsCeiling).toBe(true);
    expect(summary.ceiling.bytes).toBe(2_500_000_000);
    expect(summary.ceiling.marginBytes).toBe(-100_000_000);
    expect(lowResultLine(summary)).toContain("supera=true");
  });

  it("exactamente el techo no lo supera", () => {
    expect(three([2_500_000_000, 2_000_000_000, 2_000_000_000]).ceiling.maxExceedsCeiling).toBe(
      false,
    );
  });

  it("desglosa la muestra del pico por tipo de proceso y cuenta los procesos", () => {
    const [first] = three([2_000_000_000, 2_000_000_000, 2_000_000_000]).runs;
    expect(first?.peakSampleBytesByProcessType).toEqual({
      Tab: 2_000_000_000 - 300,
      Browser: 200,
      GPU: 100,
    });
    expect(first?.peakSampleProcessCount).toBe(3);
    expect(first?.samplesInOcrWindow).toBe(2);
  });

  it("registra la ocupación, el pico por tipo de worker y el NER despachado dentro de la ventana OCR", () => {
    const [first] = three([2_000_000_000, 2_000_000_000, 2_000_000_000]).runs;
    expect(first?.busyRecognizersPeak).toBe(1);
    expect(first?.ocrMs).toBe(60_000);
    expect(first?.workerPeakByType).toEqual({ "ocr-page": 1, "ner-page": 1 });
    // el despacho de NER a los 90 s cae fuera de la ventana [1 s, 61 s]
    expect(first?.nerJobsDispatchedDuringOcr).toBe(1);
    expect(first?.renderJobsDispatchedDuringOcr).toBe(0);
  });

  it("una corrida cuya configuración efectiva no es el perfil Bajo es inválida: no entra al máximo", () => {
    const summary = summarizeLow({
      rounds: [0, 1, 2],
      readRun: (round) =>
        round === 1
          ? run(round, 9_000_000_000, {
              effectiveProfile: { ...LOW, workerPool: { ...LOW.workerPool, renderPoolSize: 4 } },
            })
          : run(round, 2_000_000_000),
    });
    expect(summary.complete).toBe(false);
    expect(summary.maxRssPeakBytes).toBe(2_000_000_000);
    expect(summary.invalidRuns).toHaveLength(1);
    expect(summary.invalidRuns[0]?.reason).toContain("effective-profile-mismatch");
    expect(summary.invalidRuns[0]?.reason).toContain("renderPoolSize efectivo=4");
  });

  it("sin evidencia de configuración efectiva la corrida es inválida", () => {
    const summary = three([2_000_000_000, 2_000_000_000, 2_000_000_000], {}, false);
    expect(summary.complete).toBe(false);
    expect(summary.runs).toHaveLength(0);
    expect(summary.maxRssPeakBytes).toBeNull();
    expect(summary.ceiling.maxExceedsCeiling).toBeNull();
  });

  it.each([
    ["pipeline-failed", { failed: true }],
    ["ocr-page-failures", { ocrPageFailures: 2 }],
    ["word-cache-missing", { missingWordCachePages: 1 }],
    ["run-is-not-low-p2h", { armLabel: "2" }],
  ])("%s invalida la corrida y no se convierte en cero", (reason, probePatch) => {
    const base = run(0, 2_000_000_000);
    const summary = summarizeLow({
      rounds: [0],
      readRun: () => ({ ...base, probe: { ...base.probe, ...probePatch } }),
    });
    expect(summary.complete).toBe(false);
    expect(summary.invalidRuns).toEqual([{ runId: "memory-low-P2H-r0", reason }]);
  });

  it("RSS ausente o cero invalida la corrida", () => {
    for (const rss of [undefined, 0]) {
      const summary = summarizeLow({
        rounds: [0],
        readRun: () => ({ ...run(0, 1), natural: { rssPeakDuringOcrBytes: rss } }),
      });
      expect(summary.invalidRuns[0]?.reason).toBe("rss-peak-missing");
    }
  });

  it("una corrida faltante se lista y la tanda queda incompleta", () => {
    const summary = summarizeLow({
      rounds: [0, 1, 2],
      readRun: (round) => (round === 2 ? null : run(round, 2_000_000_000)),
    });
    expect(summary.missingRuns).toEqual(["memory-low-P2H-r2"]);
    expect(summary.complete).toBe(false);
    expect(summary.maxRssPeakBytes).toBe(2_000_000_000);
  });

  it("huellas distintas entre corridas se informan sin invalidar", () => {
    const summary = summarizeLow({
      rounds: [0, 1],
      readRun: (round) => {
        const base = run(round, 2_000_000_000);
        return round === 1 ? { ...base, probe: { ...base.probe, ocrQualitySha256: "otra" } } : base;
      },
    });
    expect(summary.complete).toBe(true);
    expect(summary.fingerprintsIdenticalAcrossRuns).toBe(false);
  });

  it("el humo (una corrida) es completo para su ronda y queda marcado", () => {
    const summary = summarizeLow({
      rounds: [0],
      smoke: true,
      readRun: () => run(0, 2_000_000_000),
    });
    expect(summary.smoke).toBe(true);
    expect(summary.complete).toBe(true);
    expect(summary.fingerprintsIdenticalAcrossRuns).toBeNull();
    expect(lowResultLine(summary)).toContain("(humo)");
  });

  it("la detección de suspensión no informada o fallida queda como salvedad", () => {
    const summary = summarizeLow({
      rounds: [0],
      readRun: () => run(0, 2_000_000_000),
      caveats: [{ id: "sleep-prevention-unavailable", note: "x" }],
    });
    expect(summary.validityCaveats.map((caveat) => caveat.split(":")[0])).toEqual([
      "sleep-detection-unknown",
      "sleep-prevention-unavailable",
    ]);
    expect(lowResultLine(summary)).toContain(
      "salvedades=2 [sleep-detection-unknown, sleep-prevention-unavailable]",
    );
  });

  it("los run IDs invalidados por el runner se listan", () => {
    const summary = summarizeLow({
      rounds: [0],
      readRun: () => null,
      validity: {
        affectedRunIds: ["memory-low-P2H-r0"],
        reasonsByRunId: { "memory-low-P2H-r0": ["playwright-failure"] },
      },
    });
    expect(summary.excludedInvalidatedRunIds).toEqual(["memory-low-P2H-r0"]);
    expect(summary.invalidationReasons["memory-low-P2H-r0"]).toEqual(["playwright-failure"]);
    expect(summary.complete).toBe(false);
  });
});
