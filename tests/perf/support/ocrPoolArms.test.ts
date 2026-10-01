import { describe, expect, it } from "vitest";

import { assertsFullOccupancy, parseArmLabel } from "./ocrPoolArms.js";

describe("parseArmLabel", () => {
  it("el brazo 4b pide cuatro reconocedores con 136 MiB (cuatro A4 a 300 dpi)", () => {
    expect(parseArmLabel("4b")).toEqual({
      label: "4b",
      poolSize: 4,
      maxLiveImageBytes: 136 * 1024 * 1024,
    });
    expect((136 * 1024 * 1024) / (2481 * 3508 * 4)).toBeGreaterThanOrEqual(4);
  });

  it("el brazo 6b pide seis reconocedores con 200 MiB", () => {
    expect(parseArmLabel("6b")).toEqual({
      label: "6b",
      poolSize: 6,
      maxLiveImageBytes: 200 * 1024 * 1024,
    });
  });

  it("los demás brazos conservan 128 MiB, incluido el 6", () => {
    for (const label of ["1", "2", "3", "4", "6"]) {
      expect(parseArmLabel(label)?.maxLiveImageBytes).toBe(128 * 1024 * 1024);
    }
    expect(parseArmLabel("6")?.poolSize).toBe(6);
  });

  it("rechaza brazos desconocidos", () => {
    for (const label of ["", "5", "7", "6B", "6c", "b"])
      expect(parseArmLabel(label)).toBeUndefined();
  });
});

describe("assertsFullOccupancy", () => {
  it("afirma ocupación completa hasta 4 con 128 MiB y solo registra en 4b, 6 y 6b", () => {
    const asserted = ["1", "2", "3", "4", "4b", "6", "6b"].map((label) => {
      const arm = parseArmLabel(label);
      return arm !== undefined && assertsFullOccupancy(arm);
    });
    expect(asserted).toEqual([true, true, true, true, false, false, false]);
  });
});
