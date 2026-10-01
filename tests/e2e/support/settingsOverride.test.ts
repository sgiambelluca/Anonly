import { describe, expect, it } from "vitest";

import { baseSettings, isMeasurementSuite } from "./settingsOverride.js";

describe("settingsOverride: perfil fijo de las suites de medición (ADR-194 §8)", () => {
  it.each([
    "/repo/tests/perf/memory.spec.ts",
    "/repo/tests/leak/leak.spec.ts",
    "/repo/tests/stress/stress.spec.ts",
    "/repo/tests/measure/baseline.spec.ts",
    "C:\\repo\\tests\\perf\\ocr-pool.spec.ts",
  ])("%s fija medium con settingsVersion 2", (file) => {
    expect(isMeasurementSuite(file)).toBe(true);
    expect(baseSettings(file)).toEqual({ settingsVersion: 2, performancePreset: "medium" });
  });

  it("un E2E funcional sigue en Automático: solo settingsVersion 2, sin preset", () => {
    const file = "/repo/tests/e2e/scenario-5.spec.ts";
    expect(isMeasurementSuite(file)).toBe(false);
    expect(baseSettings(file)).toEqual({ settingsVersion: 2 });
  });
});
