import { describe, expect, it } from "vitest";

import {
  buildReservationReport,
  estimateContradictedByOccupancy,
  impliedMaxReservationBytesPerPage,
  estimateRasterBytes,
  pagesAdmittedByBudget,
  RESERVATION_ESTIMATE_BASIS,
} from "./ocrReservation.js";

const MIB = 1024 * 1024;

describe("estimateRasterBytes", () => {
  it("una A4 a 300 dpi reserva unos 33,2 MiB (ceil por eje)", () => {
    const bytes = estimateRasterBytes(595.28, 841.89, 300);
    expect(bytes).toBe(2481 * 3508 * 4);
    expect(bytes / MIB).toBeCloseTo(33.2, 1);
  });

  it("un DPI menor (tope ADR-163) nunca da más bytes que el configurado", () => {
    expect(estimateRasterBytes(595.28, 841.89, 200)).toBeLessThan(
      estimateRasterBytes(595.28, 841.89, 300),
    );
  });
});

describe("pagesAdmittedByBudget", () => {
  it("128 MiB admite 3 A4 a 300 dpi y 200 MiB admite 6", () => {
    const a4 = estimateRasterBytes(595.28, 841.89, 300);
    expect(pagesAdmittedByBudget(128 * MIB, a4)).toBe(3);
    expect(pagesAdmittedByBudget(200 * MIB, a4)).toBe(6);
  });

  it("no divide por cero", () => {
    expect(pagesAdmittedByBudget(128 * MIB, 0)).toBeNull();
  });
});

describe("buildReservationReport", () => {
  const pages = [2, 0, 1].map((pageIndex) => ({
    pageIndex,
    widthPoints: 612,
    heightPoints: 792,
    error: null,
  }));

  it("calcula por página, la ventana y declara la base como cota superior estimada", () => {
    const report = buildReservationReport({
      pageSizes: pages,
      configuredDpi: 300,
      requestWindow: 2,
      budgetBytes: 128 * MIB,
      busyRecognizersPeak: 2,
    });
    const one = estimateRasterBytes(612, 792, 300);
    expect(report.pageRgbaEstimates.map((item) => item.pageIndex)).toEqual([0, 1, 2]);
    expect(report.pageRgbaEstimates.every((item) => item.estimatedBytes === one)).toBe(true);
    expect(report.maxSinglePageRgbaEstimateBytes).toBe(one);
    expect(report.estimatedReservationWindowPeakBytes).toBe(2 * one);
    expect(report.estimatedWindowExceedsBudgetAtConfiguredDpiUpperBound).toBe(false);
    expect(report.reservationEstimateBasis).toBe(RESERVATION_ESTIMATE_BASIS);
    expect(report.reservationEstimateBasis).toContain("upper-bound");
    expect(report.reservationEstimateErrors).toEqual([]);
  });

  it("marca el exceso de la ventana contra el presupuesto", () => {
    const report = buildReservationReport({
      pageSizes: pages,
      configuredDpi: 300,
      requestWindow: 3,
      budgetBytes: 20 * MIB,
      busyRecognizersPeak: 2,
    });
    expect(report.estimatedWindowExceedsBudgetAtConfiguredDpiUpperBound).toBe(true);
  });

  it("si getPageSize falló, guarda el motivo y no convierte la ventana en cero", () => {
    const report = buildReservationReport({
      pageSizes: [
        ...pages,
        { pageIndex: 3, widthPoints: null, heightPoints: null, error: "Documento x no disponible" },
      ],
      configuredDpi: 300,
      requestWindow: 2,
      budgetBytes: 128 * MIB,
      busyRecognizersPeak: 2,
    });
    expect(report.pageRgbaEstimates[3]?.estimatedBytes).toBeNull();
    expect(report.estimatedReservationWindowPeakBytes).toBeNull();
    expect(report.estimatedWindowExceedsBudgetAtConfiguredDpiUpperBound).toBeNull();
    expect(report.reservationEstimateErrors).toEqual([
      { pageIndex: 3, error: "Documento x no disponible" },
    ]);
  });

  it("sin DPI configurado observable no inventa el valor por defecto", () => {
    const report = buildReservationReport({
      pageSizes: pages,
      configuredDpi: null,
      requestWindow: 2,
      budgetBytes: 128 * MIB,
      busyRecognizersPeak: 2,
    });
    expect(report.maxSinglePageRgbaEstimateBytes).toBeNull();
    expect(report.reservationEstimateErrors[0]?.error).toContain("ocr.dpi");
  });

  it("sin páginas observadas la ventana queda desconocida, no cero", () => {
    const report = buildReservationReport({
      pageSizes: [],
      configuredDpi: 300,
      requestWindow: 2,
      budgetBytes: 128 * MIB,
      busyRecognizersPeak: 2,
    });
    expect(report.estimatedReservationWindowPeakBytes).toBeNull();
  });
});

describe("cota por ocupación", () => {
  it("impliedMax: 7 ocupados con 128 MiB limitan cada reserva a 18,3 MiB como mucho", () => {
    expect(impliedMaxReservationBytesPerPage(128 * MIB, 7)).toBe(Math.floor((128 * MIB) / 7));
    expect(impliedMaxReservationBytesPerPage(128 * MIB, 6)).toBe(Math.floor((128 * MIB) / 6));
  });

  it("impliedMax es null sin ocupación observada, no infinito ni cero", () => {
    expect(impliedMaxReservationBytesPerPage(128 * MIB, 0)).toBeNull();
    expect(impliedMaxReservationBytesPerPage(128 * MIB, null)).toBeNull();
  });

  const a4At300 = estimateRasterBytes(595.28, 841.89, 300);
  const pagesAt300 = Array.from({ length: 6 }, () => a4At300);

  it("5 ocupados con 128 MiB contradicen la estimación a 300 dpi (5 x 33,2 MiB > 128 MiB)", () => {
    expect(estimateContradictedByOccupancy(pagesAt300, 5, 128 * MIB)).toBe(true);
  });

  it("3 ocupados con 128 MiB no la contradicen (3 x 33,2 MiB <= 128 MiB), y 6 con 200 MiB tampoco", () => {
    expect(estimateContradictedByOccupancy(pagesAt300, 3, 128 * MIB)).toBe(false);
    expect(estimateContradictedByOccupancy(pagesAt300, 6, 200 * MIB)).toBe(false);
  });

  it("con páginas de distinto tamaño solo cuentan las más chicas: la contradicción tiene que ser demostrable", () => {
    const mixed = [10 * MIB, 10 * MIB, 100 * MIB];
    expect(estimateContradictedByOccupancy(mixed, 2, 30 * MIB)).toBe(false);
    expect(estimateContradictedByOccupancy(mixed, 3, 30 * MIB)).toBe(true);
  });

  it("no afirma nada si hay menos páginas que ocupados o no hay ocupación", () => {
    expect(estimateContradictedByOccupancy([a4At300], 2, 1)).toBeNull();
    expect(estimateContradictedByOccupancy(pagesAt300, null, 1)).toBeNull();
  });

  it("el reporte por corrida trae la cota implícita y el indicador de contradicción", () => {
    const report = buildReservationReport({
      pageSizes: Array.from({ length: 8 }, (_, pageIndex) => ({
        pageIndex,
        widthPoints: 595.28,
        heightPoints: 841.89,
        error: null,
      })),
      configuredDpi: 300,
      requestWindow: 6,
      budgetBytes: 128 * MIB,
      busyRecognizersPeak: 5,
    });
    expect(report.impliedMaxReservationBytesPerPage).toBe(Math.floor((128 * MIB) / 5));
    expect(report.estimateContradictedByOccupancy).toBe(true);
  });
});
