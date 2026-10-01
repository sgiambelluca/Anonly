import { describe, expect, it } from "vitest";

import {
  createUltraReader,
  median,
  summarizeUltra,
  ultraArtifactName,
  type UltraKind,
  type UltraRunData,
} from "./ocrPoolUltraSummary.js";

type Store = Map<string, UltraRunData>;

const POOL: Record<string, number> = { "2": 2, "4": 4, "6": 6, "6b": 6 };

function probe(arm: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "x",
    ocrQualitySha256: "ocr",
    occurrenceSha256: "occ",
    groupSha256: "grp",
    effectiveBusyRecognizersPeak: POOL[arm],
    effectiveConfiguredRecognizerPoolSize: POOL[arm],
    effectiveMaxLiveImageBytes: arm === "6b" ? 200 * 1024 * 1024 : 128 * 1024 * 1024,
    failed: false,
    ocrPageFailures: 0,
    missingWordCachePages: 0,
    cancelActiveOcrJobs: 2,
    cancelLatencyMs: 40,
    ...overrides,
  };
}

function fullStore(profile = "P2"): Store {
  const store: Store = new Map();
  for (const arm of Object.keys(POOL)) {
    for (let round = 0; round < 3; round += 1) {
      const base = Number.parseInt(arm, 10) * 100 + round;
      store.set(`time-${arm}-${profile}-r${round}`, {
        runId: `time-${arm}-${profile}-r${round}`,
        probe: probe(arm, { runId: `time-${arm}-${profile}-r${round}` }),
        timed: { ok: true, totalMs: 1000 + base, intervalsMs: { ocrMs: 500 + base } },
      });
      store.set(`memory-${arm}-${profile}-r${round}`, {
        runId: `memory-${arm}-${profile}-r${round}`,
        probe: probe(arm, { runId: `memory-${arm}-${profile}-r${round}` }),
        natural: { rssPeakDuringOcrBytes: 9000 + base },
      });
    }
    store.set(`cancel-${arm}-${profile}-r0`, {
      runId: `cancel-${arm}-${profile}-r0`,
      probe: probe(arm),
    });
  }
  return store;
}

function summarize(store: Store, profiles: string[] = ["P2"], r2Present = false) {
  return summarizeUltra({
    corpus: {
      profiles,
      r2Present,
      r2Note: r2Present ? null : "ANONLY_REAL_DOC_R2 no definido",
    },
    readRun: (kind: UltraKind, arm, profile, round) => {
      const data = store.get(`${kind}-${arm}-${profile}-r${round}`);
      return data === undefined ? null : { data, source: "t" };
    },
  });
}

describe("summarizeUltra", () => {
  it("resume medianas, ocupación, huellas y cancelación por corpus y brazo", () => {
    const summary = summarize(fullStore());
    const arm6b = summary.byCorpus.P2?.arms["6b"];
    expect(arm6b?.time.medianReadyMs).toBe(1000 + 601);
    expect(arm6b?.time.medianOcrMs).toBe(500 + 601);
    expect(arm6b?.memory.medianRssPeakDuringOcrBytes).toBe(9000 + 601);
    expect(arm6b?.effectiveMaxLiveImageBytes).toBe(200 * 1024 * 1024);
    expect(arm6b?.occupancy.reachedPoolSize).toBe(true);
    expect(arm6b?.fingerprints.identicalToArm2).toBe(true);
    expect(arm6b?.cancellation?.withinSla).toBe(true);
    expect(summary.complete).toBe(true);
    expect(summary.corpus.r2Present).toBe(false);
    expect(summary.corpus.r2Note).toContain("R2");
  });

  it("registra sin invalidar que el 6 nunca llegó a seis reconocedores", () => {
    const store = fullStore();
    for (const [id, data] of store) {
      const isArm6Run = /^(time|memory)-6-/.test(id);
      if (isArm6Run && data.probe !== undefined)
        store.set(id, {
          ...data,
          probe: { ...data.probe, effectiveBusyRecognizersPeak: id.startsWith("time") ? 4 : 5 },
        });
    }
    const summary = summarize(store);
    const arm6 = summary.byCorpus.P2?.arms["6"];
    expect(arm6?.occupancy.reachedPoolSize).toBe(false);
    expect(arm6?.occupancy.busyRecognizersPeakMin).toBe(4);
    expect(arm6?.occupancy.busyRecognizersPeakMax).toBe(5);
    expect(summary.byCorpus.P2?.arms["6b"]?.occupancy.reachedPoolSize).toBe(true);
    expect(summary.invalidRuns).toEqual([]);
    expect(summary.missingRuns).toEqual([]);
    expect(summary.complete).toBe(true);
  });

  it("detecta una huella distinta frente al brazo 2 (control: la versión sin comparación daba true)", () => {
    const store = fullStore();
    const id = "time-6-P2-r1";
    const data = store.get(id);
    store.set(id, { ...data, probe: { ...data?.probe, groupSha256: "otro" } });
    const summary = summarize(store);
    expect(summary.byCorpus.P2?.arms["6"]?.fingerprints.identicalToArm2).toBe(false);
    expect(summary.byCorpus.P2?.arms["6"]?.fingerprints.mismatches[0]?.key).toBe("groupSha256");
    expect(summary.qualityExactAcrossArms).toBe(false);
    expect(summary.complete).toBe(false);
  });

  it("una huella ausente en el brazo 2 no cuenta como igual", () => {
    const store = fullStore();
    for (const round of [0, 1, 2]) {
      const id = `time-2-P2-r${round}`;
      const data = store.get(id);
      const { groupSha256: _omitted, ...rest } = data?.probe ?? {};
      store.set(id, { ...data, probe: rest });
    }
    const summary = summarize(store);
    expect(summary.byCorpus.P2?.arms["4"]?.fingerprints.identicalToArm2).toBe(false);
  });

  it("una corrida faltante queda declarada y no se convierte en cero", () => {
    const store = fullStore();
    store.delete("memory-4-P2-r2");
    store.delete("cancel-6b-P2-r0");
    const summary = summarize(store);
    expect(summary.missingRuns).toEqual(["memory-4-P2-r2", "cancel-6b-P2-r0"]);
    expect(summary.byCorpus.P2?.arms["4"]?.memory.runs).toHaveLength(2);
    expect(summary.byCorpus.P2?.arms["6b"]?.cancellation).toBeNull();
    expect(summary.complete).toBe(false);
  });

  it("excluye una corrida con RSS ausente o pipeline fallado y la lista como inválida", () => {
    const store = fullStore();
    const mem = store.get("memory-2-P2-r0");
    store.set("memory-2-P2-r0", { ...mem, natural: { rssPeakDuringOcrBytes: null } });
    const time = store.get("time-4-P2-r1");
    store.set("time-4-P2-r1", { ...time, probe: { ...time?.probe, failed: true } });
    const summary = summarize(store);
    expect(summary.invalidRuns).toEqual([
      { runId: "memory-2-P2-r0", reason: "rss-peak-missing" },
      { runId: "time-4-P2-r1", reason: "pipeline-failed" },
    ]);
    expect(summary.byCorpus.P2?.arms["2"]?.memory.runs).toHaveLength(2);
    expect(summary.complete).toBe(false);
  });

  it("marca la cancelación fuera de SLA o sin trabajo activo", () => {
    const store = fullStore();
    store.set("cancel-4-P2-r0", {
      runId: "cancel-4-P2-r0",
      probe: probe("4", { cancelLatencyMs: 201 }),
    });
    store.set("cancel-6-P2-r0", {
      runId: "cancel-6-P2-r0",
      probe: probe("6", { cancelActiveOcrJobs: 0 }),
    });
    const arms = summarize(store).byCorpus.P2?.arms;
    expect(arms?.["4"]?.cancellation?.withinSla).toBe(false);
    expect(arms?.["6"]?.cancellation?.withinSla).toBe(false);
    expect(arms?.["2"]?.cancellation?.withinSla).toBe(true);
  });

  it("con R2 presente resume ambos corpus por separado", () => {
    const store = fullStore("P2");
    for (const [id, data] of fullStore("R2")) store.set(id, data);
    const summary = summarize(store, ["P2", "R2"], true);
    expect(Object.keys(summary.byCorpus)).toEqual(["P2", "R2"]);
    expect(summary.corpus.r2Present).toBe(true);
    expect(summary.complete).toBe(true);
  });
});

describe("summarizeUltra: bordes", () => {
  it("el brazo 2 no se compara consigo mismo: comparedPairs es 0 y es el control", () => {
    const fingerprints = summarize(fullStore()).byCorpus.P2?.arms["2"]?.fingerprints;
    expect(fingerprints).toEqual({ identicalToArm2: true, comparedPairs: 0, mismatches: [] });
  });

  it("sin brazo 2 utilizable, los demás brazos no pueden declararse idénticos", () => {
    const store = fullStore();
    for (const id of [...store.keys()]) if (/^(time|memory)-2-/.test(id)) store.delete(id);
    const arm4 = summarize(store).byCorpus.P2?.arms["4"]?.fingerprints;
    expect(arm4?.comparedPairs).toBe(0);
    expect(arm4?.identicalToArm2).toBe(false);
  });

  it("sin corpus no hay resumen completo", () => {
    const summary = summarize(fullStore(), []);
    expect(summary.byCorpus).toEqual({});
    expect(summary.complete).toBe(false);
  });
});

describe("median", () => {
  it("con cantidad par promedia los dos centrales", () => {
    expect(median([10, 20])).toBe(15);
    expect(median([40, 10, 30, 20])).toBe(25);
  });

  it("con cantidad impar devuelve el central y sin datos devuelve null", () => {
    expect(median([30, 10, 20])).toBe(20);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });
});

describe("lectura de artefactos de ultra", () => {
  it("la memoria se lee del artefacto pool-rss y el resto del nombre estándar", () => {
    expect(ultraArtifactName("memory", "memory-6b-P2-r1")).toBe("ocr-pool-pool-rss-6b-P2-r1.json");
    expect(ultraArtifactName("time", "time-6b-P2-r1")).toBe("ocr-pool-time-6b-P2-r1.json");
    expect(ultraArtifactName("cancel", "cancel-2-R2-r0")).toBe("ocr-pool-cancel-2-R2-r0.json");
  });

  it("salta los run IDs invalidados de una carpeta y cae a la siguiente por prioridad", () => {
    const files = new Map<string, UltraRunData>([
      ["a/ocr-pool-time-2-P2-r0.json", { runId: "desde-a" }],
      ["b/ocr-pool-time-2-P2-r0.json", { runId: "desde-b" }],
      ["a/ocr-pool-pool-rss-4-P2-r0.json", { runId: "mem-a" }],
    ]);
    const read = createUltraReader(
      [
        { name: "a", invalidRunIds: new Set(["time-2-P2-r0"]) },
        { name: "b", invalidRunIds: new Set() },
      ],
      (source, file) => files.get(`${source}/${file}`) ?? null,
    );
    expect(read("time", "2", "P2", 0)?.data.runId).toBe("desde-b");
    expect(read("memory", "4", "P2", 0)?.source).toBe("a");
    expect(read("time", "4", "P2", 0)).toBeNull();
  });

  it("si todas las carpetas la invalidan, la corrida queda faltante y no se lee", () => {
    const read = createUltraReader(
      [{ name: "a", invalidRunIds: new Set(["time-2-P2-r0"]) }],
      () => ({ runId: "x" }),
    );
    expect(read("time", "2", "P2", 0)).toBeNull();
  });
});
