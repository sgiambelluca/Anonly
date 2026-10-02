/**
 * Reserva RGBA por página contra `ocr.maxLiveImageBytes`, calculada desde el arnés.
 *
 * Es una cota superior estimada con el DPI configurado, no la reserva real: el Core reserva con el
 * DPI efectivo por página (`effectiveOcrDpi` en orchestrator.ts, que solo puede bajarlo: toma el
 * mínimo con `ocrDpiCap`) y, cuando hay `ocrRegions`, con el `bbox` de la región. Ninguno de los dos
 * es observable desde afuera. El cálculo por eje es el mismo `Math.ceil` de `estimateRasterBytes`.
 */

export const RESERVATION_ESTIMATE_BASIS =
  "upper-bound-estimated-at-configured-dpi: el Core reserva con el DPI efectivo por pagina " +
  "(tope ADR-163, solo puede bajarlo) y por region cuando hay ocrRegions; ninguno es observable " +
  "desde el arnes. No es la reserva real medida.";

export interface PageSizeObservation {
  readonly pageIndex: number;
  readonly widthPoints: number | null;
  readonly heightPoints: number | null;
  readonly error: string | null;
}

export interface PageReservationEstimate extends PageSizeObservation {
  readonly estimatedBytes: number | null;
}

export function estimateRasterBytes(
  widthPoints: number,
  heightPoints: number,
  dpi: number,
): number {
  const scale = dpi / 72;
  const widthPx = Math.max(0, Math.ceil(widthPoints * scale));
  const heightPx = Math.max(0, Math.ceil(heightPoints * scale));
  return widthPx * heightPx * 4;
}

/**
 * Cota por ocupación: si `busyPeak` reconocedores estuvieron ocupados a la vez con ese presupuesto,
 * cada reserva real fue como mucho `floor(presupuesto / busyPeak)`. Sale de lo observado, no del DPI.
 */
export function impliedMaxReservationBytesPerPage(
  budgetBytes: number,
  busyPeak: number | null,
): number | null {
  return busyPeak !== null && busyPeak > 0 ? Math.floor(budgetBytes / busyPeak) : null;
}

/**
 * La estimación con el DPI configurado queda contradicha por la ocupación cuando las `busyPeak`
 * páginas más chicas ya suman más que el presupuesto: no pudieron estar vivas a la vez con esa
 * reserva, así que el Core reservó menos (la estimación es una sobreestimación demostrable).
 * null si no hay estimaciones completas o la ocupación no se observó.
 */
export function estimateContradictedByOccupancy(
  estimatesBytes: ReadonlyArray<number>,
  busyPeak: number | null,
  budgetBytes: number,
): boolean | null {
  if (busyPeak === null || busyPeak <= 0 || estimatesBytes.length < busyPeak) return null;
  const smallest = [...estimatesBytes].sort((a, b) => a - b).slice(0, busyPeak);
  return smallest.reduce((total, bytes) => total + bytes, 0) > budgetBytes;
}

/** Cuántas imágenes de `bytesPerPage` caben a la vez en `budgetBytes`. */
export function pagesAdmittedByBudget(budgetBytes: number, bytesPerPage: number): number | null {
  return bytesPerPage > 0 ? Math.floor(budgetBytes / bytesPerPage) : null;
}

export interface ReservationReport {
  readonly pageRgbaEstimates: ReadonlyArray<PageReservationEstimate>;
  readonly maxSinglePageRgbaEstimateBytes: number | null;
  readonly estimatedReservationWindowPeakBytes: number | null;
  /** Con el DPI configurado y como cota superior: no es una medición de espera ni de exceso real. */
  readonly estimatedWindowExceedsBudgetAtConfiguredDpiUpperBound: boolean | null;
  readonly impliedMaxReservationBytesPerPage: number | null;
  readonly estimateContradictedByOccupancy: boolean | null;
  readonly reservationBudgetBytes: number;
  readonly reservationEstimateBasis: string;
  readonly reservationEstimateErrors: ReadonlyArray<{
    readonly pageIndex: number | null;
    readonly error: string;
  }>;
}

export function buildReservationReport(input: {
  readonly pageSizes: ReadonlyArray<PageSizeObservation>;
  readonly configuredDpi: number | null;
  readonly requestWindow: number;
  readonly budgetBytes: number;
  readonly busyRecognizersPeak: number | null;
}): ReservationReport {
  const sorted = [...input.pageSizes].sort((a, b) => a.pageIndex - b.pageIndex);
  const errors: { pageIndex: number | null; error: string }[] = [];
  if (input.configuredDpi === null) {
    errors.push({ pageIndex: null, error: "ocr.dpi efectivo no observable" });
  }
  const estimates: PageReservationEstimate[] = sorted.map((page) => {
    const known =
      page.error === null &&
      page.widthPoints !== null &&
      page.heightPoints !== null &&
      input.configuredDpi !== null;
    if (page.error !== null) errors.push({ pageIndex: page.pageIndex, error: page.error });
    return {
      ...page,
      estimatedBytes: known
        ? estimateRasterBytes(page.widthPoints, page.heightPoints, input.configuredDpi)
        : null,
    };
  });
  const bytes = estimates.map((item) => item.estimatedBytes);
  const allKnown = estimates.length > 0 && bytes.every((value) => value !== null);
  let windowPeak: number | null = null;
  if (allKnown) {
    windowPeak = 0;
    for (let start = 0; start < estimates.length; start += 1) {
      const sum = estimates
        .slice(start, start + input.requestWindow)
        .reduce((total, item) => total + (item.estimatedBytes ?? 0), 0);
      windowPeak = Math.max(windowPeak, sum);
    }
  }
  const known = bytes.filter((value): value is number => value !== null);
  return {
    pageRgbaEstimates: estimates,
    maxSinglePageRgbaEstimateBytes: known.length > 0 ? Math.max(...known) : null,
    estimatedReservationWindowPeakBytes: windowPeak,
    estimatedWindowExceedsBudgetAtConfiguredDpiUpperBound:
      windowPeak === null ? null : windowPeak > input.budgetBytes,
    impliedMaxReservationBytesPerPage: impliedMaxReservationBytesPerPage(
      input.budgetBytes,
      input.busyRecognizersPeak,
    ),
    estimateContradictedByOccupancy: allKnown
      ? estimateContradictedByOccupancy(known, input.busyRecognizersPeak, input.budgetBytes)
      : null,
    reservationBudgetBytes: input.budgetBytes,
    reservationEstimateBasis: RESERVATION_ESTIMATE_BASIS,
    reservationEstimateErrors: errors,
  };
}
