import { describe, expect, it } from "vitest";

import { lowProfileMismatches, type EffectiveProfileEvidence } from "./ocrPoolLowProfile.js";

const LOW: EffectiveProfileEvidence = {
  performancePreset: "low",
  engineOverridesPresent: false,
  workerPool: { pdfPoolSize: 1, ocrPoolSize: 1, nerPoolSize: 1, renderPoolSize: 1 },
  maxLiveImageBytes: 128 * 1024 * 1024,
};

describe("lowProfileMismatches (perfil Bajo por setting, ADR-194 §2)", () => {
  it("el perfil Bajo exacto no tiene diferencias", () => {
    expect(lowProfileMismatches(LOW)).toEqual([]);
  });

  it("sin evidencia es inválido, no un pase", () => {
    expect(lowProfileMismatches(undefined)).toHaveLength(1);
  });

  it("un brazo `1` sobre base medium no es el perfil Bajo: pdf y render quedan en el default", () => {
    const armOneOnMedium: EffectiveProfileEvidence = {
      performancePreset: "medium",
      engineOverridesPresent: true,
      workerPool: { pdfPoolSize: 4, ocrPoolSize: 1, nerPoolSize: 2, renderPoolSize: 4 },
      maxLiveImageBytes: 128 * 1024 * 1024,
    };
    const mismatches = lowProfileMismatches(armOneOnMedium);
    expect(mismatches.join("|")).toContain("performancePreset");
    expect(mismatches.join("|")).toContain("anonly:engine-overrides");
    expect(mismatches.join("|")).toContain("pdfPoolSize efectivo=4");
    expect(mismatches.join("|")).toContain("nerPoolSize efectivo=2");
    expect(mismatches.join("|")).toContain("renderPoolSize efectivo=4");
    expect(mismatches.join("|")).not.toContain("ocrPoolSize");
  });

  it.each(["pdfPoolSize", "ocrPoolSize", "nerPoolSize", "renderPoolSize"] as const)(
    "%s distinto de 1 o no observable invalida la corrida",
    (key) => {
      for (const observed of [2, null]) {
        const mismatches = lowProfileMismatches({
          ...LOW,
          workerPool: { ...LOW.workerPool, [key]: observed },
        });
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0]).toContain(`${key} efectivo=${observed ?? "no observable"}`);
      }
    },
  );

  it("un presupuesto de imágenes vivas distinto del default invalida la corrida", () => {
    expect(lowProfileMismatches({ ...LOW, maxLiveImageBytes: 200 * 1024 * 1024 })).toHaveLength(1);
    expect(lowProfileMismatches({ ...LOW, maxLiveImageBytes: null })).toHaveLength(1);
  });

  it("un preset persistido distinto de low o ausente invalida la corrida", () => {
    expect(lowProfileMismatches({ ...LOW, performancePreset: "auto" })).toHaveLength(1);
    expect(lowProfileMismatches({ ...LOW, performancePreset: null })).toHaveLength(1);
  });
});
