/**
 * `memoryProfile.test.ts` — cubre las funciones puras de ADR-159 §8 (el
 * residuo "no atribuido") y §6 (cobertura por target/fase) que
 * `memoryProfile.ts` exporta para esto. No cubre `measureProfile`/
 * `runImport` (necesitan una `Page`/`ElectronApplication` reales — eso lo
 * prueba `pnpm test:perf`, no vitest).
 */
import { describe, expect, it } from "vitest";

import type { ClassifiedTargetHeapSample, HeapSample } from "./cdpHeap.js";
import {
  attributedIsolateBytes,
  computeTargetCoverage,
  computeUnattributedResidual,
  tabProcessBytes,
} from "./memoryProfile.js";
import type { MemorySample } from "./memorySampler.js";

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
