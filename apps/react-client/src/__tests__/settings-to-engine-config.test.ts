import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deriveEngineConfigOverrides,
  readDeviceSignals,
  resolveAutoLevel,
  resolvePerformanceLevel,
  sameEngineConfigOverrides,
  type BootstrapSettings,
  type DeviceSignals,
  type PerformanceLevel,
} from "../core-adapter/settingsToEngineConfig.js";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

const settings = (
  performancePreset: BootstrapSettings["performancePreset"],
): BootstrapSettings => ({
  performancePreset,
  nerEnabled: true,
  ocrLanguages: ["spa", "eng"],
});

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

  it("auto derives the override of the resolved level, no longer an override without workerPool", () => {
    const overrides = deriveEngineConfigOverrides(
      { performancePreset: "auto", nerEnabled: true, ocrLanguages: ["spa", "eng"] },
      { totalMemoryBytes: 16 * GIB, hardwareConcurrency: 12 },
    );
    expect(overrides).toEqual({
      ner: { enabled: true },
      ocr: { languages: ["spa", "eng"], maxLiveImageBytes: 200 * MIB },
      workerPool: { ocrPoolSize: 6, nerPoolSize: 2 },
    });
  });

  it("auto sends the same override as the level it resolves to, for every level", () => {
    const signalsByLevel = {
      low: { totalMemoryBytes: 4 * GIB, hardwareConcurrency: 8 },
      medium: { totalMemoryBytes: 8 * GIB, hardwareConcurrency: 8 },
      high: { totalMemoryBytes: 16 * GIB, hardwareConcurrency: 8 },
      ultra: { totalMemoryBytes: 16 * GIB, hardwareConcurrency: 12 },
    } as const;
    for (const level of ["low", "medium", "high", "ultra"] as const) {
      expect(deriveEngineConfigOverrides(settings("auto"), signalsByLevel[level])).toEqual(
        deriveEngineConfigOverrides(settings(level), {}),
      );
    }
  });

  it("low sends the four pools in 1 and no image cap", () => {
    const overrides = deriveEngineConfigOverrides(settings("low"), {});
    expect(overrides.workerPool).toEqual({
      pdfPoolSize: 1,
      ocrPoolSize: 1,
      nerPoolSize: 1,
      renderPoolSize: 1,
    });
    expect(overrides.ocr).toEqual({ languages: ["spa", "eng"] });
    expect("maxLiveImageBytes" in (overrides.ocr ?? {})).toBe(false);
  });

  it("medium sends only ocr and ner pools, and no image cap", () => {
    const overrides = deriveEngineConfigOverrides(settings("medium"), {});
    expect(overrides.workerPool).toEqual({ ocrPoolSize: 2, nerPoolSize: 2 });
    expect(Object.keys(overrides.workerPool ?? {}).sort()).toEqual(["nerPoolSize", "ocrPoolSize"]);
    expect(overrides.ocr).toEqual({ languages: ["spa", "eng"] });
  });

  it("high sends 4 recognizers, 2 NER and a 136 MiB image cap next to the languages", () => {
    const overrides = deriveEngineConfigOverrides(settings("high"), {});
    expect(overrides.workerPool).toEqual({ ocrPoolSize: 4, nerPoolSize: 2 });
    expect(overrides.ocr).toEqual({ languages: ["spa", "eng"], maxLiveImageBytes: 136 * MIB });
  });

  it("ultra sends 6 recognizers, 2 NER and a 200 MiB image cap next to the languages", () => {
    const overrides = deriveEngineConfigOverrides(settings("ultra"), {});
    expect(overrides.workerPool).toEqual({ ocrPoolSize: 6, nerPoolSize: 2 });
    expect(overrides.ocr).toEqual({ languages: ["spa", "eng"], maxLiveImageBytes: 200 * MIB });
  });

  it("a manual choice wins over the device: ultra on an 8 GiB machine is ultra", () => {
    const overrides = deriveEngineConfigOverrides(settings("ultra"), {
      totalMemoryBytes: 8 * GIB,
      hardwareConcurrency: 4,
    });
    expect(overrides.workerPool).toEqual({ ocrPoolSize: 6, nerPoolSize: 2 });
  });

  it("returns the full override shape for a representative low case", () => {
    const overrides = deriveEngineConfigOverrides(
      { performancePreset: "low", nerEnabled: false, ocrLanguages: ["spa"] },
      {},
    );
    expect(overrides).toEqual({
      ner: { enabled: false },
      ocr: { languages: ["spa"] },
      workerPool: { pdfPoolSize: 1, ocrPoolSize: 1, nerPoolSize: 1, renderPoolSize: 1 },
    });
  });
});

describe("resolveAutoLevel (ADR-194 §3)", () => {
  const cases: ReadonlyArray<readonly [string, DeviceSignals, PerformanceLevel]> = [
    ["3 threads, 32 GiB", { totalMemoryBytes: 32 * GIB, hardwareConcurrency: 3 }, "low"],
    ["6.9 GiB, 8 threads", { totalMemoryBytes: 6.9 * GIB, hardwareConcurrency: 8 }, "low"],
    ["7.0 GiB, 8 threads", { totalMemoryBytes: 7 * GIB, hardwareConcurrency: 8 }, "medium"],
    ["14.9 GiB, 12 threads", { totalMemoryBytes: 14.9 * GIB, hardwareConcurrency: 12 }, "medium"],
    ["15.0 GiB, 12 threads", { totalMemoryBytes: 15 * GIB, hardwareConcurrency: 12 }, "ultra"],
    ["15.8 GiB, 8 threads", { totalMemoryBytes: 15.8 * GIB, hardwareConcurrency: 8 }, "high"],
    ["15.8 GiB, 11 threads", { totalMemoryBytes: 15.8 * GIB, hardwareConcurrency: 11 }, "high"],
    ["32 GiB, 4 threads", { totalMemoryBytes: 32 * GIB, hardwareConcurrency: 4 }, "medium"],
    ["32 GiB, 7 threads", { totalMemoryBytes: 32 * GIB, hardwareConcurrency: 7 }, "medium"],
    ["no RAM, 12 threads", { hardwareConcurrency: 12 }, "medium"],
    ["no RAM, 3 threads", { hardwareConcurrency: 3 }, "low"],
    ["no RAM, deviceMemory 2", { hardwareConcurrency: 8, deviceMemory: 2 }, "low"],
    ["no RAM, deviceMemory 8", { hardwareConcurrency: 8, deviceMemory: 8 }, "medium"],
    ["no RAM, no threads", {}, "medium"],
    ["RAM NaN, 12 threads", { totalMemoryBytes: NaN, hardwareConcurrency: 12 }, "medium"],
    ["RAM NaN, 3 threads", { totalMemoryBytes: NaN, hardwareConcurrency: 3 }, "low"],
    ["RAM 0, deviceMemory 2", { totalMemoryBytes: 0, deviceMemory: 2 }, "low"],
    ["RAM -1 GiB, 12 threads", { totalMemoryBytes: -GIB, hardwareConcurrency: 12 }, "medium"],
    ["RAM Infinity, 12 threads", { totalMemoryBytes: Infinity, hardwareConcurrency: 12 }, "medium"],
    ["32 GiB, threads missing (4)", { totalMemoryBytes: 32 * GIB }, "medium"],
  ];

  it.each(cases)("%s", (_name, signals, expected) => {
    expect(resolveAutoLevel(signals)).toBe(expected);
  });

  it("resolvePerformanceLevel returns a manual level untouched", () => {
    expect(resolvePerformanceLevel("high", { totalMemoryBytes: GIB })).toBe("high");
    expect(resolvePerformanceLevel("auto", { totalMemoryBytes: GIB })).toBe("low");
  });
});

describe("readDeviceSignals", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the shell memory and the navigator signals", () => {
    vi.stubGlobal("window", { anonlyDevice: { totalMemoryBytes: 16 * GIB } });
    vi.stubGlobal("navigator", { hardwareConcurrency: 12, deviceMemory: 8 });
    expect(readDeviceSignals()).toEqual({
      totalMemoryBytes: 16 * GIB,
      hardwareConcurrency: 12,
      deviceMemory: 8,
    });
  });

  it.each([[NaN], [0], [-5], ["16"], [null], [Infinity]])(
    "ignores an invalid totalMemoryBytes (%s)",
    (value) => {
      vi.stubGlobal("window", { anonlyDevice: { totalMemoryBytes: value } });
      vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
      expect(readDeviceSignals()).toEqual({ hardwareConcurrency: 8 });
    },
  );

  it("does not throw without window or navigator", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);
    expect(readDeviceSignals()).toEqual({});
  });

  it("does not throw outside the shell, with a window that has no anonlyDevice", () => {
    vi.stubGlobal("window", {});
    expect(() => readDeviceSignals()).not.toThrow();
    expect(readDeviceSignals().totalMemoryBytes).toBeUndefined();
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
  // necesitan los tipos del store, no el literal de este objeto.
  const base: BootstrapSettings = {
    performancePreset: "auto",
    nerEnabled: true,
    ocrLanguages: ["spa", "eng"],
  };

  // Un equipo de 16 GiB y 12 hilos: `auto` resuelve a `ultra`.
  const signals: DeviceSignals = { totalMemoryBytes: 16 * GIB, hardwareConcurrency: 12 };

  const derived = (patch: Partial<BootstrapSettings> = {}) =>
    deriveEngineConfigOverrides({ ...base, ...patch }, signals);

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

  it("tells the four levels apart from each other", () => {
    const levels = ["low", "medium", "high", "ultra"] as const;
    for (const a of levels) {
      for (const b of levels) {
        expect(
          sameEngineConfigOverrides(
            derived({ performancePreset: a }),
            derived({ performancePreset: b }),
          ),
          `${a} vs ${b}`,
        ).toBe(a === b);
      }
    }
  });

  it("notices a different image cap even when the pools are identical", () => {
    const high = deriveEngineConfigOverrides(settings("high"), {});
    const withoutCap = { ...high, ocr: { languages: ["spa", "eng"] } };
    expect(sameEngineConfigOverrides(high, withoutCap)).toBe(false);
  });

  it("is true between auto and the level it resolves to", () => {
    expect(sameEngineConfigOverrides(derived(), derived({ performancePreset: "ultra" }))).toBe(
      true,
    );
    expect(sameEngineConfigOverrides(derived(), derived({ performancePreset: "high" }))).toBe(
      false,
    );
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
