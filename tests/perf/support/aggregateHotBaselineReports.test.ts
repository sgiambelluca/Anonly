/**
 * `aggregateHotBaselineReports.test.ts` — cubre las dos funciones puras que
 * el agregador de T-7 usa para resumir una curva: `computeCurveDelta` (C-1:
 * "el delta entre t=5s y t=120s") y `computeLargestStep` (candidato a
 * escalón). No cubre `main()` (I/O de `.measure/`, se ejerce corriendo la
 * campaña real).
 */
import { describe, expect, it } from "vitest";

import { computeCurveDelta, computeLargestStep } from "./aggregateHotBaselineReports.js";
import type { ReleaseCurvePoint } from "./hotBaselineCurve.js";

function point(targetMs: number, sumBytes: number | null): ReleaseCurvePoint {
  return {
    targetMs,
    relativeAtMs: sumBytes === null ? null : targetMs,
    lagMs: 0,
    sumBytes,
    perProcessType: [],
  };
}

describe("computeCurveDelta", () => {
  it("resta el último checkpoint menos el primero", () => {
    const curve = [
      point(5_000, 2_000_000_000),
      point(60_000, 1_800_000_000),
      point(120_000, 1_700_000_000),
    ];
    expect(computeCurveDelta(curve)).toEqual({
      fromTargetMs: 5_000,
      toTargetMs: 120_000,
      deltaBytes: -300_000_000,
    });
  });

  it("null si el primer punto no tiene muestra", () => {
    const curve = [point(5_000, null), point(120_000, 1_000)];
    expect(computeCurveDelta(curve)).toBeNull();
  });

  it("null si el último punto no tiene muestra", () => {
    const curve = [point(5_000, 1_000), point(120_000, null)];
    expect(computeCurveDelta(curve)).toBeNull();
  });

  it("null con curva vacía", () => {
    expect(computeCurveDelta([])).toBeNull();
  });
});

describe("computeLargestStep", () => {
  it("encuentra el paso consecutivo de mayor magnitud, con signo", () => {
    const curve = [
      point(5_000, 2_000_000_000),
      point(15_000, 1_990_000_000), // -10MB
      point(30_000, 1_980_000_000), // -10MB
      point(45_000, 1_975_000_000), // -5MB
      point(60_000, 1_800_000_000), // -175MB — el escalón candidato
      point(75_000, 1_795_000_000), // -5MB
    ];
    expect(computeLargestStep(curve)).toEqual({
      fromTargetMs: 45_000,
      toTargetMs: 60_000,
      deltaBytes: -175_000_000,
    });
  });

  it("un hueco sin muestra en el medio no se salta — no compara a través de él", () => {
    const curve = [point(5_000, 1_000_000_000), point(15_000, null), point(30_000, 500_000_000)];
    // Los dos únicos pares ADYACENTES (5s→15s y 15s→30s) tienen un lado null:
    // ninguno califica. Comparar 5s contra 30s "saltando" el hueco inventaría
    // un paso sobre un tramo que no se midió.
    expect(computeLargestStep(curve)).toBeNull();
  });

  it("con un hueco en el medio, sí encuentra el paso entre los pares completos que quedan", () => {
    const curve = [
      point(5_000, 1_000_000_000),
      point(15_000, null),
      point(30_000, 500_000_000),
      point(45_000, 480_000_000),
    ];
    expect(computeLargestStep(curve)).toEqual({
      fromTargetMs: 30_000,
      toTargetMs: 45_000,
      deltaBytes: -20_000_000,
    });
  });

  it("null cuando no hay ningún par con muestra en los dos lados", () => {
    const curve = [point(5_000, null), point(15_000, null)];
    expect(computeLargestStep(curve)).toBeNull();
  });

  it("null con menos de dos puntos", () => {
    expect(computeLargestStep([point(5_000, 1_000)])).toBeNull();
    expect(computeLargestStep([])).toBeNull();
  });
});
