/**
 * ADR-194 §6: el selector de rendimiento y la descripción bajo él. Los tests de
 * `apps/react-client` corren en Node sin jsdom, así que se prueba lo que el
 * diálogo renderiza: el orden y los nombres de las opciones, el texto de cada
 * una, y que `SettingsDialog` los toma de ahí.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describePerformancePreset,
  PERFORMANCE_LEVEL_LABEL,
  PERFORMANCE_PRESET_LABEL,
  PERFORMANCE_PRESET_ORDER,
} from "../components/toolbar/settingsCopy.js";
import { resolvePerformanceLevel } from "../core-adapter/settingsToEngineConfig.js";

const GIB = 1024 ** 3;

describe("selector de rendimiento (ADR-194 §6)", () => {
  it("ofrece cinco opciones, en este orden y con estos nombres", () => {
    expect(PERFORMANCE_PRESET_ORDER).toEqual(["auto", "low", "medium", "high", "ultra"]);
    expect(PERFORMANCE_PRESET_ORDER.map((preset) => PERFORMANCE_PRESET_LABEL[preset])).toEqual([
      "Automático",
      "Bajo consumo",
      "Intermedio",
      "Alto rendimiento",
      "Ultra",
    ]);
  });

  it("la descripción de cada opción manual es la del ADR", () => {
    expect(describePerformancePreset("low", {})).toBe(
      "Usa menos memoria y procesador. Puede tardar más.",
    );
    expect(describePerformancePreset("medium", {})).toBe(
      "Equilibrio entre velocidad y uso de memoria.",
    );
    expect(describePerformancePreset("high", {})).toBe(
      "Termina antes en documentos escaneados. Usa más memoria.",
    );
    expect(describePerformancePreset("ultra", {})).toBe(
      "El más rápido en escaneados. Para equipos con 16 GB o más.",
    );
  });

  it("con Automático nombra el nivel resuelto en este equipo", () => {
    const cases = [
      [{ totalMemoryBytes: 4 * GIB, hardwareConcurrency: 8 }, "Bajo consumo"],
      [{ totalMemoryBytes: 8 * GIB, hardwareConcurrency: 8 }, "Intermedio"],
      [{ totalMemoryBytes: 15.8 * GIB, hardwareConcurrency: 8 }, "Alto rendimiento"],
      [{ totalMemoryBytes: 15.8 * GIB, hardwareConcurrency: 12 }, "Ultra"],
    ] as const;
    for (const [signals, nombre] of cases) {
      expect(describePerformancePreset("auto", signals)).toBe(
        `Anonly elige según tu equipo. En este equipo usa: ${nombre}.`,
      );
    }
  });

  it("el nivel que nombra es el que aplica el override (misma función)", () => {
    const signals = { totalMemoryBytes: 16 * GIB, hardwareConcurrency: 12 };
    const level = resolvePerformanceLevel("auto", signals);
    expect(describePerformancePreset("auto", signals)).toContain(PERFORMANCE_LEVEL_LABEL[level]);
  });

  it("SettingsDialog arma las opciones desde el orden y reserva una ranura de alto fijo", async () => {
    const fuente = await readFile(
      resolve(__dirname, "../components/toolbar/SettingsDialog.tsx"),
      "utf8",
    );
    expect(fuente).toContain("PERFORMANCE_PRESET_ORDER.map");
    expect(fuente).toMatch(/<p className="h-5 truncate [^"]*">\s*\{describePerformancePreset\(/);
  });
});
