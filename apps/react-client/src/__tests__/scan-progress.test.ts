import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { resolveScanProgress } from "../components/screens/scanProgress.js";

const base = {
  stage: PipelineStage.Detecting,
  current: 0,
  pageCount: 10,
  modelLoadingProgress: null,
} as const;

describe("resolveScanProgress", () => {
  describe("el contador solo cuenta el escaneo del documento", () => {
    it("en Detecting muestra páginas escaneadas sobre el total", () => {
      expect(resolveScanProgress({ ...base, current: 3 })).toEqual({
        kind: "determinate",
        percent: 30,
        counter: { current: 3, total: 10 },
      });
    });

    it("en las etapas de preparación no hay número, solo movimiento", () => {
      // Regresión: el contador corría también acá, así que llegaba a "10 de
      // 10" ANTES de haber detectado nada y después volvía a "1 de 10" al
      // arrancar la detección. Dos recorridos del mismo número para dos cosas
      // distintas, y el primero decía "terminé" sobre un trabajo que el
      // usuario ni considera el trabajo.
      for (const stage of [
        PipelineStage.Importing,
        PipelineStage.Extracting,
        PipelineStage.OCRing,
        PipelineStage.Grouping,
      ]) {
        expect(resolveScanProgress({ ...base, stage, current: 10 })).toEqual({
          kind: "indeterminate",
        });
      }
    });
  });

  describe("descarga del modelo", () => {
    it("muestra su propio porcentaje y NINGÚN contador de páginas", () => {
      // La descarga tiene progreso real y propio, pero no hay páginas que
      // contar todavía.
      expect(resolveScanProgress({ ...base, current: 1, modelLoadingProgress: 0.42 })).toEqual({
        kind: "determinate",
        percent: 42,
        counter: null,
      });
    });

    it("gana sobre el stage: durante la descarga no se cuentan páginas aunque el stage ya sea Detecting", () => {
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.Detecting,
          current: 5,
          modelLoadingProgress: 1,
        }).kind,
      ).toBe("determinate");
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.Detecting,
          current: 5,
          modelLoadingProgress: 1,
        }),
      ).toEqual({ kind: "determinate", percent: 100, counter: null });
    });
  });

  describe("bordes", () => {
    it("sin pageCount todavía, indeterminado: no hay denominador", () => {
      expect(resolveScanProgress({ ...base, pageCount: 0, current: 2 })).toEqual({
        kind: "indeterminate",
      });
    });

    it("un current rezagado de la etapa anterior no muestra 12 de 10", () => {
      expect(resolveScanProgress({ ...base, current: 12 })).toEqual({
        kind: "determinate",
        percent: 100,
        counter: { current: 10, total: 10 },
      });
    });

    it("un current corrupto no muestra un número absurdo", () => {
      expect(resolveScanProgress({ ...base, current: -3 })).toEqual({
        kind: "determinate",
        percent: 0,
        counter: { current: 0, total: 10 },
      });
    });
  });
});
