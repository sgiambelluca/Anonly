/**
 * `aggregateMemoryReports.test.ts` — cubre `computeProcessFloors` (ADR-159
 * §3: el piso, por corrida individual, nunca promediado) contra series
 * sintéticas de `MemorySample`. `aggregateMemoryReports.ts` solo corre su
 * `main()` cuando es el entrypoint (ver el guard `import.meta.url ===
 * pathToFileURL(process.argv[1]).href` al final del archivo) — importarlo
 * acá para `computeProcessFloors` no dispara una lectura de `.measure/`.
 *
 * Los números concretos de esta función ya se cruzaron contra un dato real:
 * corriendo `pnpm tsx tests/perf/support/aggregateMemoryReports.ts` sobre
 * los `.measure/memory-p2-scanned-50p-run{0,1,2}.json` existentes (los de la
 * rama del spike descartado, ADR-159 §4), el piso de Tab en la fase
 * OCR_STARTED→OCR_FINISHED dio +114.7 / +242.8 / +76.4 MB — contra los
 * +115 / +243 / +76 MB que ADR-159 §3 publica para esas mismas corridas.
 */
import { describe, expect, it } from "vitest";

import { computeProcessFloors } from "./aggregateMemoryReports.js";
import type { PhaseSegment, RunReport } from "./memoryProfile.js";
import type { MemorySample } from "./memorySampler.js";

function sample(atMs: number, byType: Readonly<Record<string, number>>): MemorySample {
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

function segment(
  overrides: Partial<PhaseSegment> & Pick<PhaseSegment, "fromAtMs" | "toAtMs">,
): PhaseSegment {
  return {
    fromEvent: "OCR_STARTED",
    toEvent: "OCR_FINISHED",
    rssAtEntryBytes: 0,
    rssAtExitBytes: 0,
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
    ...overrides,
  };
}

function run(overrides: Partial<RunReport>): RunReport {
  return {
    temperature: "hot",
    baselineBytes: 0,
    peakSumBytes: 0,
    m1Bytes: null,
    phases: {},
    workerPeakByType: {},
    startedAtMs: 0,
    readyAtMs: null,
    totalMs: null,
    groupCount: 0,
    entityCount: 0,
    ok: true,
    phaseSegments: [],
    samples: [],
    heapSamples: [],
    workerEvents: [],
    peakWithinPhases: true,
    hotBaselineSettled: null,
    ...overrides,
  };
}

describe("computeProcessFloors", () => {
  it("da positivo cuando el piso de un proceso sube durante la fase (diente de sierra incluido)", () => {
    // Tab oscila (el diente de sierra que ADR-159 §1 encontró que domina la
    // regresión cruda) pero su PISO —mínimo del primer cuarto contra mínimo
    // del último— sube de forma consistente. GPU se mantiene sin cambios.
    const samples: MemorySample[] = [
      sample(0, { Tab: 400, GPU: 100 }),
      sample(250, { Tab: 600, GPU: 100 }),
      sample(500, { Tab: 420, GPU: 100 }),
      sample(750, { Tab: 650, GPU: 100 }),
      sample(1000, { Tab: 500, GPU: 100 }),
    ];
    const report = run({
      samples,
      phaseSegments: [segment({ fromAtMs: 0, toAtMs: 1000 })],
    });

    const floors = computeProcessFloors(report);
    const tab = floors.find((f) => f.processType === "Tab");
    const gpu = floors.find((f) => f.processType === "GPU");

    // Primer cuarto = [0, 250] → min(400, 600) = 400. Último cuarto = [750, 1000] → min(650, 500) = 500.
    expect(tab?.firstQuarterMinBytes).toBe(400);
    expect(tab?.lastQuarterMinBytes).toBe(500);
    expect(tab?.floorDeltaBytes).toBe(100);
    expect(gpu?.floorDeltaBytes).toBe(0);
  });

  it("no promedia entre fases: una fase por segmento, cada una con su propio piso", () => {
    const samples: MemorySample[] = [
      sample(0, { Tab: 100 }),
      sample(500, { Tab: 100 }),
      sample(1000, { Tab: 100 }),
      sample(1500, { Tab: 300 }),
      sample(2000, { Tab: 300 }),
    ];
    const report = run({
      samples,
      phaseSegments: [
        segment({ fromEvent: "A", toEvent: "B", fromAtMs: 0, toAtMs: 1000 }),
        segment({ fromEvent: "B", toEvent: "C", fromAtMs: 1000, toAtMs: 2000 }),
      ],
    });

    const floors = computeProcessFloors(report);
    expect(floors).toHaveLength(2);
    expect(floors.find((f) => f.toEvent === "B")?.floorDeltaBytes).toBe(0);
    expect(floors.find((f) => f.toEvent === "C")?.floorDeltaBytes).toBe(200);
  });

  it("no calcula nada para una fase sin muestras dentro de su ventana", () => {
    const report = run({
      samples: [sample(5000, { Tab: 100 })],
      phaseSegments: [segment({ fromAtMs: 0, toAtMs: 1000 })],
    });
    expect(computeProcessFloors(report)).toEqual([]);
  });

  it("devuelve [] para un reporte de antes de ADR-146 §7 punto 3 (sin phaseSegments/samples)", () => {
    // Simulado con JSON.stringify/parse (no un cast): un `JSON.stringify`
    // OMITE las claves en `undefined`, así que el objeto que vuelve carece
    // literalmente de `phaseSegments`/`samples` — la misma forma que tiene
    // un archivo real de `.measure/` escrito antes de que existieran esos
    // campos, sin recurrir a `as unknown as` (prohibido salvo en fixtures de
    // frontera contra librerías externas, `Code_Standards.md` §10, que este
    // caso no es).
    const legacyReport: RunReport = JSON.parse(
      JSON.stringify({ ...run({}), phaseSegments: undefined, samples: undefined }),
    );
    expect(computeProcessFloors(legacyReport)).toEqual([]);
  });
});
