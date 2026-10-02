import { PipelineStage } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  SCAN_ADVANCE_MIN_MS,
  SCAN_ADVANCE_PREWARM_GRACE_MS,
  shouldAdvanceFromScan,
} from "../components/screens/scanAdvance.js";

/** Base: recién llegó a Ready, nada más cumplido todavía. */
const justReady = {
  stage: PipelineStage.Ready,
  elapsedMs: SCAN_ADVANCE_MIN_MS,
  firstPagePreviewReady: false,
  elapsedSinceReadyMs: 0,
} as const;

describe("shouldAdvanceFromScan", () => {
  describe("piso (ADR-150 §2)", () => {
    it("no suelta antes del piso, ni con la página 1 ya dibujada", () => {
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          elapsedMs: SCAN_ADVANCE_MIN_MS - 1,
          firstPagePreviewReady: true,
        }),
      ).toBe(false);
    });

    it("suelta justo en el piso si la página 1 ya está dibujada", () => {
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          elapsedMs: SCAN_ADVANCE_MIN_MS,
          firstPagePreviewReady: true,
        }),
      ).toBe(true);
    });

    it("un PDF nativo chico (Ready en menos de un segundo) espera el piso y no parpadea", () => {
      // Antes de ADR-150 un Ready temprano salteaba el piso por completo
      // (stage terminal soltaba sin más) — ahora sí ata, que es el punto
      // central de la decisión.
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          elapsedMs: 400,
          firstPagePreviewReady: true,
        }),
      ).toBe(false);
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          elapsedMs: SCAN_ADVANCE_MIN_MS + 100,
          firstPagePreviewReady: true,
        }),
      ).toBe(true);
    });
  });

  describe("precalentado de la página 1 y su gracia (ADR-151)", () => {
    it("con el piso cumplido, espera a que la página 1 esté dibujada", () => {
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          firstPagePreviewReady: false,
          elapsedSinceReadyMs: 0,
        }),
      ).toBe(false);
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          firstPagePreviewReady: true,
          elapsedSinceReadyMs: 0,
        }),
      ).toBe(true);
    });

    it("vencida la gracia, suelta igual aunque la página 1 no esté dibujada (no es un error)", () => {
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          firstPagePreviewReady: false,
          elapsedSinceReadyMs: SCAN_ADVANCE_PREWARM_GRACE_MS - 1,
        }),
      ).toBe(false);
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          firstPagePreviewReady: false,
          elapsedSinceReadyMs: SCAN_ADVANCE_PREWARM_GRACE_MS,
        }),
      ).toBe(true);
    });

    it("aplica igual en Done, el equivalente operativo de Ready (ADR-040)", () => {
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          stage: PipelineStage.Done,
          firstPagePreviewReady: false,
          elapsedSinceReadyMs: 0,
        }),
      ).toBe(false);
      expect(
        shouldAdvanceFromScan({
          ...justReady,
          stage: PipelineStage.Done,
          firstPagePreviewReady: true,
          elapsedSinceReadyMs: 0,
        }),
      ).toBe(true);
    });
  });

  describe("stages no terminales", () => {
    it("nunca suelta durante Importing/Extracting/OCRing/Detecting/Grouping, sin importar el tiempo", () => {
      for (const stage of [
        PipelineStage.Importing,
        PipelineStage.Extracting,
        PipelineStage.OCRing,
        PipelineStage.Detecting,
        PipelineStage.Grouping,
      ]) {
        expect(
          shouldAdvanceFromScan({
            stage,
            elapsedMs: 60_000,
            firstPagePreviewReady: true,
            elapsedSinceReadyMs: null,
          }),
        ).toBe(false);
      }
    });
  });

  describe("stages de error (ADR-150 §1)", () => {
    it("Failed/Cancelled sueltan de inmediato: sin piso y sin esperar ningún preview", () => {
      for (const stage of [PipelineStage.Failed, PipelineStage.Cancelled]) {
        expect(
          shouldAdvanceFromScan({
            stage,
            elapsedMs: 0,
            firstPagePreviewReady: false,
            elapsedSinceReadyMs: null,
          }),
        ).toBe(true);
      }
    });
  });
});
