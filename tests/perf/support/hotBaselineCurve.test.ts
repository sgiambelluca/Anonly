/**
 * `hotBaselineCurve.test.ts` — cubre las funciones puras de T-7
 * (`docs/roadmap/Perfilado_Base_Caliente_Plan.md`): el agregado por tipo de
 * proceso (C-2) y la extracción de la curva de checkpoints (C-1). No cubre
 * `measureHotBaselineCurve` (necesita una `Page`/`ElectronApplication`
 * reales — eso lo prueba la campaña de T-7 vía Playwright, no vitest).
 */
import { describe, expect, it } from "vitest";

import {
  aggregateByProcessType,
  computeReleaseCurve,
  HOT_BASELINE_CURVE_CHECKPOINTS_MS,
} from "./hotBaselineCurve.js";
import type { MemorySample } from "./memorySampler.js";

function rssSample(atMs: number, byType: Readonly<Record<string, number>>): MemorySample {
  const perProcess = Object.entries(byType).map(([type, workingSetSizeBytes], index) => ({
    pid: index + 1,
    type,
    workingSetSizeBytes,
  }));
  return {
    atMs,
    sumWorkingSetSizeBytes: perProcess.reduce((acc, p) => acc + p.workingSetSizeBytes, 0),
    perProcess,
  };
}

describe("aggregateByProcessType", () => {
  it("agrupa por type, sumando cuando hay más de un proceso del mismo tipo", () => {
    const sample: MemorySample = {
      atMs: 0,
      sumWorkingSetSizeBytes: 900,
      perProcess: [
        { pid: 1, type: "Tab", workingSetSizeBytes: 300 },
        { pid: 2, type: "Utility", workingSetSizeBytes: 100 },
        { pid: 3, type: "Utility", workingSetSizeBytes: 200 },
        { pid: 4, type: "GPU", workingSetSizeBytes: 300 },
      ],
    };
    expect(aggregateByProcessType(sample)).toEqual([
      { type: "GPU", bytes: 300 },
      { type: "Tab", bytes: 300 },
      { type: "Utility", bytes: 300 },
    ]);
  });

  it("sin procesos da lista vacía, no un 0 fabricado", () => {
    expect(aggregateByProcessType({ atMs: 0, sumWorkingSetSizeBytes: 0, perProcess: [] })).toEqual(
      [],
    );
  });

  it("orden estable alfabético, no de aparición", () => {
    const sample: MemorySample = {
      atMs: 0,
      sumWorkingSetSizeBytes: 30,
      perProcess: [
        { pid: 1, type: "Utility", workingSetSizeBytes: 10 },
        { pid: 2, type: "Browser", workingSetSizeBytes: 10 },
        { pid: 3, type: "GPU", workingSetSizeBytes: 10 },
      ],
    };
    expect(aggregateByProcessType(sample).map((b) => b.type)).toEqual([
      "Browser",
      "GPU",
      "Utility",
    ]);
  });
});

describe("computeReleaseCurve", () => {
  it("usa HOT_BASELINE_CURVE_CHECKPOINTS_MS por defecto: 8 puntos, 5s a 120s", () => {
    expect(HOT_BASELINE_CURVE_CHECKPOINTS_MS).toEqual([
      5_000, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000, 120_000,
    ]);
  });

  it("convierte cada checkpoint relativo al cierre (sinceMs) al atMs absoluto del sampler", () => {
    // sinceMs = 1000 (el cierre cayó a 1s de que arrancó el sampler).
    // El checkpoint de 5s relativo al cierre corresponde a atMs=6000 absoluto.
    const samples = [rssSample(1000, { Tab: 500 }), rssSample(6000, { Tab: 400 })];
    const curve = computeReleaseCurve(samples, 1000, [5_000]);
    expect(curve).toHaveLength(1);
    expect(curve[0]?.targetMs).toBe(5_000);
    expect(curve[0]?.relativeAtMs).toBe(5_000);
    expect(curve[0]?.lagMs).toBe(0);
    expect(curve[0]?.sumBytes).toBe(400);
    expect(curve[0]?.perProcessType).toEqual([{ type: "Tab", bytes: 400 }]);
  });

  it("toma la muestra más cercana cuando ninguna cae exacto sobre el checkpoint", () => {
    const samples = [
      rssSample(0, { Tab: 1000 }),
      rssSample(4700, { Tab: 800 }), // 300ms antes del checkpoint de 5s
      rssSample(5300, { Tab: 700 }), // 300ms después
    ];
    const curve = computeReleaseCurve(samples, 0, [5_000]);
    // Empate en distancia (300ms de cada lado): sampleNear se queda con el
    // primero que encuentra con distancia estrictamente menor, o sea el más
    // temprano de los dos empatados.
    expect(curve[0]?.sumBytes).toBe(800);
    expect(curve[0]?.lagMs).toBe(300);
  });

  it("sin ninguna muestra en la serie: null en vez de 0 fabricado", () => {
    const curve = computeReleaseCurve([], 0, [60_000]);
    expect(curve[0]).toEqual({
      targetMs: 60_000,
      relativeAtMs: null,
      lagMs: null,
      sumBytes: null,
      perProcessType: [],
    });
  });

  it("cada checkpoint es independiente: uno sin muestra cercana no invalida a los demás", () => {
    const samples = [rssSample(0, { Tab: 1000 })];
    const curve = computeReleaseCurve(samples, 0, [5_000, 999_000]);
    expect(curve[0]?.sumBytes).toBe(1000); // única muestra disponible, igual de "cercana" a cualquier checkpoint
    expect(curve[1]?.sumBytes).toBe(1000);
    expect(curve[1]?.lagMs).toBe(999_000);
  });
});
