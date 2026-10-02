/**
 * Evidencia por celda de la campaña de DPI descendente: DPI efectivo de cada despacho `ocr-page`,
 * cadena de ADR-190 (veredicto del OSD, pasos de recuperación, upscale, tinta ilegible) y validez.
 * Todo puro, sobre lo que observa el Worker envuelto (`adr190Browser.ts`). Solo metadatos de
 * transporte: ni texto ni palabras.
 */

import { decodeVerdict, type Job } from "./adr190Dpi.js";

export interface PageCap {
  readonly pageIndex: number;
  readonly originalCap: number | null;
}

export interface DispatchRecord {
  readonly pageIndex: number;
  readonly jobId: string;
  readonly dpi: number | null;
  readonly upscale: number;
  readonly orientation: number | null;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly terminal: string | null;
  readonly transportRetry: boolean;
}

export interface DispatchEvidence {
  readonly requestedDpi: number;
  readonly caps: ReadonlyArray<PageCap>;
  readonly dispatches: ReadonlyArray<DispatchRecord>;
  /** `min(pedido, tope de la página)`, o `null` si el tope no se observó. */
  readonly expectedDpiByPage: Readonly<Record<string, number | null>>;
  readonly effectiveDpis: ReadonlyArray<number>;
  /** Todos los despachos salieron al DPI que el Core debía usar para su página. */
  readonly dispatchesAtExpectedDpi: boolean;
  /** Todos los despachos salieron exactamente al DPI pedido (el brazo es efectivo en este corpus). */
  readonly armEffective: boolean;
  readonly issues: ReadonlyArray<string>;
}

export function summarizeDispatches(
  jobs: ReadonlyArray<Job>,
  caps: ReadonlyArray<PageCap>,
  requestedDpi: number,
): DispatchEvidence {
  const seen = new Set<string>();
  const dispatches: DispatchRecord[] = [];
  for (const job of jobs) {
    if (job.jobType !== "ocr-page") continue;
    dispatches.push({
      pageIndex: job.pageIndex,
      jobId: job.jobId,
      dpi: job.dpi,
      upscale: job.upscale,
      orientation: job.orientation,
      widthPx: job.widthPx,
      heightPx: job.heightPx,
      terminal: job.terminal,
      transportRetry: seen.has(job.jobId),
    });
    seen.add(job.jobId);
  }
  const issues: string[] = [];
  const expectedDpiByPage: Record<string, number | null> = {};
  for (const page of dispatches) {
    const cap = caps.find((candidate) => candidate.pageIndex === page.pageIndex)?.originalCap;
    expectedDpiByPage[String(page.pageIndex)] =
      cap === undefined || cap === null ? null : Math.min(requestedDpi, cap);
  }
  if (dispatches.length === 0) issues.push("no-ocr-page-dispatch");
  if (dispatches.some((dispatch) => dispatch.dpi === null)) issues.push("dispatch-dpi-missing");
  if (Object.values(expectedDpiByPage).some((expected) => expected === null))
    issues.push("page-cap-not-observable");
  const dispatchesAtExpectedDpi =
    dispatches.length > 0 &&
    dispatches.every((dispatch) => {
      const expected = expectedDpiByPage[String(dispatch.pageIndex)];
      return expected !== null && expected !== undefined && dispatch.dpi === expected;
    });
  if (
    dispatches.length > 0 &&
    !issues.includes("dispatch-dpi-missing") &&
    !issues.includes("page-cap-not-observable") &&
    !dispatchesAtExpectedDpi
  )
    issues.push("effective-dpi-differs-from-expected");
  return {
    requestedDpi,
    caps,
    dispatches,
    expectedDpiByPage,
    effectiveDpis: [
      ...new Set(dispatches.flatMap((dispatch) => (dispatch.dpi === null ? [] : [dispatch.dpi]))),
    ].sort((a, b) => a - b),
    dispatchesAtExpectedDpi,
    armEffective:
      dispatches.length > 0 && dispatches.every((dispatch) => dispatch.dpi === requestedDpi),
    issues,
  };
}

export interface OsdReading {
  readonly pageIndex: number;
  readonly orientation: 0 | 90 | 180 | 270;
  readonly inkRatio: number;
}

export interface ChainEvidence {
  readonly osd: ReadonlyArray<OsdReading>;
  /** Despachos `ocr-page` con otro `jobId` que el primero de su página (reintentos del Core, no del transporte). */
  readonly recoverySteps: number;
  readonly upscaledDispatches: number;
  readonly maxUpscale: number;
  readonly unreadableInkPages: number;
  readonly ocrPageFailedDispatches: number;
  readonly issues: ReadonlyArray<string>;
}

/** Evento `OCR_PAGE_FINISHED`; solo los campos que lee la campaña. */
export interface OcrPageFinishedObservation {
  readonly pageIndex?: unknown;
  readonly unreadableInk?: unknown;
}

export function summarizeChain(
  jobs: ReadonlyArray<Job>,
  ocrPageEvents: ReadonlyArray<unknown>,
): ChainEvidence {
  const issues: string[] = [];
  const osd: OsdReading[] = [];
  for (const job of jobs) {
    if (job.jobType !== "ocr-orient" || job.terminal !== "COMPLETED") continue;
    try {
      const verdict = decodeVerdict(job.result);
      osd.push({
        pageIndex: job.pageIndex,
        orientation: verdict.orientation,
        inkRatio: verdict.inkRatio,
      });
    } catch (error: unknown) {
      issues.push(`osd-result-invalid: ${String(error)}`);
    }
  }
  const stepsByPage = new Map<number, Set<string>>();
  let upscaledDispatches = 0;
  let maxUpscale = 1;
  let failedDispatches = 0;
  for (const job of jobs) {
    if (job.jobType !== "ocr-page") continue;
    const ids = stepsByPage.get(job.pageIndex) ?? new Set<string>();
    ids.add(job.jobId);
    stepsByPage.set(job.pageIndex, ids);
    if (job.upscale > 1) upscaledDispatches += 1;
    maxUpscale = Math.max(maxUpscale, job.upscale);
    if (job.terminal === "FAILED") failedDispatches += 1;
  }
  const unreadablePages = new Set<number>();
  for (const event of ocrPageEvents) {
    if (typeof event !== "object" || event === null) continue;
    const observed: OcrPageFinishedObservation = event;
    if (observed.unreadableInk === true && typeof observed.pageIndex === "number")
      unreadablePages.add(observed.pageIndex);
  }
  return {
    osd,
    recoverySteps: [...stepsByPage.values()].reduce((sum, ids) => sum + (ids.size - 1), 0),
    upscaledDispatches,
    maxUpscale,
    unreadableInkPages: unreadablePages.size,
    ocrPageFailedDispatches: failedDispatches,
    issues,
  };
}

/** El tope sale de píxeles sobre puntos y redondea; un fixture de 300 dpi queda a menos de un dpi de 300. */
export const NATIVE_CAP_TOLERANCE_DPI = 1;

export interface CellValidityInput {
  readonly ready: boolean;
  readonly pipelineFailure: unknown;
  readonly captureIssues: ReadonlyArray<string>;
  readonly dispatch: DispatchEvidence;
  readonly chain: ChainEvidence;
  /** `true` si el brazo debía correr NER y no se observó su fin. */
  readonly nerExpectedButNotFinished: boolean;
  readonly overrideEffective: boolean;
  /** Corpus sintético: la fuente es de 300 dpi nativos y el tope de cada página tiene que serlo. */
  readonly expectNativeCap: number | null;
}

/** Motivos por los que la celda no sirve. Vacío = válida. Nunca se convierte en cero. */
export function cellInvalidReasons(input: CellValidityInput): ReadonlyArray<string> {
  const reasons: string[] = [];
  if (!input.overrideEffective) reasons.push("override-not-effective");
  if (!input.ready) reasons.push("not-ready");
  if (input.pipelineFailure !== null && input.pipelineFailure !== undefined)
    reasons.push("pipeline-failed");
  for (const issue of input.captureIssues) reasons.push(`capture-issue: ${issue}`);
  for (const issue of input.dispatch.issues) reasons.push(issue);
  for (const issue of input.chain.issues) reasons.push(issue);
  if (input.chain.osd.length === 0) reasons.push("no-osd-reading");
  if (input.nerExpectedButNotFinished) reasons.push("ner-not-finished");
  if (
    input.expectNativeCap !== null &&
    input.dispatch.caps.some(
      (cap) =>
        cap.originalCap === null ||
        Math.abs(cap.originalCap - (input.expectNativeCap ?? 0)) > NATIVE_CAP_TOLERANCE_DPI,
    )
  )
    reasons.push(`synthetic-source-not-${input.expectNativeCap}-dpi`);
  return reasons;
}
