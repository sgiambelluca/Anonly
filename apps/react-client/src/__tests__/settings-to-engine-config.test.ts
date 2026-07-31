import { describe, expect, it } from "vitest";

import { deriveEngineConfigOverrides } from "../core-adapter/settingsToEngineConfig.js";

describe("deriveEngineConfigOverrides", () => {
  it("maps nerEnabled directly to ner.enabled (true)", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "auto",
      nerEnabled: true,
      ocrLanguages: ["spa", "eng"],
    });
    expect(overrides.ner).toEqual({ enabled: true });
  });

  it("maps nerEnabled directly to ner.enabled (false)", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "auto",
      nerEnabled: false,
      ocrLanguages: ["spa", "eng"],
    });
    expect(overrides.ner).toEqual({ enabled: false });
  });

  it("maps ocrLanguages directly to ocr.languages", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "auto",
      nerEnabled: true,
      ocrLanguages: ["eng"],
    });
    expect(overrides.ocr).toEqual({ languages: ["eng"] });
  });

  it("auto omits the workerPool key entirely (not {}, not undefined)", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "auto",
      nerEnabled: true,
      ocrLanguages: ["spa", "eng"],
    });
    expect("workerPool" in overrides).toBe(false);
    expect(overrides).toEqual({
      ner: { enabled: true },
      ocr: { languages: ["spa", "eng"] },
    });
  });

  it("low sends the fixed pool sizes from React_Client.md §3.7", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "low",
      nerEnabled: true,
      ocrLanguages: ["spa", "eng"],
    });
    expect(overrides.workerPool).toEqual({
      pdfPoolSize: 1,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 1,
    });
  });

  it("high sends the fixed pool sizes from React_Client.md §3.7", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "high",
      nerEnabled: true,
      ocrLanguages: ["spa", "eng"],
    });
    expect(overrides.workerPool).toEqual({
      pdfPoolSize: 4,
      ocrPoolSize: 2,
      nerPoolSize: 2,
      renderPoolSize: 4,
    });
  });

  it("returns the full override shape for a representative low case", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "low",
      nerEnabled: false,
      ocrLanguages: ["spa"],
    });
    expect(overrides).toEqual({
      ner: { enabled: false },
      ocr: { languages: ["spa"] },
      workerPool: {
        pdfPoolSize: 1,
        ocrPoolSize: 1,
        nerPoolSize: 1,
        renderPoolSize: 1,
      },
    });
  });

  it("returns the full override shape for a representative high case", () => {
    const overrides = deriveEngineConfigOverrides({
      performancePreset: "high",
      nerEnabled: true,
      ocrLanguages: ["eng"],
    });
    expect(overrides).toEqual({
      ner: { enabled: true },
      ocr: { languages: ["eng"] },
      workerPool: {
        pdfPoolSize: 4,
        ocrPoolSize: 2,
        nerPoolSize: 2,
        renderPoolSize: 4,
      },
    });
  });
});
