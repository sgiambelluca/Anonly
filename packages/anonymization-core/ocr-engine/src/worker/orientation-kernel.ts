import {
  CancelledError,
  type OcrOrientation,
  type OcrOrientationPayload,
  type OcrOrientationResult,
} from "@anonly/shared";
import { createWorker, OEM } from "tesseract.js";

import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "../ocr.errors.js";

import {
  resolveTesseractPath,
  TESSERACT_CORE_PATH,
  TESSERACT_LANG_PATH,
  TESSERACT_WORKER_PATH,
} from "./tesseract-paths.js";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

const OSD_LANGUAGE = "osd";
const OSD_SCALE = 0.5;
const MIN_ORIENTATION_CONFIDENCE = 1;

function isOrientation(value: unknown): value is OcrOrientation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function readOrientation(data: unknown): OcrOrientation {
  if (typeof data !== "object" || data === null) return 0;
  const record = data as {
    readonly orientation_degrees?: unknown;
    readonly orientation_confidence?: unknown;
  };
  return typeof record.orientation_confidence === "number" &&
    record.orientation_confidence >= MIN_ORIENTATION_CONFIDENCE &&
    isOrientation(record.orientation_degrees)
    ? record.orientation_degrees
    : 0;
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

  const buildImage = async (
    payload: OcrOrientationPayload,
    signal: AbortSignal,
    interrupted: Promise<never>,
    isInterrupted: () => boolean,
  ): Promise<OffscreenCanvas> => {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      throw new OcrPageFailedError(
        payload.documentId,
        payload.pageIndex,
        "No se puede decodificar la imagen de OSD en este entorno.",
      );
    }
    const blob = new Blob([payload.image.bytes], { type: `image/${payload.image.format}` });
    const width = Math.max(1, Math.round(payload.image.widthPx * OSD_SCALE));
    const height = Math.max(1, Math.round(payload.image.heightPx * OSD_SCALE));
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
    const context = canvas.getContext("2d");
    if (context === null) {
      bitmap.close();
      throw new OcrPageFailedError(
        payload.documentId,
        payload.pageIndex,
        "No se pudo obtener el contexto 2D para OSD.",
      );
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
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
    let interruptedFlag = false;
    let interruption: unknown = null;
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
      if (interruption !== null) throwInterruption(interruption, payload.documentId);
      if (activeGeneration !== generation) throw new CancelledError(payload.documentId);
      const result = await Promise.race([activeWorker.detect(image), interrupt]);
      if (interruption !== null) throwInterruption(interruption, payload.documentId);
      if (activeGeneration !== generation) throw new CancelledError(payload.documentId);
      return { orientation: readOrientation(result.data) };
    } catch (err: unknown) {
      if (err instanceof OcrTimeoutError || err instanceof CancelledError) {
        if (activeGeneration === generation) await invalidate();
        throw err;
      }
      if (err instanceof OcrPageFailedError) throw err;
      if (err instanceof OcrModelMissingError) throw err;
      return { orientation: 0 };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    }
  };

  const dispose = async (): Promise<void> => {
    disposed = true;
    await invalidate();
    // `invalidate` desvincula una inicialización obsoleta. Observar su
    // rechazo evita una promesa huérfana, pero dispose no espera una carga que
    // puede quedar pendiente indefinidamente.
    initialization?.catch(() => undefined);
    initialization = null;
  };

  return { detect, dispose };
}
