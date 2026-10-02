import { describe, expect, it } from "vitest";

import {
  ENFORCE_BUDGET_ENV,
  evaluateFirstPageWarm,
  evaluatePipelineTiming,
  isBudgetEnforced,
} from "./pipelineTiming.js";

describe("isBudgetEnforced", () => {
  it("solo con ANONLY_PERF_ENFORCE_BUDGET=1", () => {
    expect(isBudgetEnforced({ [ENFORCE_BUDGET_ENV]: "1" })).toBe(true);
    expect(isBudgetEnforced({})).toBe(false);
    expect(isBudgetEnforced({ [ENFORCE_BUDGET_ENV]: "0" })).toBe(false);
    expect(isBudgetEnforced({ [ENFORCE_BUDGET_ENV]: "true" })).toBe(false);
    expect(isBudgetEnforced({ [ENFORCE_BUDGET_ENV]: "" })).toBe(false);
  });
});

describe("evaluatePipelineTiming", () => {
  const BUDGET = 8_000;

  it("sin umbral, una corrida lenta pasa y reporta su tiempo", () => {
    const verdict = evaluatePipelineTiming({ startedAt: 100, readyAt: 20_100 }, BUDGET, false);
    expect(verdict).toEqual({ elapsedMs: 20_000, failures: [] });
  });

  it("con umbral, una corrida lenta falla, y una rápida pasa", () => {
    const slow = evaluatePipelineTiming({ startedAt: 0, readyAt: 8_000 }, BUDGET, true);
    expect(slow.failures).toHaveLength(1);
    expect(slow.failures[0]).toContain("8000 ms");
    const fast = evaluatePipelineTiming({ startedAt: 0, readyAt: 3_500 }, BUDGET, true);
    expect(fast).toEqual({ elapsedMs: 3_500, failures: [] });
  });

  it("falla siempre si no llegó a Ready, con o sin umbral", () => {
    for (const enforce of [false, true]) {
      const verdict = evaluatePipelineTiming({ startedAt: 0 }, BUDGET, enforce);
      expect(verdict.elapsedMs).toBeNull();
      expect(verdict.failures).toEqual(["el pipeline no llegó a Ready"]);
    }
  });

  it("falla siempre si el pipeline terminó en PIPELINE_FAILED", () => {
    for (const enforce of [false, true]) {
      const verdict = evaluatePipelineTiming({ startedAt: 0, failedAt: 500 }, BUDGET, enforce);
      expect(verdict.failures).toContain("el pipeline terminó en PIPELINE_FAILED, no en Ready");
    }
  });

  it("falla siempre si nada corrió (tiempo cero, negativo o no finito)", () => {
    for (const readyAt of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const verdict = evaluatePipelineTiming({ startedAt: 0, readyAt }, BUDGET, false);
      expect(verdict.failures).toHaveLength(1);
      expect(verdict.failures[0]).toContain("no se midió ningún trabajo");
    }
  });

  it("no acumula el motivo de umbral encima de un tiempo inválido", () => {
    const verdict = evaluatePipelineTiming({ startedAt: 10, readyAt: 5 }, BUDGET, true);
    expect(verdict.failures).toHaveLength(1);
  });
});

describe("evaluateFirstPageWarm", () => {
  it("con umbral, un RENDER_REQUESTED para la página 1 es un fallo", () => {
    expect(evaluateFirstPageWarm(true, true)).toHaveLength(1);
    expect(evaluateFirstPageWarm(false, true)).toEqual([]);
  });

  it("sin umbral, no se exige (se reporta)", () => {
    expect(evaluateFirstPageWarm(true, false)).toEqual([]);
    expect(evaluateFirstPageWarm(false, false)).toEqual([]);
  });
});
