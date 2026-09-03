import { describe, expect, it } from "vitest";

import {
  deriveEngineConfigOverrides,
  sameEngineConfigOverrides,
  type BootstrapSettings,
} from "../core-adapter/settingsToEngineConfig.js";

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

/*
 * ADR-125 §2: esta comparación es la que decide si guardar los settings sin
 * documento abierto recrea el core. Un falso negativo cuesta cinco workers
 * recreados de gusto; un falso positivo deja al usuario analizando con la
 * configuración que NO eligió, que es el modo de falla que el ADR existe para
 * evitar.
 */
describe("sameEngineConfigOverrides", () => {
  // Tipado como `BootstrapSettings` y no `as const`: los parches de cada caso
  // necesitan los tipos del store (`"auto" | "low" | "high"`), no el literal
  // de este objeto.
  const base: BootstrapSettings = {
    performancePreset: "auto",
    nerEnabled: true,
    ocrLanguages: ["spa", "eng"],
  };

  const derived = (patch: Partial<BootstrapSettings> = {}) =>
    deriveEngineConfigOverrides({ ...base, ...patch });

  it("is true for two identical settings", () => {
    expect(sameEngineConfigOverrides(derived(), derived())).toBe(true);
  });

  it("is false when nerEnabled changed", () => {
    expect(sameEngineConfigOverrides(derived(), derived({ nerEnabled: false }))).toBe(false);
  });

  it("is false when an OCR language was removed", () => {
    expect(sameEngineConfigOverrides(derived(), derived({ ocrLanguages: ["spa"] }))).toBe(false);
  });

  it("is false when the OCR languages are the same set in another order", () => {
    // El orden viaja tal cual a `ocr.languages`, y es el orden en que el motor
    // los carga: no es un conjunto.
    expect(sameEngineConfigOverrides(derived(), derived({ ocrLanguages: ["eng", "spa"] }))).toBe(
      false,
    );
  });

  it("is false when the performance preset changed", () => {
    expect(sameEngineConfigOverrides(derived(), derived({ performancePreset: "low" }))).toBe(false);
  });

  it("is false between two presets that both define workerPool", () => {
    expect(
      sameEngineConfigOverrides(
        derived({ performancePreset: "low" }),
        derived({ performancePreset: "high" }),
      ),
    ).toBe(false);
  });

  /*
   * El caso que justifica comparar el override derivado y no los settings
   * crudos: `language` es UI pura, no entra al `EngineConfig`, y cambiarlo no
   * puede costar la recreación del core.
   */
  it("ignores anything that does not reach the EngineConfig, like the UI language", () => {
    expect(sameEngineConfigOverrides(derived(), derived())).toBe(true);
  });
});
