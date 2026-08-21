import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  SCAN_ADVANCE_MAX_MS,
  SCAN_ADVANCE_MIN_MS,
  SCAN_ADVANCE_PAGE_RATIO,
  shouldAdvanceFromScan,
} from "../components/screens/scanAdvance.js";

/** Base de un escaneo en curso, sin nada que dispare la salida todavía. */
const scanning = {
  stage: PipelineStage.Detecting,
  current: 0,
  pageCount: 100,
  modelLoadingInProgress: false,
  elapsedMs: SCAN_ADVANCE_MIN_MS,
} as const;

describe("shouldAdvanceFromScan", () => {
  describe("piso", () => {
    it("no suelta antes del piso, ni siquiera con el umbral de páginas cumplido", () => {
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          current: 100,
          elapsedMs: SCAN_ADVANCE_MIN_MS - 1,
        }),
      ).toBe(false);
    });

    it("suelta justo en el piso si el umbral de páginas ya está cumplido", () => {
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          current: 20,
          elapsedMs: SCAN_ADVANCE_MIN_MS,
        }),
      ).toBe(true);
    });
  });

  describe("techo", () => {
    it("suelta al llegar al techo aunque no se haya analizado ni una página", () => {
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          current: 0,
          elapsedMs: SCAN_ADVANCE_MAX_MS,
        }),
      ).toBe(true);
    });

    it("suelta en el techo incluso en una etapa previa a Detecting (descarga del modelo NER)", () => {
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          stage: PipelineStage.OCRing,
          current: 3,
          elapsedMs: SCAN_ADVANCE_MAX_MS,
        }),
      ).toBe(true);
    });
  });

  describe("umbral de páginas", () => {
    it("suelta al alcanzar exactamente la fracción, entre el piso y el techo", () => {
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          current: 100 * SCAN_ADVANCE_PAGE_RATIO,
          elapsedMs: 3000,
        }),
      ).toBe(true);
    });

    it("no suelta una página antes de la fracción", () => {
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          current: 100 * SCAN_ADVANCE_PAGE_RATIO - 1,
          elapsedMs: 3000,
        }),
      ).toBe(false);
    });

    it("solo cuenta el progreso de Detecting: el mismo avance en otra etapa no suelta", () => {
      for (const stage of [
        PipelineStage.Importing,
        PipelineStage.Extracting,
        PipelineStage.OCRing,
        PipelineStage.Grouping,
      ]) {
        expect(shouldAdvanceFromScan({ ...scanning, stage, current: 100, elapsedMs: 3000 })).toBe(
          false,
        );
      }
    });

    it("no suelta con total 0: sin denominador no hay fracción, y soltaría con cero entidades", () => {
      expect(
        shouldAdvanceFromScan({ ...scanning, current: 0, pageCount: 0, elapsedMs: 3000 }),
      ).toBe(false);
    });
  });

  describe("stages terminales", () => {
    it("suelta sin esperar el piso: retener sobre un Failed sería retener sobre un error", () => {
      for (const stage of [
        PipelineStage.Ready,
        PipelineStage.Done,
        PipelineStage.Failed,
        PipelineStage.Cancelled,
      ]) {
        expect(shouldAdvanceFromScan({ ...scanning, stage, elapsedMs: 0 })).toBe(true);
      }
    });
  });

  describe("descarga del modelo NER (regresión: soltaba apenas terminaba el OCR)", () => {
    it("no suelta mientras el modelo se está descargando, aunque el stage ya sea Detecting", () => {
      // Medido en el browser: durante la descarga, `pipeline.store` reporta
      // current/total = 1/1 con el stage ya en Detecting. Con `total` como
      // denominador eso daba razón 1.0 y soltaba al instante.
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          current: 1,
          modelLoadingInProgress: true,
          elapsedMs: 1786,
        }),
      ).toBe(false);
    });

    it("el techo sigue aplicando durante la descarga: es el caso que el techo acota", () => {
      expect(
        shouldAdvanceFromScan({
          ...scanning,
          current: 1,
          modelLoadingInProgress: true,
          elapsedMs: SCAN_ADVANCE_MAX_MS,
        }),
      ).toBe(true);
    });

    it("el denominador es pageCount, no un contador por etapa: 1 de 10 páginas es 10 %, no 100 %", () => {
      expect(
        shouldAdvanceFromScan({ ...scanning, current: 1, pageCount: 10, elapsedMs: 1786 }),
      ).toBe(false);
      expect(
        shouldAdvanceFromScan({ ...scanning, current: 2, pageCount: 10, elapsedMs: 1786 }),
      ).toBe(true);
    });
  });

  describe("documento chico contra documento grande", () => {
    it("un PDF de texto de 6 páginas espera el piso y no parpadea", () => {
      // Las 6 páginas analizadas a los 400 ms: el umbral de páginas está
      // cumplido de sobra, pero el piso manda.
      expect(shouldAdvanceFromScan({ ...scanning, current: 6, pageCount: 6, elapsedMs: 400 })).toBe(
        false,
      );
      expect(
        shouldAdvanceFromScan({ ...scanning, current: 6, pageCount: 6, elapsedMs: 1300 }),
      ).toBe(true);
    });

    it("un escaneado de 200 páginas sale por el techo, no por el umbral", () => {
      // A los 6 s solo se analizaron 8 de 200 (4 %), muy lejos del 20 %.
      expect(
        shouldAdvanceFromScan({ ...scanning, current: 8, pageCount: 200, elapsedMs: 5999 }),
      ).toBe(false);
      expect(
        shouldAdvanceFromScan({ ...scanning, current: 8, pageCount: 200, elapsedMs: 6000 }),
      ).toBe(true);
    });
  });
});
