import { describe, expect, it } from "vitest";

import type { ClassifiedTargetHeapSample } from "./cdpHeap.js";
import {
  computeTrends,
  judgeLeak,
  linearTrend,
  median,
  medianOverWindow,
  summarizeHeap,
  type CycleRecord,
} from "./leakCycles.js";
import type { MemorySample } from "./memorySampler.js";
import type { SystemMemoryPressureSample } from "./systemMemoryPressure.js";

const MB = 1_000_000;

function sample(atMs: number, byType: Record<string, number[]>): MemorySample {
  const perProcess = Object.entries(byType).flatMap(([type, sizes]) =>
    sizes.map((bytes, i) => ({ pid: i + 1, type, workingSetSizeBytes: bytes })),
  );
  return {
    atMs,
    sumWorkingSetSizeBytes: perProcess.reduce((acc, p) => acc + p.workingSetSizeBytes, 0),
    perProcess,
  };
}

function pressure(compressorBytes: number, swapUsedBytes: number): SystemMemoryPressureSample {
  return {
    available: true,
    freeBytes: 1_000 * MB,
    compressorBytes,
    compressorUnavailableReason: undefined,
    swapUsedBytes,
  };
}

interface RecordOverrides {
  readonly heapUsed?: number;
  readonly workers?: number;
  readonly restSum?: number;
  readonly ok?: boolean;
  readonly pressureStart?: SystemMemoryPressureSample;
  readonly pressureEnd?: SystemMemoryPressureSample;
}

function record(cycle: number, o: RecordOverrides = {}): CycleRecord {
  const restSum = o.restSum ?? 800 * MB;
  return {
    cycle,
    ok: cycle === 0 ? null : (o.ok ?? true),
    importToReadyMs: cycle === 0 ? null : 500,
    peakSumBytes: cycle === 0 ? null : 1_500 * MB,
    peakTabBytes: cycle === 0 ? null : 900 * MB,
    groupCount: cycle === 0 ? null : 3,
    entityCount: cycle === 0 ? null : 5,
    ocrPageCount: cycle === 0 ? null : 0,
    nerModelLoaded: cycle === 0 ? null : cycle === 1,
    rest: { sampleCount: 20, sumBytes: restSum, byTypeBytes: { Tab: restSum / 2 } },
    heap: {
      pageUsedBytes: o.heapUsed ?? 40 * MB,
      pageBackingBytes: 2 * MB,
      workerCount: o.workers ?? 3,
      workerLabels: [],
      unreadableCount: 0,
    },
    postGcSumBytes: restSum - 10 * MB,
    systemPressureAtStart: o.pressureStart ?? pressure(500 * MB, 0),
    systemPressureAtEnd: o.pressureEnd ?? pressure(500 * MB, 0),
  };
}

function series(make: (cycle: number) => RecordOverrides): ReadonlyArray<CycleRecord> {
  return Array.from({ length: 11 }, (_, cycle) => record(cycle, make(cycle)));
}

describe("median", () => {
  it("devuelve null sin valores, el central con cantidad impar y el promedio de los dos centrales con par", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("medianOverWindow", () => {
  it("toma solo las muestras de la ventana y suma los procesos del mismo tipo dentro de cada muestra", () => {
    const samples = [
      sample(0, { Tab: [900 * MB] }),
      sample(1_000, { Tab: [100 * MB, 50 * MB], GPU: [80 * MB] }),
      sample(2_000, { Tab: [120 * MB, 50 * MB], GPU: [90 * MB] }),
      sample(3_000, { Tab: [140 * MB, 50 * MB], GPU: [70 * MB] }),
      sample(9_000, { Tab: [900 * MB] }),
    ];
    const result = medianOverWindow(samples, 1_000, 3_000);
    expect(result?.sampleCount).toBe(3);
    expect(result?.sumBytes).toBe(260 * MB);
    expect(result?.byTypeBytes).toEqual({ GPU: 80 * MB, Tab: 170 * MB });
  });

  it("devuelve null si ninguna muestra cae en la ventana, nunca un cero", () => {
    expect(medianOverWindow([sample(0, { Tab: [1] })], 5_000, 6_000)).toBeNull();
  });
});

describe("linearTrend", () => {
  it("recupera la pendiente de una recta exacta, con error estándar cero", () => {
    const t = linearTrend([2, 3, 4, 5].map((x) => ({ x, y: 10 * x + 7 })));
    expect(t?.slope).toBeCloseTo(10);
    expect(t?.intercept).toBeCloseTo(7);
    expect(t?.slopeStdErr).toBeCloseTo(0);
  });

  it("da el error estándar de libro con residuos conocidos", () => {
    // y = 0, 2, 0, 2 en x = 0..3: pendiente 0,4, SSR 3,2, Sxx 5 → SE = √(3,2 / 2 / 5).
    const t = linearTrend([0, 2, 0, 2].map((y, x) => ({ x, y })));
    expect(t?.slope).toBeCloseTo(0.4);
    expect(t?.slopeStdErr).toBeCloseTo(Math.sqrt(3.2 / 2 / 5));
  });

  it("no inventa una pendiente con menos de dos puntos ni con todas las x iguales, ni un error estándar con dos", () => {
    expect(linearTrend([{ x: 1, y: 1 }])).toBeNull();
    expect(
      linearTrend([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ]),
    ).toBeNull();
    expect(
      linearTrend([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ])?.slopeStdErr,
    ).toBeNull();
  });
});

describe("summarizeHeap", () => {
  function target(
    label: string,
    type: string,
    usedSizeBytes: number | undefined,
    readError?: string,
  ): ClassifiedTargetHeapSample {
    return {
      sessionId: label,
      parentSessionId: undefined,
      type,
      url: "",
      attachedAtMs: 0,
      usedSizeBytes,
      totalSizeBytes: usedSizeBytes,
      embedderHeapUsedSizeBytes: 0,
      backingStorageSizeBytes: usedSizeBytes === undefined ? undefined : 1 * MB,
      readError,
      label,
      note: "",
      factoryChunk: "unknown",
      workerRole: "unknown",
    };
  }

  it("separa el hilo principal de los workers, a cualquier profundidad, y cuenta los que no contestaron", () => {
    const heap = summarizeHeap([
      target("main", "page", 40 * MB),
      target("leaf-worker-1", "worker", 5 * MB),
      target("thread-pool-worker-1/thread-0", "worker", undefined, "sin respuesta"),
    ]);
    expect(heap.pageUsedBytes).toBe(40 * MB);
    expect(heap.pageBackingBytes).toBe(1 * MB);
    expect(heap.workerCount).toBe(2);
    expect(heap.unreadableCount).toBe(1);
  });

  it("devuelve null para el hilo principal si no hay página o no se pudo leer", () => {
    expect(summarizeHeap([]).pageUsedBytes).toBeNull();
    expect(summarizeHeap([target("main", "page", undefined, "x")]).pageUsedBytes).toBeNull();
  });
});

describe("computeTrends", () => {
  it("ajusta sobre los ciclos 2 a 10 y deja afuera los fallidos, declarándolos", () => {
    const records = series((cycle) => ({ restSum: (800 + 10 * cycle) * MB, ok: cycle !== 6 }));
    const rest = computeTrends(records).find((t) => t.metric === "restSumBytes");
    expect(rest?.trend?.n).toBe(8);
    expect(rest?.trend?.slope).toBeCloseTo(10 * MB);
    expect(rest?.excludedCycles).toEqual([6]);
  });
});

describe("judgeLeak — los criterios de plan §2.5", () => {
  it("una serie plana no es una fuga en ninguna señal", () => {
    const records = series(() => ({}));
    const verdict = judgeLeak(records, computeTrends(records));
    expect(verdict).toMatchObject({
      workersGrow: false,
      heapGrows: false,
      rssGrows: false,
      rssConfounded: false,
    });
  });

  it("el heap que crece 1 MB por ciclo (8 MB entre el 2 y el 10) es una fuga; 0,5 MB por ciclo no llega a 5 MB", () => {
    const wobble = (cycle: number): number => (cycle % 2 === 0 ? 0.05 : -0.05) * MB;
    const growing = series((cycle) => ({ heapUsed: 40 * MB + cycle * MB + wobble(cycle) }));
    expect(judgeLeak(growing, computeTrends(growing)).heapGrows).toBe(true);
    const small = series((cycle) => ({ heapUsed: 40 * MB + cycle * 0.5 * MB + wobble(cycle) }));
    expect(judgeLeak(small, computeTrends(small)).heapGrows).toBe(false);
  });

  it("el RSS necesita las dos cosas: más de dos errores estándar y al menos 10 MB por ciclo", () => {
    const steep = series((cycle) => ({ restSum: (800 + 12 * cycle + (cycle % 2) * 3) * MB }));
    expect(judgeLeak(steep, computeTrends(steep)).rssGrows).toBe(true);
    const gentle = series((cycle) => ({ restSum: (800 + 6 * cycle + (cycle % 2) * 3) * MB }));
    expect(judgeLeak(gentle, computeTrends(gentle)).rssGrows).toBe(false);
    const noisy = series((cycle) => ({ restSum: (800 + 12 * cycle + (cycle % 2) * 200) * MB }));
    expect(judgeLeak(noisy, computeTrends(noisy)).rssGrows).toBe(false);
  });

  it("un pool que llega a su tamaño en los primeros ciclos no es una fuga; un worker de más al final sí", () => {
    const warming = series((cycle) => ({ workers: cycle < 3 ? 2 : 4 }));
    expect(judgeLeak(warming, computeTrends(warming)).workersGrow).toBe(false);
    const leaking = series((cycle) => ({ workers: cycle === 10 ? 5 : 4 }));
    expect(judgeLeak(leaking, computeTrends(leaking)).workersGrow).toBe(true);
  });

  it("si el compresor se mueve más de 500 MB entre el primer y el último ciclo, el RSS queda confundido", () => {
    const records = series((cycle) => ({
      pressureStart: pressure(500 * MB, 0),
      pressureEnd: pressure(cycle === 10 ? 1_200 * MB : 500 * MB, 0),
    }));
    const verdict = judgeLeak(records, computeTrends(records));
    expect(verdict.rssConfounded).toBe(true);
    expect(verdict.pressureDeltaBytes.compressor).toBe(700 * MB);
  });
});
