import {
  CancelledError,
  type OcrOrientation,
  type OcrOrientationPayload,
  type OcrOrientationResult,
} from "@anonly/shared";
import { createWorker, OEM } from "tesseract.js";

import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "../ocr.errors.js";

import { isPixelPresent } from "./ink-predicate.js";
import {
  resolveTesseractPath,
  TESSERACT_CORE_PATH,
  TESSERACT_LANG_PATH,
  TESSERACT_WORKER_PATH,
} from "./tesseract-paths.js";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

const OSD_LANGUAGE = "osd";
// ADR-190 §1: reemplaza el escalado relativo `OSD_SCALE = 0.5` — el OSD
// dejaba de depender del ráster de entrada y pasaba a medir siempre sobre el
// mismo tamaño de lado largo (A4 a 150 dpi). Factor = min(OSD_MAX_UPSCALE,
// OSD_TARGET_LONG_SIDE_PX / ladoLargoPx): una imagen chica se agranda hasta
// el doble, una grande se reduce como antes. Para una página A4 a 300 dpi
// (lado largo ≈ 3508 px) el factor da 1754/3508 = 0,5 — idéntico al
// `OSD_SCALE` anterior, byte a byte (caso 43, OCR_Engine.md §13).
const OSD_TARGET_LONG_SIDE_PX = 1754;
const OSD_MAX_UPSCALE = 2;
const MIN_ORIENTATION_CONFIDENCE = 1;

function releaseCanvasBackingStore(canvas: OffscreenCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** ADR-190 §3: la página tiene tinta si `inkRatio >= INK_PRESENT_RATIO`. */
export const INK_PRESENT_RATIO = 0.002;

function osdScaleFactor(widthPx: number, heightPx: number): number {
  const longSidePx = Math.max(widthPx, heightPx);
  if (!Number.isFinite(longSidePx) || longSidePx <= 0) return OSD_MAX_UPSCALE;
  return Math.min(OSD_MAX_UPSCALE, OSD_TARGET_LONG_SIDE_PX / longSidePx);
}

/**
 * ADR-190 §3: fracción de píxeles "presentes" (predicado literal de
 * ADR-162/ADR-165, `isPixelPresent`) sobre la imagen YA reducida del OSD —
 * la misma que ve `detect()`, no la página completa. Falla abierto hacia
 * "tiene tinta" (`1`): reportar de menos es el modo de falla peligroso (una
 * página con datos sensibles que no dispara ni la cadena de reintentos del
 * §2 ni el aviso del §4), y `getImageData` sobre un canvas propio no debería
 * fallar en la práctica.
 */
function computeInkRatio(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  try {
    const { data } = context.getImageData(0, 0, width, height);
    const totalPixels = width * height;
    if (totalPixels <= 0) return 0;
    let present = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (isPixelPresent(data[index], data[index + 1], data[index + 2], data[index + 3])) {
        present += 1;
      }
    }
    return present / totalPixels;
  } catch {
    return 1;
  }
}

function isOrientation(value: unknown): value is OcrOrientation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function readOrientation(data: unknown): { orientation: OcrOrientation; osdHadVerdict: boolean } {
  if (typeof data !== "object" || data === null) return { orientation: 0, osdHadVerdict: false };
  const record = data as {
    readonly orientation_degrees?: unknown;
    readonly orientation_confidence?: unknown;
  };
  const osdHadVerdict =
    typeof record.orientation_confidence === "number" &&
    Number.isFinite(record.orientation_confidence) &&
    record.orientation_confidence >= MIN_ORIENTATION_CONFIDENCE &&
    isOrientation(record.orientation_degrees);
  return {
    orientation:
      osdHadVerdict && isOrientation(record.orientation_degrees) ? record.orientation_degrees : 0,
    osdHadVerdict,
  };
}

export interface OrientationKernel {
  readonly detect: (
    payload: OcrOrientationPayload,
    signal: AbortSignal,
  ) => Promise<OcrOrientationResult>;
  readonly dispose: () => Promise<void>;
}

function terminateSafely(worker: TesseractWorker): Promise<void> {
  try {
    return Promise.resolve(worker.terminate()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

function throwInterruption(value: unknown, documentId: string): void {
  if (value instanceof Error) throw value;
  throw new CancelledError(documentId);
}

export function createOrientationKernel(): OrientationKernel {
  let worker: TesseractWorker | null = null;
  let initialization: Promise<TesseractWorker> | null = null;
  let generation = 0;
  let disposed = false;

  const invalidate = async (): Promise<void> => {
    generation += 1;
    const current = worker;
    worker = null;
    // Una carga de una generación cancelada no puede bloquear la siguiente
    // solicitud ni dispose. Su propia continuación comprueba la generación
    // y termina el worker si aparece tarde.
    initialization = null;
    if (current !== null) {
      await terminateSafely(current);
    }
  };

  const ensureWorker = async (languages: ReadonlyArray<string>): Promise<TesseractWorker> => {
    if (disposed) throw new CancelledError("ocr-orient");
    if (worker !== null) return worker;
    if (initialization !== null) return initialization;
    const requestedGeneration = generation;
    const pending = (async (): Promise<TesseractWorker> => {
      let next: TesseractWorker;
      try {
        next = await createWorker([OSD_LANGUAGE], OEM.TESSERACT_ONLY, {
          langPath: resolveTesseractPath(TESSERACT_LANG_PATH),
          corePath: resolveTesseractPath(TESSERACT_CORE_PATH),
          workerPath: resolveTesseractPath(TESSERACT_WORKER_PATH),
          legacyCore: true,
        });
      } catch (err: unknown) {
        throw new OcrModelMissingError(
          [...languages, OSD_LANGUAGE],
          err instanceof Error ? err.message : String(err),
        );
      }
      if (disposed || requestedGeneration !== generation) {
        void terminateSafely(next);
        throw new CancelledError("ocr-orient");
      }
      worker = next;
      return next;
    })();
    initialization = pending;
    try {
      return await pending;
    } finally {
      if (initialization === pending) initialization = null;
    }
  };

  interface OsdImage {
    readonly canvas: OffscreenCanvas;
    readonly inkRatio: number;
  }

  const buildImage = async (
    payload: OcrOrientationPayload,
    signal: AbortSignal,
    interrupted: Promise<never>,
    isInterrupted: () => boolean,
  ): Promise<OsdImage> => {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      throw new OcrPageFailedError(
        payload.documentId,
        payload.pageIndex,
        "No se puede decodificar la imagen de OSD en este entorno.",
      );
    }
    const blob = new Blob([payload.image.bytes], { type: `image/${payload.image.format}` });
    const factor = osdScaleFactor(payload.image.widthPx, payload.image.heightPx);
    const width = Math.max(1, Math.round(payload.image.widthPx * factor));
    const height = Math.max(1, Math.round(payload.image.heightPx * factor));
    let bitmap: ImageBitmap;
    const decoded = createImageBitmap(blob, { resizeWidth: width, resizeHeight: height });
    decoded.then(
      (lateBitmap) => {
        if (signal.aborted || isInterrupted()) lateBitmap.close();
      },
      () => undefined,
    );
    try {
      bitmap = await Promise.race([decoded, interrupted]);
    } catch (err: unknown) {
      if (err instanceof CancelledError || err instanceof OcrTimeoutError) throw err;
      throw new OcrPageFailedError(
        payload.documentId,
        payload.pageIndex,
        err instanceof Error ? err.message : String(err),
      );
    }
    const canvas = new OffscreenCanvas(width, height);
    let transferredToDetect = false;
    try {
      const context = canvas.getContext("2d");
      if (context === null) {
        throw new OcrPageFailedError(
          payload.documentId,
          payload.pageIndex,
          "No se pudo obtener el contexto 2D para OSD.",
        );
      }
      context.drawImage(bitmap, 0, 0);
      // ADR-190 §3: sobre esta MISMA imagen reducida, antes de descartar nada.
      const inkRatio = computeInkRatio(context, width, height);
      transferredToDetect = true;
      return { canvas, inkRatio };
    } finally {
      bitmap.close();
      if (!transferredToDetect) releaseCanvasBackingStore(canvas);
    }
  };

  const detect = async (
    payload: OcrOrientationPayload,
    signal: AbortSignal,
  ): Promise<OcrOrientationResult> => {
    if (signal.aborted) throw new CancelledError(payload.documentId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let interruptedReject: ((reason: unknown) => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      interruptedReject = reject;
    });
    void interrupted.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new OcrTimeoutError(payload.documentId, payload.pageIndex, payload.timeoutMs)),
        payload.timeoutMs,
      );
    });
    void timeout.catch(() => undefined);
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new CancelledError(payload.documentId));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    void aborted.catch(() => undefined);
    const activeGeneration = generation;
    const interrupt = Promise.race([timeout, aborted]);
    // Fail-open solo hasta obtener la medición. Un fallo posterior de detect
    // conserva la tinta observada, incluido 0 en una página blanca (ADR-190 §3).
    let inkRatio = 1;
    let interruptedFlag = false;
    let interruption: unknown = null;
    let osdCanvas: OffscreenCanvas | null = null;
    let detectOwnsCanvas = false;
    interrupt.then(
      (value: never) => {
        interruptedFlag = true;
        interruptedReject?.(value);
      },
      (err: unknown) => {
        interruptedFlag = true;
        interruption = err;
        interruptedReject?.(err);
      },
    );
    try {
      const activeWorker = await Promise.race([ensureWorker(payload.languages), interrupt]);
      if (interruption !== null) throwInterruption(interruption, payload.documentId);
      if (activeGeneration !== generation) throw new CancelledError(payload.documentId);
      const image = await Promise.race([
        buildImage(payload, signal, interrupted, () => interruptedFlag),
        interrupt,
      ]);
      osdCanvas = image.canvas;
      inkRatio = image.inkRatio;
      if (interruption !== null) throwInterruption(interruption, payload.documentId);
      if (activeGeneration !== generation) throw new CancelledError(payload.documentId);
      const detectJob = activeWorker.detect(image.canvas);
      detectOwnsCanvas = true;
      void detectJob.then(
        () => releaseCanvasBackingStore(image.canvas),
        () => releaseCanvasBackingStore(image.canvas),
      );
      const result = await Promise.race([detectJob, interrupt]);
      if (interruption !== null) throwInterruption(interruption, payload.documentId);
      if (activeGeneration !== generation) throw new CancelledError(payload.documentId);
      return { ...readOrientation(result.data), inkRatio: image.inkRatio };
    } catch (err: unknown) {
      if (err instanceof OcrTimeoutError || err instanceof CancelledError) {
        if (activeGeneration === generation) await invalidate();
        throw err;
      }
      if (err instanceof OcrPageFailedError) throw err;
      if (err instanceof OcrModelMissingError) throw err;
      return { orientation: 0, inkRatio, osdHadVerdict: false };
    } finally {
      if (osdCanvas !== null && !detectOwnsCanvas) releaseCanvasBackingStore(osdCanvas);
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    }
  };

  const dispose = async (): Promise<void> => {
    // `disposed` ANTES de `invalidate()`: cierra la puerta de `ensureWorker`
    // (su guard de tope) para que ninguna carga concurrente pueda arrancar
    // durante la ventana de `invalidate` — que ya deja `initialization` en
    // `null` y no espera una carga que puede quedar pendiente indefinidamente.
    disposed = true;
    await invalidate();
  };

  return { detect, dispose };
}
