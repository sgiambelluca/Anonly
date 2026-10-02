import { describe, expect, it } from "vitest";

import {
  dpiArtifactName,
  dpiPoolResultLine,
  dpiRunId,
  summarizeDpiPool,
  type DpiPoolInput,
  type DpiRunData,
  type DpiRunKind,
} from "./ocrPoolDpiSummary.js";

const MIB = 1024 * 1024;

interface Variant {
  readonly hash?: string;
  readonly rssMib?: number;
  readonly ocrMs?: number;
  readonly readyMs?: number;
  readonly busy?: number;
  readonly failed?: boolean;
  readonly evidence?: "missing" | "mismatch" | "ok";
  readonly latency?: number;
}

function runData(
  kind: DpiRunKind,
  arm: string,
  dpi: number,
  round: number,
  variant: Variant = {},
): DpiRunData {
  const bytesPerPage = Math.ceil((595 * dpi) / 72) * Math.ceil((842 * dpi) / 72) * 4;
  const hash = variant.hash ?? "same";
  const probe = {
    failed: variant.failed ?? false,
    ocrPageFailures: 0,
    missingWordCachePages: 0,
    requestedDpi: dpi,
    effectiveBusyRecognizersPeak: variant.busy ?? Number(arm),
    effectiveConfiguredRecognizerPoolSize: Number(arm),
    effectiveMaxLiveImageBytes: 128 * MIB,
    ocrQualitySha256: hash,
    occurrenceSha256: hash,
    groupSha256: hash,
    pageRgbaEstimates: [{ estimatedBytes: bytesPerPage }, { estimatedBytes: bytesPerPage }],
    cancelActiveOcrJobs: 2,
    cancelLatencyMs: variant.latency ?? 50,
  };
  const evidence =
    variant.evidence === "missing"
      ? undefined
      : {
          dispatch: {
            requestedDpi: dpi,
            caps: [{ pageIndex: 0, originalCap: 301 }],
            dispatches: [],
            expectedDpiByPage: { "0": Math.min(dpi, 301) },
            effectiveDpis: [variant.evidence === "mismatch" ? 300 : dpi],
            dispatchesAtExpectedDpi: variant.evidence !== "mismatch",
            armEffective: variant.evidence !== "mismatch",
            issues: [],
          },
          chain: {
            osd: [],
            recoverySteps: 0,
            upscaledDispatches: 0,
            maxUpscale: 1,
            unreadableInkPages: 0,
            ocrPageFailedDispatches: 0,
            issues: [],
          },
        };
  return {
    runId: dpiRunId(kind, arm, "P2H", dpi, round),
    requestedDpi: dpi,
    probe,
    ...(kind === "time"
      ? {
          timed: {
            ok: true,
            totalMs: variant.readyMs ?? 1000 * dpi,
            intervalsMs: { ocrMs: variant.ocrMs ?? 500 * dpi },
          },
        }
      : {}),
    ...(kind === "memory"
      ? { natural: { rssPeakDuringOcrBytes: (variant.rssMib ?? dpi * Number(arm)) * MIB } }
      : {}),
    ...(evidence === undefined ? {} : { dpiEvidence: evidence }),
  };
}

function input(
  overrides: Partial<DpiPoolInput> & {
    variants?: Record<string, Variant>;
    absent?: ReadonlyArray<string>;
  } = {},
): DpiPoolInput {
  const { variants = {}, absent = [], ...rest } = overrides;
  return {
    profiles: ["P2H"],
    profileNotes: [],
    arms: ["2", "4"],
    dpis: [300, 200],
    readRun: (kind, arm, profile, dpi, round) => {
      const id = dpiRunId(kind, arm, profile, dpi, round);
      if (absent.includes(id)) return null;
      return { data: runData(kind, arm, dpi, round, variants[id]), source: "x" };
    },
    ...rest,
  };
}

describe("nombres de corrida y de artefacto", () => {
  it("el DPI forma parte del run ID y del nombre del artefacto de memoria", () => {
    expect(dpiRunId("time", "2", "P2H", 200, 1)).toBe("time-2-P2H-d200-r1");
    expect(dpiArtifactName("time", "time-2-P2H-d200-r1")).toBe("ocr-pool-time-2-P2H-d200-r1.json");
    expect(dpiArtifactName("memory", "memory-4-SR-d250-r0")).toBe(
      "ocr-pool-pool-rss-4-SR-d250-r0.json",
    );
  });
});

describe("summarizeDpiPool", () => {
  it("una tanda completa agrega tiempo, memoria, ocupación, DPI efectivo y cancelación por combinación", () => {
    const summary = summarizeDpiPool(input());
    expect(summary.complete).toBe(true);
    expect(summary.missingRuns).toEqual([]);
    const at200 = summary.byProfile.P2H?.byDpi["200"]?.pools["2"];
    expect(at200?.time.runs).toHaveLength(3);
    expect(at200?.memory.runs).toHaveLength(3);
    expect(at200?.dpiEvidence).toMatchObject({
      effectiveDpis: [200],
      allDispatchesAtExpectedDpi: true,
      allDispatchesAtRequestedDpi: true,
    });
    expect(at200?.cancellation?.withinSla).toBe(true);
    expect(at200?.occupancy.reachedPoolSize).toBe(true);
  });

  it("la reserva estimada cambia con el DPI y entran más páginas en 128 MiB", () => {
    const summary = summarizeDpiPool(input());
    const at300 = summary.byProfile.P2H?.byDpi["300"];
    const at200 = summary.byProfile.P2H?.byDpi["200"];
    expect(at300?.reservation.perPageBytes?.median).toBeGreaterThan(
      at200?.reservation.perPageBytes?.median ?? Infinity,
    );
    expect(at300?.pagesAdmittedAt128MiB).toBe(3);
    expect(at200?.pagesAdmittedAt128MiB).toBe(8);
  });

  it("lo que ahorra el DPI se mide contra el mismo pool a 300 dpi", () => {
    const summary = summarizeDpiPool(
      input({
        variants: Object.fromEntries(
          [0, 1, 2].flatMap((round) => [
            [dpiRunId("memory", "2", "P2H", 300, round), { rssMib: 3000 }],
            [dpiRunId("memory", "2", "P2H", 200, round), { rssMib: 2100 }],
          ]),
        ),
      }),
    );
    const versus = summary.byProfile.P2H?.byDpi["200"]?.pools["2"]?.versusControlDpi;
    expect(versus?.rssPeakRatio).toBeCloseTo(0.7, 6);
    expect(versus?.rssPeakDeltaBytes).toBe(-900 * MIB);
    expect(summary.byProfile.P2H?.byDpi["300"]?.pools["2"]?.versusControlDpi).toBeNull();
  });

  it("huellas: a 300 dpi tienen que coincidir con las de dos reconocedores; a otro DPI se informa la diferencia", () => {
    const differentDpi = summarizeDpiPool(
      input({
        variants: Object.fromEntries(
          [0, 1, 2].flatMap((round) => [
            [dpiRunId("time", "2", "P2H", 200, round), { hash: "otra" }],
            [dpiRunId("memory", "2", "P2H", 200, round), { hash: "otra" }],
          ]),
        ),
      }),
    );
    expect(differentDpi.complete).toBe(true);
    const fingerprint =
      differentDpi.byProfile.P2H?.byDpi["200"]?.pools["2"]?.fingerprintsVsReference;
    expect(fingerprint).toMatchObject({ expectedIdentical: false, identical: false });
    expect(fingerprint?.mismatchedKeys).toHaveLength(18);
  });

  it("control de fallo: otro pool a 300 dpi con huellas distintas rompe la exactitud y la tanda", () => {
    const summary = summarizeDpiPool(
      input({ variants: { [dpiRunId("time", "4", "P2H", 300, 1)]: { hash: "distinta" } } }),
    );
    expect(summary.qualityExactAtControlDpi).toBe(false);
    expect(summary.complete).toBe(false);
    expect(summary.byProfile.P2H?.byDpi["300"]?.pools["4"]?.fingerprintsVsReference.identical).toBe(
      false,
    );
  });

  it("una corrida ausente queda en missingRuns y la tanda incompleta, no en cero", () => {
    const missing = dpiRunId("memory", "4", "P2H", 200, 2);
    const summary = summarizeDpiPool(input({ absent: [missing] }));
    expect(summary.missingRuns).toEqual([missing]);
    expect(summary.complete).toBe(false);
    expect(summary.byProfile.P2H?.byDpi["200"]?.pools["4"]?.memory.runs).toHaveLength(2);
  });

  it.each<[string, Variant, string]>([
    ["sin evidencia del DPI efectivo", { evidence: "missing" }, "dpi-evidence-missing"],
    [
      "DPI efectivo distinto del esperado",
      { evidence: "mismatch" },
      "effective-dpi-differs-from-expected",
    ],
    ["pipeline fallado", { failed: true }, "pipeline-failed"],
  ])("corrida inválida: %s", (_label, variant, reason) => {
    const id = dpiRunId("time", "2", "P2H", 200, 0);
    const summary = summarizeDpiPool(input({ variants: { [id]: variant } }));
    expect(summary.invalidRuns).toEqual([{ runId: id, reason }]);
    expect(summary.complete).toBe(false);
    expect(summary.byProfile.P2H?.byDpi["200"]?.pools["2"]?.time.runs).toHaveLength(2);
  });

  it("una cancelación fuera de SLA se conserva y se marca", () => {
    const id = dpiRunId("cancel", "2", "P2H", 200, 0);
    const summary = summarizeDpiPool(input({ variants: { [id]: { latency: 450 } } }));
    expect(summary.byProfile.P2H?.byDpi["200"]?.pools["2"]?.cancellation?.withinSla).toBe(false);
    expect(summary.complete).toBe(true);
  });

  it("sin el DPI 300 o sin dos reconocedores no hay control y no se da por completa", () => {
    expect(summarizeDpiPool(input({ dpis: [250, 200] })).complete).toBe(false);
    expect(summarizeDpiPool(input({ arms: ["4", "6"] })).complete).toBe(false);
  });

  it("las corridas invalidadas por el runner (suspensión) se listan y no se leen", () => {
    const id = dpiRunId("time", "2", "P2H", 200, 1);
    const summary = summarizeDpiPool(
      input({
        validity: {
          affectedRunIds: [id],
          reasonsByRunId: { [id]: ["sleep-wake-event-during-run"] },
        },
        absent: [id],
      }),
    );
    expect(summary.excludedInvalidatedRunIds).toEqual([id]);
    expect(summary.invalidationReasons[id]).toEqual(["sleep-wake-event-during-run"]);
    expect(summary.complete).toBe(false);
  });

  it("la línea final trae las salvedades y distingue el humo", () => {
    const summary = summarizeDpiPool(
      input({
        sleepDetection: { available: false, note: "falló" },
        caveats: [{ id: "x", note: "y" }],
      }),
    );
    expect(dpiPoolResultLine(summary)).toContain("salvedades=2");
    expect(dpiPoolResultLine(summary)).toContain("complete=true");
    expect(dpiPoolResultLine(summary, true)).toContain("complete=n/a");
  });
});

describe("brazo no efectivo (O-3)", () => {
  it("un DPI efectivo distinto del pedido queda marcado y fuera de versusControlDpi", () => {
    const base = input();
    const summary = summarizeDpiPool({
      ...base,
      readRun: (kind, arm, profile, dpi, round) => {
        const found = base.readRun(kind, arm, profile, dpi, round);
        if (found === null || dpi !== 200 || found.data.dpiEvidence?.dispatch === undefined)
          return found;
        // Despachos válidos al DPI esperado, pero no al pedido (p. ej. tope de la fuente).
        return {
          ...found,
          data: {
            ...found.data,
            dpiEvidence: {
              ...found.data.dpiEvidence,
              dispatch: { ...found.data.dpiEvidence.dispatch, armEffective: false },
            },
          },
        };
      },
    });
    const arm = summary.byProfile.P2H?.byDpi["200"]?.pools["2"];
    expect(arm?.dpiEvidence.allDispatchesAtRequestedDpi).toBe(false);
    expect(arm?.versusControlDpi).toBeNull();
    // Control de fallo: el mismo brazo, efectivo, sí informa el ahorro.
    expect(
      summarizeDpiPool(input()).byProfile.P2H?.byDpi["200"]?.pools["2"]?.versusControlDpi,
    ).not.toBeNull();
  });
});
