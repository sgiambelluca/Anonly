import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { resolveScanProgress } from "../components/screens/scanProgress.js";

const base = {
  stage: PipelineStage.Detecting,
  current: 0,
  total: 0,
  pageCount: 10,
  modelLoadingProgress: null,
  lastOcrPageIndex: null,
} as const;

describe("resolveScanProgress", () => {
  describe("Detecting: contador sobre pageCount, no sobre total (ADR-152 §2)", () => {
    it("muestra páginas escaneadas sobre pageCount", () => {
      expect(resolveScanProgress({ ...base, current: 3 })).toEqual({
        kind: "determinate",
        percent: 30,
        counter: { current: 3, total: 10 },
      });
    });

    it("en las etapas de preparación no hay número, solo movimiento", () => {
      for (const stage of [
        PipelineStage.Importing,
        PipelineStage.Extracting,
        PipelineStage.Grouping,
      ]) {
        expect(resolveScanProgress({ ...base, stage, current: 10 })).toEqual({
          kind: "indeterminate",
        });
      }
    });
  });

  describe("OCRing: la barra usa el tamaño real del trabajo, el contador usa pageCount (ADR-152 §2)", () => {
    it("la barra avanza con current/total del trabajo de OCR, no con pageCount", () => {
      // 8 páginas requieren OCR (textlessPages + ocrRegions) sobre un
      // documento de 10: a mitad del trabajo de OCR, la barra está al 50%,
      // no al 30% que daría current/pageCount.
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.OCRing,
          current: 4,
          total: 8,
          lastOcrPageIndex: 2,
        }),
      ).toEqual({
        kind: "determinate",
        percent: 50,
        counter: { current: 3, total: 10 },
      });
    });

    it("el contador es la página que se está leyendo (pageIndex + 1), no cuántas se leyeron", () => {
      // La página 12 (índice 11) es la que terminó de leerse recién — el
      // contador dice "12 de 20", no "1 de 8" (cuántas van del trabajo de
      // OCR), que es justo la lectura que ADR-152 §2 rechaza en un mixto.
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.OCRing,
          pageCount: 20,
          current: 1,
          total: 8,
          lastOcrPageIndex: 11,
        }),
      ).toEqual({
        kind: "determinate",
        percent: 13,
        counter: { current: 12, total: 20 },
      });
    });

    it("sin ningún OCR_PAGE_FINISHED todavía, barra determinada pero sin contador", () => {
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.OCRing,
          current: 0,
          total: 8,
          lastOcrPageIndex: null,
        }),
      ).toEqual({ kind: "determinate", percent: 0, counter: null });
    });

    it("sin trabajo de OCR (total 0), indeterminado: sin denominador para la barra", () => {
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.OCRing,
          total: 0,
          lastOcrPageIndex: 0,
        }),
      ).toEqual({ kind: "indeterminate" });
    });
  });

  describe("descarga del modelo", () => {
    it("es indeterminada: el progreso que reporta no mide nada", () => {
      expect(resolveScanProgress({ ...base, current: 1, modelLoadingProgress: 0.42 })).toEqual({
        kind: "indeterminate",
      });
      expect(resolveScanProgress({ ...base, current: 1, modelLoadingProgress: 1 })).toEqual({
        kind: "indeterminate",
      });
    });

    it("gana sobre el stage: durante la descarga no se cuentan páginas aunque el stage ya sea Detecting", () => {
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.Detecting,
          current: 5,
          modelLoadingProgress: 1,
        }),
      ).toEqual({ kind: "indeterminate" });
    });

    it("gana también sobre OCRing (higiene: la carga del modelo no corre en paralelo con OCR hoy, pero la guarda no debe depender de eso)", () => {
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.OCRing,
          current: 2,
          total: 8,
          modelLoadingProgress: 1,
        }),
      ).toEqual({ kind: "indeterminate" });
    });
  });

  describe("bordes", () => {
    it("sin pageCount todavía, indeterminado: no hay denominador (Detecting)", () => {
      expect(resolveScanProgress({ ...base, pageCount: 0, current: 2 })).toEqual({
        kind: "indeterminate",
      });
    });

    it("un current rezagado de la etapa anterior no muestra 12 de 10 (Detecting)", () => {
      expect(resolveScanProgress({ ...base, current: 12 })).toEqual({
        kind: "determinate",
        percent: 100,
        counter: { current: 10, total: 10 },
      });
    });

    it("un current corrupto no muestra un número absurdo (Detecting)", () => {
      expect(resolveScanProgress({ ...base, current: -3 })).toEqual({
        kind: "determinate",
        percent: 0,
        counter: { current: 0, total: 10 },
      });
    });

    it("un lastOcrPageIndex por encima de pageCount no muestra un contador imposible (OCRing)", () => {
      expect(
        resolveScanProgress({
          ...base,
          stage: PipelineStage.OCRing,
          current: 8,
          total: 8,
          lastOcrPageIndex: 99,
        }),
      ).toEqual({
        kind: "determinate",
        percent: 100,
        counter: { current: 10, total: 10 },
      });
    });
  });
});
