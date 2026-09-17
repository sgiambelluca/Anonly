/**
 * `memoryProfile.test.ts` — cubre las funciones puras de ADR-159 §8 (el
 * residuo "no atribuido"), §6 (cobertura por target/fase), y de ADR-146
 * §7ter/plan de arreglo del instrumento A-2 (clasificación por posición del
 * máximo) y A-3 (fases sin muestras). No cubre `measureProfile`/`runImport`
 * (necesitan una `Page`/`ElectronApplication` reales — eso lo prueba
 * `pnpm test:perf`, no vitest).
 */
import { describe, expect, it } from "vitest";

import type { ClassifiedTargetHeapSample, HeapSample } from "./cdpHeap.js";
import {
  attributedIsolateBytes,
  classifyPeakPosition,
  computeM2WithinPhases,
  computePhaseSegments,
  computePostReadyPeakBytes,
  computeTargetCoverage,
  computeUnattributedResidual,
  computeRunDurations,
  tabProcessBytes,
} from "./memoryProfile.js";
import type { PhaseSegment } from "./memoryProfile.js";
import type { MemorySample } from "./memorySampler.js";

/** `PhaseSegment` mínimo para los tests de clasificación — solo `fromAtMs`/`toAtMs` importan ahí. */
function segment(fromAtMs: number, toAtMs: number): PhaseSegment {
  return {
    fromEvent: "A",
    toEvent: "B",
    fromAtMs,
    toAtMs,
    rssAtEntryBytes: 0,
    rssAtExitBytes: 0,
    sampleCountInWindow: 1,
    measurable: true,
    peakInternalBytes: 0,
    deltaBytes: 0,
    workerPeakByType: {},
    heapByTargetAtEntry: undefined,
    heapByTargetAtEntryLagMs: undefined,
    heapByTargetAtExit: undefined,
    heapByTargetAtExitLagMs: undefined,
    unattributedResidualAtEntryBytes: undefined,
    unattributedResidualAtExitBytes: undefined,
    targetCoverage: [],
  };
}

function target(
  overrides: Partial<ClassifiedTargetHeapSample> & Pick<ClassifiedTargetHeapSample, "sessionId">,
): ClassifiedTargetHeapSample {
  return {
    parentSessionId: undefined,
    type: "worker",
    url: "app://local/assets/entry-XXXX.js",
    attachedAtMs: 0,
    usedSizeBytes: 0,
    totalSizeBytes: 0,
    embedderHeapUsedSizeBytes: 0,
    backingStorageSizeBytes: 0,
    readError: undefined,
    label: "leaf-worker-1",
    note: "",
    factoryChunk: "unknown",
    workerRole: "unknown",
    ...overrides,
  };
}

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

describe("attributedIsolateBytes", () => {
  it("suma used + embedder + backingStorage de los targets leídos con éxito", () => {
    const bytes = attributedIsolateBytes([
      target({
        sessionId: "a",
        usedSizeBytes: 1_000_000,
        embedderHeapUsedSizeBytes: 200_000,
        backingStorageSizeBytes: 3_000_000,
      }),
      target({
        sessionId: "b",
        usedSizeBytes: 500_000,
        embedderHeapUsedSizeBytes: 0,
        backingStorageSizeBytes: 0,
      }),
    ]);
    expect(bytes).toBe(1_000_000 + 200_000 + 3_000_000 + 500_000);
  });

  it("ignora un target con readError — no aporta 0 implícito, no aporta nada", () => {
    const bytes = attributedIsolateBytes([
      target({ sessionId: "a", usedSizeBytes: 1_000_000 }),
      target({ sessionId: "busy", usedSizeBytes: 999_999_999, readError: "timeout" }),
    ]);
    expect(bytes).toBe(1_000_000);
  });

  it("no incluye totalSizeBytes (capacidad, no uso real)", () => {
    const bytes = attributedIsolateBytes([
      target({
        sessionId: "a",
        usedSizeBytes: 0,
        totalSizeBytes: 50_000_000,
        embedderHeapUsedSizeBytes: 0,
        backingStorageSizeBytes: 0,
      }),
    ]);
    expect(bytes).toBe(0);
  });
});

describe("tabProcessBytes", () => {
  it("suma solo los procesos tipo Tab, ignora GPU/Browser/Utility", () => {
    const sample = rssSample(0, { Tab: 400_000_000, GPU: 100_000_000, Browser: 50_000_000 });
    expect(tabProcessBytes(sample)).toBe(400_000_000);
  });

  it("undefined si la muestra no trae ningún proceso Tab", () => {
    const sample = rssSample(0, { GPU: 100_000_000 });
    expect(tabProcessBytes(sample)).toBeUndefined();
  });

  it("undefined si la muestra es undefined", () => {
    expect(tabProcessBytes(undefined)).toBeUndefined();
  });
});

describe("computeUnattributedResidual", () => {
  it("RSS del proceso Tab menos lo que los isolates leídos explican", () => {
    const rss = rssSample(0, { Tab: 500_000_000 });
    const heap: HeapSample = {
      atMs: 0,
      targets: [
        target({
          sessionId: "a",
          usedSizeBytes: 100_000_000,
          embedderHeapUsedSizeBytes: 0,
          backingStorageSizeBytes: 50_000_000,
        }),
      ],
    };
    expect(computeUnattributedResidual(rss, heap)).toBe(500_000_000 - 150_000_000);
  });

  it("undefined si falta la muestra de RSS", () => {
    const heap: HeapSample = { atMs: 0, targets: [] };
    expect(computeUnattributedResidual(undefined, heap)).toBeUndefined();
  });

  it("undefined si falta la muestra de heap — nunca se asume 0 atribuido en su lugar", () => {
    const rss = rssSample(0, { Tab: 500_000_000 });
    expect(computeUnattributedResidual(rss, undefined)).toBeUndefined();
  });

  it("puede dar negativo, y no se oculta (sería señal de que attributedIsolateBytes sobreestimó)", () => {
    const rss = rssSample(0, { Tab: 10_000_000 });
    const heap: HeapSample = {
      atMs: 0,
      targets: [target({ sessionId: "a", usedSizeBytes: 50_000_000 })],
    };
    expect(computeUnattributedResidual(rss, heap)).toBe(10_000_000 - 50_000_000);
  });
});

describe("computeRunDurations", () => {
  it("uses epoch phase limits even when page performance origins are shifted", () => {
    const durations = computeRunDurations(
      { DOCUMENT_IMPORTED: 10_000, PIPELINE_READY: 10_325 },
      9_000,
    );
    expect(durations).toEqual({
      importedAtMs: 1_000,
      readyAtMs: 1_325,
      totalMs: 325,
      readyDurationMs: 325,
    });
  });
});

describe("computeTargetCoverage", () => {
  it("cuenta attempted/succeeded por sessionId a través de varias muestras", () => {
    const samples: HeapSample[] = [
      { atMs: 0, targets: [target({ sessionId: "ocr1", label: "ocr-worker-1" })] },
      {
        atMs: 100,
        targets: [target({ sessionId: "ocr1", label: "ocr-worker-1", readError: "timeout" })],
      },
      { atMs: 200, targets: [target({ sessionId: "ocr1", label: "ocr-worker-1" })] },
    ];
    const coverage = computeTargetCoverage(samples);
    expect(coverage).toEqual([
      { sessionId: "ocr1", label: "ocr-worker-1", attempted: 3, succeeded: 2 },
    ]);
  });

  it("usa la ULTIMA etiqueta vista para un sessionId, no la primera", () => {
    const samples: HeapSample[] = [
      { atMs: 0, targets: [target({ sessionId: "x", label: "leaf-worker-3" })] },
      { atMs: 100, targets: [target({ sessionId: "x", label: "ocr-worker-1" })] },
    ];
    const coverage = computeTargetCoverage(samples);
    expect(coverage[0]?.label).toBe("ocr-worker-1");
  });

  it("[] cuando no hay muestras en la ventana", () => {
    expect(computeTargetCoverage([])).toEqual([]);
  });

  it("targets distintos por sessionId no se mezclan entre si", () => {
    const samples: HeapSample[] = [
      {
        atMs: 0,
        targets: [target({ sessionId: "a" }), target({ sessionId: "b", readError: "timeout" })],
      },
    ];
    const coverage = computeTargetCoverage(samples);
    const bySessionId = new Map(coverage.map((c) => [c.sessionId, c]));
    expect(bySessionId.get("a")).toEqual({
      sessionId: "a",
      label: "leaf-worker-1",
      attempted: 1,
      succeeded: 1,
    });
    expect(bySessionId.get("b")).toEqual({
      sessionId: "b",
      label: "leaf-worker-1",
      attempted: 1,
      succeeded: 0,
    });
  });
});

describe("classifyPeakPosition (ADR-146 §7ter, plan A-2)", () => {
  it("'before-imported' cuando el máximo cae antes de la primera fase — el caso que §7bis quería atrapar", () => {
    const samples = [
      rssSample(0, { Tab: 900_000_000 }),
      rssSample(600, { Tab: 100_000_000 }),
      rssSample(1100, { Tab: 200_000_000 }),
    ];
    expect(classifyPeakPosition(samples, [segment(500, 1000)])).toBe("before-imported");
  });

  it("'within-phases' cuando el máximo cae dentro de la ventana de fases", () => {
    const samples = [
      rssSample(0, { Tab: 100_000_000 }),
      rssSample(700, { Tab: 900_000_000 }),
      rssSample(1200, { Tab: 200_000_000 }),
    ];
    expect(classifyPeakPosition(samples, [segment(500, 1000)])).toBe("within-phases");
  });

  it("'after-last-phase' cuando el máximo cae después de la última fase — el caso de las 12 corridas del 2026-09-17", () => {
    const samples = [
      rssSample(0, { Tab: 100_000_000 }),
      rssSample(700, { Tab: 200_000_000 }),
      rssSample(1200, { Tab: 900_000_000 }),
    ];
    expect(classifyPeakPosition(samples, [segment(500, 1000)])).toBe("after-last-phase");
  });

  it("'no-phase-data' sin segmentos — corrida fallida antes del segundo evento de fase", () => {
    expect(classifyPeakPosition([rssSample(0, { Tab: 1 })], [])).toBe("no-phase-data");
  });

  it("discriminante (ADR-149 §2): la regla vieja de §7bis invalidaba 'after-last-phase' igual que 'before-imported' — la nueva las distingue", () => {
    // Números reales de memory-p1-native-10p-run0.json [hot]
    // (.measure/memory-recaracterizacion/20260917T174553Z/): peakAtMs=8151,
    // ventana de fases [6750, 7277] — una de las 12 corridas descartadas por
    // §7bis y que §7ter revalida.
    const samples = [
      rssSample(6750, { Tab: 500_000_000 }),
      rssSample(7277, { Tab: 550_000_000 }),
      rssSample(8151, { Tab: 563_300_000 }),
    ];
    const position = classifyPeakPosition(samples, [segment(6750, 7277)]);
    // La regla vieja (ADR-146 §7bis: "cualquier pico fuera de [primera,
    // última fase] invalida") no distinguía este caso del residuo del
    // documento anterior — las dos daban `peakFallsWithinPhases: false`.
    // §7ter exige además que el máximo esté ANTES de la ventana.
    expect(position).toBe("after-last-phase");
    expect(position).not.toBe("before-imported");
  });
});

describe("computeM2WithinPhases (ADR-146 §7ter)", () => {
  it("M2 es el máximo DENTRO de la ventana de fases, no el máximo global del run", () => {
    const samples = [
      rssSample(0, { Tab: 100_000_000 }),
      rssSample(700, { Tab: 400_000_000 }), // dentro de la ventana — es el M2 esperado
      rssSample(1200, { Tab: 900_000_000 }), // después de Ready — no debe contar para M2
    ];
    expect(computeM2WithinPhases(samples, [segment(500, 1000)])).toBe(400_000_000);
  });

  it("null sin segmentos — el llamador cae de vuelta al pico global en ese caso", () => {
    expect(computeM2WithinPhases([rssSample(0, { Tab: 1 })], [])).toBeNull();
  });
});

describe("computePostReadyPeakBytes (ADR-146 §7ter — métrica obligatoria, nunca fundida con M2)", () => {
  it("el máximo de las muestras posteriores a la última fase", () => {
    const samples = [
      rssSample(700, { Tab: 400_000_000 }),
      rssSample(1200, { Tab: 900_000_000 }),
      rssSample(1400, { Tab: 700_000_000 }),
    ];
    expect(computePostReadyPeakBytes(samples, [segment(500, 1000)])).toBe(900_000_000);
  });

  it("null si no hay ninguna muestra posterior a la última fase — no se inventa un 0", () => {
    const samples = [rssSample(700, { Tab: 400_000_000 })];
    expect(computePostReadyPeakBytes(samples, [segment(500, 1000)])).toBeNull();
  });

  it("null sin segmentos", () => {
    expect(computePostReadyPeakBytes([rssSample(0, { Tab: 1 })], [])).toBeNull();
  });
});

describe("computePhaseSegments — fases sin muestras (A-3, plan de arreglo del instrumento §4)", () => {
  it("measurable=false y peakInternalBytes=null cuando ninguna muestra cae dentro del tramo — nunca un 0 fabricado", () => {
    // Réplica de P1: cadencia de referencia 150ms, fase de 12ms — ninguna
    // muestra cae dentro de [1000, 1012] (README: "las fases cortas no
    // reciben ninguna").
    const samples: MemorySample[] = [
      rssSample(850, { Tab: 500_000_000 }),
      rssSample(1150, { Tab: 520_000_000 }),
    ];
    const segments = computePhaseSegments({ PHASE_A: 1000, PHASE_B: 1012 }, samples, 0, [], [], 0);
    expect(segments).toHaveLength(1);
    const seg = segments[0]!;
    expect(seg.sampleCountInWindow).toBe(0);
    expect(seg.measurable).toBe(false);
    expect(seg.peakInternalBytes).toBeNull();
    // Discriminante (ADR-149 §2): la lógica vieja calculaba
    // `peakSumBytes(samplesBetween(...))` sin chequear si el resultado tenía
    // datos — `peakSumBytes([])` da `0`, un pico fabricado. Confirma que acá
    // NO se publica ese 0.
    expect(seg.peakInternalBytes).not.toBe(0);
  });

  it("measurable=true y un pico real cuando al menos una muestra cae dentro del tramo", () => {
    const samples: MemorySample[] = [
      rssSample(950, { Tab: 500_000_000 }),
      rssSample(1005, { Tab: 600_000_000 }), // dentro de [1000, 1012]
      rssSample(1150, { Tab: 520_000_000 }),
    ];
    const segments = computePhaseSegments({ PHASE_A: 1000, PHASE_B: 1012 }, samples, 0, [], [], 0);
    const seg = segments[0]!;
    expect(seg.sampleCountInWindow).toBe(1);
    expect(seg.measurable).toBe(true);
    expect(seg.peakInternalBytes).toBe(600_000_000);
  });
});
