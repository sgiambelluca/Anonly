import {
  CancelledError,
  EngineDisposedError,
  EngineError,
  EngineEvents,
  EventChannel,
  InvalidInputError,
  type EncodedPageImage,
  type EngineContext,
  type OcrOrientationPayload,
} from "@anonly/shared";
import { createWorker } from "tesseract.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
  // ADR-112 §1: el kernel lee `PSM.SPARSE_TEXT` a nivel de módulo, así que el
  // doble tiene que traerlo o la evaluación del import falla. Los valores son
  // los de `tesseract.js/src/constants/PSM.js`; que sigan siendo esos lo fija
  // el test `the page segmentation mode is the tesseract.js enum member`.
  PSM: { AUTO: "3", SPARSE_TEXT: "11" },
  // ADR-119 §1: idem para `OEM`, que el kernel lee al crear el worker de OSD.
  // El valor es el de `tesseract.js/src/constants/OEM.js`; que siga siendo ese
  // lo fija el test `the OSD worker uses the legacy OCR engine mode`.
  OEM: { TESSERACT_ONLY: 0, LSTM_ONLY: 1, TESSERACT_LSTM_COMBINED: 2, DEFAULT: 3 },
}));

import { OcrEngine } from "../ocr.engine.js";
import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "../ocr.errors.js";
import type { OcrPageInput } from "../ocr.types.js";
import { createOrientationKernel } from "../worker/orientation-kernel.js";

import {
  createEncodedPageImage,
  createEngineContext,
  createImageProducer,
  createResolvedOcrPool,
  createValidOcrPageInput,
  createValidOcrPageRequest,
  mockDetectData,
  mockEmptyRecognizeData,
  mockRecognizeData,
  mockTesseractWorker,
  setStubDecodedDataReadThrowsOnce,
  setStubDecodedPixel,
  setStubDecodedPixelSequence,
  trackOffscreenCanvasConstructions,
} from "./fixtures/test-helpers.js";

describe("OcrEngine — edge case tests", () => {
  let engine: OcrEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new OcrEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  // Caso 1 (§13): página completamente vacía (blanca).
  it("ink-gate uncertainty fails open and preserves both margin recognizes", async () => {
    // ADR-190 §2: la pasada principal devuelve una palabra fiable para que la
    // cadena de verificación no dispare pasos adicionales (que multiplicarían
    // este conteo) — el foco del test es el fail-open del ink-gate de margen.
    const UNA_PALABRA_FIABLE = [
      { text: "x", confidence: 95, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
    ];
    const recognize = vi.fn(() =>
      Promise.resolve({ jobId: "j", data: mockRecognizeData(UNA_PALABRA_FIABLE) }),
    );
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(mockRecognizeData(UNA_PALABRA_FIABLE), { recognize }),
    );
    setStubDecodedPixelSequence([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    setStubDecodedDataReadThrowsOnce();
    await engine.init(ctx);
    await engine.processPage(
      {
        ...createValidOcrPageInput("doc-162-uncertain", 0),
        image: createEncodedPageImage(100, 40),
      },
      ctx,
    );
    // La primera inspección falla abierta; la franja que llega al doble corre
    // sus dos rotaciones (la pasada principal completa el total en 3).
    expect(recognize).toHaveBeenCalledTimes(3);
  });

  describe("Caso 1: página completamente vacía (blanca)", () => {
    it("empty page returns empty words", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-blank", 0), ctx);

      expect(output.words).toEqual([]);
      expect(output.confidence).toBe(0);
    });
  });

  // Caso 2 (§13): página con imagen sin texto.
  describe("Caso 2: página con imagen sin texto", () => {
    it("image-only page returns empty words", async () => {
      // blocks con estructura (paragraphs vacío) en vez de blocks: [] — misma
      // salida esperada que caso 1, escenario de mock distinto.
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker({ confidence: 0, blocks: [{ paragraphs: [] }] }),
      );

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-image-only", 0), ctx);

      expect(output.words).toEqual([]);
      expect(output.confidence).toBe(0);
    });
  });

  // Caso 3 (§13): texto muy pequeño (calidad baja), confidence < 0.5.
  describe("Caso 3: texto muy pequeño (calidad baja)", () => {
    it("low confidence warns", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData(
            [{ text: "borroso", confidence: 30, bbox: { x0: 0, y0: 0, x1: 40, y1: 15 } }],
            30,
          ),
        ),
      );

      await engine.init(ctx);
      const loggerWarnSpy = vi.spyOn(ctx.logger, "warn");
      const output = await engine.processPage(createValidOcrPageInput("doc-low-conf", 0), ctx);

      expect(output.confidence).toBeLessThan(0.5);
      expect(output.words.length).toBeGreaterThan(0);
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });

  // Caso 4 (§13): imageData ya transferido. Hito 9: Transferable real
  // (ADR-021 §1). Inline (Hito 3), un imageData "ya transferido/consumido"
  // es indistinguible de un imageData vacío (width/height <= 0) — mismo
  // tratamiento que ADR-020 §9 aplicó al buffer del PDF Engine. ADR-158 §2:
  // la validación ahora lee widthPx/heightPx de EncodedPageImage.
  describe("Caso 4: imageData ya transferido", () => {
    it("throws on already-transferred imageData", async () => {
      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-transferred", 0, {
        image: createEncodedPageImage(0, 0),
      });

      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError when width is 0", async () => {
      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-zero-width", 0, {
        image: createEncodedPageImage(0, 50),
      });
      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError when height is 0", async () => {
      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-zero-height", 0, {
        image: createEncodedPageImage(50, 0),
      });
      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });

    // §13 caso 8 (ADR-064 §4): `dpi` es el divisor de la conversión px→pt.
    it("throws InvalidInputError on non-positive or non-finite dpi", async () => {
      await engine.init(ctx);
      for (const dpi of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const input = createValidOcrPageInput(`doc-dpi-${String(dpi)}`, 0, { dpi });
        await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
      }
    });

    // §9/§13 caso 4 (ADR-158 §5): `image.bytes` detached de verdad (no un
    // ArrayBuffer(0) sin transferir), como si un caller lo hubiera
    // transferido por su cuenta antes de llamar a processPage.
    it("throws on a detached image.bytes", async () => {
      await engine.init(ctx);
      const detachedBytes = new ArrayBuffer(8);
      structuredClone(detachedBytes, { transfer: [detachedBytes] });
      expect(detachedBytes.byteLength).toBe(0);

      const input = createValidOcrPageInput("doc-detached-bytes", 0, {
        image: createEncodedPageImage(100, 40, { bytes: detachedBytes }),
      });

      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // Caso 5 (§13): idioma no cargado en el modelo.
  describe("Caso 5: idioma no cargado en el modelo", () => {
    it("throws on unknown language", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx); // carga ["spa", "eng"] (default de createMockConfig)
      const input = createValidOcrPageInput("doc-unknown-lang", 0, { languages: ["fra"] });

      await expect(engine.processPage(input, ctx)).rejects.toThrow(OcrModelMissingError);
    });
  });

  // Caso 6 (§13): timeout por página — reintentar 2 veces, luego OCR_PAGE_FAILED.
  describe("Caso 6: timeout por página", () => {
    it("retries on timeout up to maxRetries", async () => {
      vi.useFakeTimers();
      try {
        const recognize = vi.fn(() => new Promise(() => {})); // nunca resuelve -> siempre timeout
        vi.mocked(createWorker).mockResolvedValue(
          mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
        );

        await engine.init(ctx);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        const input = createValidOcrPageInput("doc-timeout", 0);
        const resultPromise = engine.processPage(input, ctx);
        const caught = resultPromise.catch((err: unknown) => err);

        // timeout default 60000ms (ctx.config.workerPool.timeouts["ocr-page"]),
        // maxRetries default 2 -> 3 intentos totales.
        await vi.advanceTimersByTimeAsync(60001);
        await vi.advanceTimersByTimeAsync(60001);
        await vi.advanceTimersByTimeAsync(60001);

        const err = await caught;
        expect(err).toBeInstanceOf(OcrPageFailedError);
        expect(recognize).toHaveBeenCalledTimes(3);
        expect(busEmitSpy).toHaveBeenCalledWith(
          EventChannel.Ocr,
          EngineEvents.OCR_PAGE_FAILED,
          expect.objectContaining({ documentId: "doc-timeout", pageIndex: 0 }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Caso 11 (§13): processPage llamado tras dispose.
  describe("Caso 11: processPage tras dispose", () => {
    it("throws EngineDisposedError after dispose", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const input = createValidOcrPageInput("doc-after-dispose", 0);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(EngineDisposedError);
    });

    it("processPages also throws EngineDisposedError after dispose", async () => {
      await engine.init(ctx);
      await engine.dispose();

      const inputs = [createValidOcrPageInput("doc-after-dispose-2", 0)];
      await expect(engine.processPages(inputs, ctx)).rejects.toThrow(EngineDisposedError);
    });
  });

  // No numerado en §13 (regla de §9 Restricciones: input null/undefined).
  describe("Null/undefined input", () => {
    it("throws InvalidInputError for null input in processPage", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input inválido con InvalidInputError
      await expect(engine.processPage(null, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError for null inputs in processPages", async () => {
      await engine.init(ctx);
      // @ts-expect-error — assert de runtime: §9 exige rechazar input inválido con InvalidInputError
      await expect(engine.processPages(null, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // No numerado en §13 (regla de §9 Restricciones: pageIndex >= 0).
  describe("pageIndex inválido", () => {
    it("throws InvalidInputError for negative pageIndex", async () => {
      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-neg-idx", -1);
      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // No numerado en §13 (OCR_MODEL_MISSING también puede originarse al cargar
  // el worker, no solo por incompatibilidad de idioma por-página; §11).
  describe("Modelo Tesseract no disponible al inicializar", () => {
    it("throws OcrModelMissingError when the Tesseract model fails to load", async () => {
      vi.mocked(createWorker).mockRejectedValue(new Error("network unreachable"));

      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-model-missing", 0);

      await expect(engine.processPage(input, ctx)).rejects.toThrow(OcrModelMissingError);
    });
  });

  // No numerado en §13 (cancelación cooperativa por checkpoint; el SLA
  // estricto < 200ms es Hito 9/11, ver ADR-021 §1).
  describe("Cancelación cooperativa (checkpoint)", () => {
    it("throws CancelledError when abort is signalled before processing starts", async () => {
      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });
      abortController.abort();

      await engine.init(abortedCtx);
      const input = createValidOcrPageInput("doc-cancelled", 0);
      await expect(engine.processPage(input, abortedCtx)).rejects.toThrow(CancelledError);
    });

    it("stops processing remaining pages once aborted mid-batch", async () => {
      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });

      // El propio recognize() de la página 0 dispara el abort como efecto
      // colateral, simulando una cancelación del usuario a mitad de proceso.
      const recognize = vi.fn(() => {
        abortController.abort();
        return Promise.resolve({ jobId: "job", data: mockEmptyRecognizeData() });
      });
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
      );

      await engine.init(abortedCtx);
      const inputs: OcrPageInput[] = [
        createValidOcrPageInput("doc-cancel-mid", 0),
        createValidOcrPageInput("doc-cancel-mid", 1),
      ];

      await expect(engine.processPages(inputs, abortedCtx)).rejects.toThrow(CancelledError);
      expect(recognize).toHaveBeenCalledTimes(1);
    });
  });

  // Caso 28 (§13, ADR-164 §3): "una inicialización OSD, máximo un detect en
  // vuelo" — el servicio compartido se comporta bien ante cancelación/timeout
  // en cualquiera de sus tres superficies (cola, carga, decodificación/detect).
  describe("Caso 28: cancelación/timeout del servicio OSD compartido", () => {
    function orientationPayload(overrides?: Partial<OcrOrientationPayload>): OcrOrientationPayload {
      return {
        documentId: "doc-osd-cancel",
        pageIndex: 0,
        image: createEncodedPageImage(100, 40),
        languages: ["spa", "eng"],
        timeoutMs: 100,
        ...overrides,
      };
    }

    it("cancels queued orientation without loading or recognizing", async () => {
      // El pool serial de orientación in-process (`createImmediateOrientationPool`,
      // ocr.engine.ts) corre un solo `detect` a la vez: una segunda página que
      // queda encolada detrás de la primera puede cancelarse ANTES de que le
      // toque el turno, sin llegar a cargar el worker OSD (que ya está cargado,
      // compartido) ni a invocar `detect()` para ella.
      let releaseFirstDetect!: () => void;
      const firstDetect = vi.fn(
        () =>
          new Promise<ReturnType<typeof mockDetectData>>((resolve) => {
            releaseFirstDetect = () => resolve(mockDetectData(0));
          }),
      );
      const recognitionWorker1 = mockTesseractWorker(mockEmptyRecognizeData());
      vi.mocked(createWorker)
        .mockResolvedValueOnce(
          mockTesseractWorker({ confidence: 90, blocks: [] }, { detect: firstDetect }),
        )
        .mockResolvedValueOnce(recognitionWorker1);

      const ctx1 = createEngineContext({ abortSignal: new AbortController().signal });
      await engine.init(ctx1);

      const request1 = engine.processPage(createValidOcrPageInput("doc-queue-1", 0), ctx1);
      await vi.waitFor(() => expect(firstDetect).toHaveBeenCalledTimes(1));

      const abortController2 = new AbortController();
      const ctx2 = createEngineContext({ abortSignal: abortController2.signal });
      const recognitionWorker2 = mockTesseractWorker(mockEmptyRecognizeData());
      vi.mocked(createWorker).mockResolvedValueOnce(recognitionWorker2);
      const request2 = engine.processPage(createValidOcrPageInput("doc-queue-2", 0), ctx2);
      // Deja que la página 2 llegue a encolarse detrás de la 1 antes de cancelarla.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      abortController2.abort();
      await expect(request2).rejects.toBeInstanceOf(CancelledError);
      expect(firstDetect).toHaveBeenCalledTimes(1); // nunca un segundo detect
      expect(recognitionWorker2.recognize).not.toHaveBeenCalled();

      releaseFirstDetect();
      await expect(request1).resolves.toBeDefined();
    });

    it("terminates timed out or aborted OSD and ignores late initialization and decode", async () => {
      // (a) timeout durante detect(): termina el worker OSD y reporta OcrTimeoutError.
      vi.useFakeTimers();
      try {
        const terminateOnTimeout = vi.fn(() => Promise.resolve());
        const detectNeverResolves = vi.fn(() => new Promise<never>(() => undefined));
        vi.mocked(createWorker).mockResolvedValue(
          mockTesseractWorker(
            { confidence: 90, blocks: [] },
            { detect: detectNeverResolves, terminate: terminateOnTimeout },
          ),
        );
        const timeoutKernel = createOrientationKernel();
        const timeoutResult = timeoutKernel.detect(
          orientationPayload({ timeoutMs: 10 }),
          new AbortController().signal,
        );
        const timeoutAssertion = expect(timeoutResult).rejects.toBeInstanceOf(OcrTimeoutError);
        await vi.advanceTimersByTimeAsync(11);
        await timeoutAssertion;
        expect(terminateOnTimeout).toHaveBeenCalledTimes(1);
        await timeoutKernel.dispose();
      } finally {
        vi.useRealTimers();
      }

      // (b) abort durante detect(): termina el worker OSD, no deja viva una
      // detección tardía.
      const terminateOnAbort = vi.fn(() => Promise.resolve());
      const detectHangs = vi.fn(() => new Promise<never>(() => undefined));
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          { confidence: 90, blocks: [] },
          { detect: detectHangs, terminate: terminateOnAbort },
        ),
      );
      const abortKernel = createOrientationKernel();
      const abortController = new AbortController();
      const abortResult = abortKernel.detect(orientationPayload(), abortController.signal);
      abortController.abort();
      await expect(abortResult).rejects.toBeInstanceOf(CancelledError);
      expect(terminateOnAbort).toHaveBeenCalledTimes(1);
      await abortKernel.dispose();

      // (c) inicialización (carga) que resuelve tarde, tras un timeout o un
      // abort: el worker tardío se descarta (terminado) y no pisa la
      // generación nueva. Las dos formas de interrumpir una carga pendiente.
      for (const mode of ["timeout", "abort"] as const) {
        vi.useFakeTimers();
        let releaseLateInit!: (worker: Awaited<ReturnType<typeof createWorker>>) => void;
        const lateTerminate = vi.fn(() => Promise.resolve());
        const lateWorker = mockTesseractWorker(
          { confidence: 90, blocks: [] },
          { terminate: lateTerminate },
        );
        vi.mocked(createWorker).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseLateInit = resolve;
            }),
        );
        const lateInitKernel = createOrientationKernel();
        const lateInitController = new AbortController();
        const lateInitTask = lateInitKernel.detect(
          orientationPayload({ timeoutMs: 5 }),
          lateInitController.signal,
        );
        const lateInitAssertion = expect(lateInitTask).rejects.toBeInstanceOf(
          mode === "abort" ? CancelledError : OcrTimeoutError,
        );
        if (mode === "abort") lateInitController.abort();
        await vi.advanceTimersByTimeAsync(11);
        await lateInitAssertion;
        vi.useRealTimers();
        releaseLateInit(lateWorker);
        await Promise.resolve();
        await Promise.resolve();
        expect(lateTerminate).toHaveBeenCalledTimes(1);
        await lateInitKernel.dispose();
      }

      // (d) decodificación (bitmap) que resuelve tarde, tras el deadline: se
      // cierra sin usarse.
      vi.useFakeTimers();
      try {
        vi.mocked(createWorker).mockResolvedValue(
          mockTesseractWorker({ confidence: 90, blocks: [] }),
        );
        const originalBitmap = await createImageBitmap(new Blob());
        let releaseBitmap!: (bitmap: ImageBitmap) => void;
        vi.spyOn(globalThis, "createImageBitmap").mockImplementation(
          () =>
            new Promise((resolve) => {
              releaseBitmap = resolve;
            }),
        );
        const closeBitmap = vi.spyOn(originalBitmap, "close");
        const bitmapKernel = createOrientationKernel();
        const bitmapTask = bitmapKernel.detect(
          orientationPayload({ timeoutMs: 10 }),
          new AbortController().signal,
        );
        const bitmapAssertion = expect(bitmapTask).rejects.toBeInstanceOf(OcrTimeoutError);
        await vi.advanceTimersByTimeAsync(11);
        await bitmapAssertion;
        releaseBitmap(originalBitmap);
        await Promise.resolve();
        expect(closeBitmap).toHaveBeenCalledTimes(1);
        await bitmapKernel.dispose();
      } finally {
        vi.useRealTimers();
        vi.restoreAllMocks();
      }
    });
  });

  // ADR-045 §2: cualquier timeout que emerja del despacho (propio o del
  // pool) se normaliza a OcrTimeoutError ANTES de que el loop de retry lo
  // evalúe. Un timeout que cruzó un worker remoto llega deserializado
  // (EngineError.deserialize, Contracts.md §4): misma `code` pero NO
  // `instanceof OcrTimeoutError` — sin la normalización, el loop lo trataría
  // como no-recuperable y la política de reintentos cambiaría de forma según
  // haya pool real o fallback.
  describe("Normalización de timeout en el borde del puerto (ADR-045 §2)", () => {
    it("dispatch timeout normalized to OcrTimeoutError and retried by engine loop", async () => {
      // ADR-190 §2: palabra fiable para que el éxito del tercer intento no
      // dispare la cadena de verificación (que despacharía más llamadas al
      // MISMO pool, descolocando el conteo de `dispatchCalls`).
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([{ text: "x", confidence: 95, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } }]),
        ),
      );

      const realTimeout = new OcrTimeoutError("doc-normalize-timeout", 0, 60000);
      const deserializedTimeout = EngineError.deserialize(realTimeout.serialize());
      // Valida la premisa del test: la deserialización NO reconstruye la
      // subclase concreta (Contracts.md §4).
      expect(deserializedTimeout).not.toBeInstanceOf(OcrTimeoutError);

      let dispatchCalls = 0;
      const pool = {
        dispatch: <T>(params: { readonly run: () => Promise<T> }): Promise<T> => {
          dispatchCalls += 1;
          if (dispatchCalls <= 2) {
            return Promise.reject(deserializedTimeout) as Promise<T>;
          }
          return params.run();
        },
        releaseIdleWorkers: (): boolean => false,
      };
      const pooledEngine = new OcrEngine(pool);
      await pooledEngine.init(ctx);

      const output = await pooledEngine.processPage(
        createValidOcrPageInput("doc-normalize-timeout", 0),
        ctx,
      );

      expect(output).toBeDefined();
      // 2 fallos "timeout" normalizados (reintentados) + 1 éxito = 3 llamadas
      // (maxRetries default = 2, mismo presupuesto que un OcrTimeoutError real).
      expect(dispatchCalls).toBe(3);

      await pooledEngine.dispose();
    });

    // O-5: `normalizeTimeout` recibe el timeout de LA página que expiró —
    // antes se inferia con `err.code === OCR_TIMEOUT`, que no distingue el
    // despacho de orientación del de reconocimiento: cualquier timeout de
    // reconocimiento que cruzó un Worker real (deserializado, misma `code`)
    // se etiquetaba con `orientationTimeoutMs`. `timeouts["ocr-orient"]` y
    // `timeouts["ocr-page"]` distintos, y `maxRetries["ocr-page"]: 0` para
    // que el ÚNICO intento falle directo a `OCR_PAGE_FAILED` sin reintentar.
    it("attributes a recognition-dispatch timeout to the recognition timeout, not the orientation one", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      const RECOGNITION_TIMEOUT_MS = 5000;
      const ORIENTATION_TIMEOUT_MS = 9000;
      // El valor que lleva ESTE error serializado es irrelevante: el `catch`
      // de `processPageInternal` reconstruye uno nuevo con el timeout que
      // decide `recognitionDispatched`, descartando el que trae acá adentro.
      const remoteTimeout = new OcrTimeoutError("doc-attribute-timeout", 0, 111);
      const deserializedTimeout = EngineError.deserialize(remoteTimeout.serialize());
      expect(deserializedTimeout).not.toBeInstanceOf(OcrTimeoutError);

      const recognitionPool = {
        dispatch: (): Promise<never> => Promise.reject(deserializedTimeout),
        releaseIdleWorkers: (): boolean => false,
      };
      const pooledEngine = new OcrEngine(recognitionPool);
      const timeoutCtx = createEngineContext({
        config: {
          ...ctx.config,
          workerPool: {
            ...ctx.config.workerPool,
            timeouts: {
              ...ctx.config.workerPool.timeouts,
              "ocr-page": RECOGNITION_TIMEOUT_MS,
              "ocr-orient": ORIENTATION_TIMEOUT_MS,
            },
            maxRetries: { ...ctx.config.workerPool.maxRetries, "ocr-page": 0 },
          },
        },
      });
      await pooledEngine.init(timeoutCtx);

      const rejection: unknown = await pooledEngine
        .processPage(createValidOcrPageInput("doc-attribute-timeout", 0), timeoutCtx)
        .catch((err: unknown) => err);

      expect(rejection).toBeInstanceOf(OcrPageFailedError);
      const reason = (rejection as OcrPageFailedError).details.reason;
      expect(reason).toContain(`${RECOGNITION_TIMEOUT_MS}ms`);
      expect(reason).not.toContain(`${ORIENTATION_TIMEOUT_MS}ms`);

      await pooledEngine.dispose();
    });
  });

  // Sobre del dispatch, obligatorio (ADR-055 §5): un `OcrJobPool.dispatch()`
  // que resuelve una forma no reconocida (ni `KernelOcrResult` remoto ni
  // in-process — en OCR son la misma forma, así que cualquier otra cosa es
  // simplemente inválida) tiene que lanzar `InvalidInputError` en vez de
  // devolver un default en silencio (`[]`/`undefined`/`{ words: [],
  // confidence: 0 }`). Decisión de este motor (ver comentario de cabecera de
  // ocr.engine.ts): a diferencia de NER, la falla de decodificación se trata
  // como un fallo más de ESA página (mismo camino que `OcrPageFailedError` /
  // `OCR_PAGE_FAILED`) — no aborta `processPages` entero — porque OCR ya
  // tiene un evento observable por página para cualquier fallo; nada se
  // disfraza de resultado sano.
  describe("Sobre del dispatch: forma no reconocida (ADR-055 §5)", () => {
    it("processPage throws OcrPageFailedError and emits OCR_PAGE_FAILED (never a silent default)", async () => {
      const garbageValues: ReadonlyArray<unknown> = [{}, null, "not-a-recognized-shape"];

      for (const garbage of garbageValues) {
        const pool = createResolvedOcrPool(garbage);
        const pooledEngine = new OcrEngine(pool);
        await pooledEngine.init(ctx);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        const input = createValidOcrPageInput("doc-garbage-dispatch", 0);

        const rejection: unknown = await pooledEngine
          .processPage(input, ctx)
          .catch((err: unknown) => err);
        expect(rejection).toBeInstanceOf(OcrPageFailedError);
        // Prueba de regresión real (Validación del ADR-055: "revirtiendo el
        // decoder, ese test tiene que fallar"): el mensaje tiene que venir
        // específicamente de `decodeKernelOcrResult`, no de un TypeError
        // accidental al desestructurar `words`/`confidence` de un valor mal
        // formado (que también terminaría envuelto en OcrPageFailedError,
        // pero por una causa distinta — sin este assert, este test seguiría
        // en verde con el decoder revertido).
        expect((rejection as OcrPageFailedError).message).toContain(
          "OcrJobPool.dispatch() resolvió con una forma no reconocida",
        );

        const pageFailedCall = busEmitSpy.mock.calls.find(
          ([, event]) => event === EngineEvents.OCR_PAGE_FAILED,
        );
        expect(pageFailedCall).toBeDefined();
        // OCR_PAGE_FINISHED nunca se emite para un dispatch que no se pudo
        // decodificar — la falla no se disfraza de página procesada.
        expect(
          busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.OCR_PAGE_FINISHED),
        ).toBe(false);

        await pooledEngine.dispose();
      }
    });

    // Regresión de referencia (mismo criterio que Code_Standards.md §7,
    // párrafo final, para el canal de errores): un test que solo verifica
    // "se lanza algo" pasa igual con el bug vivo, porque el destructuring
    // ciego de `words`/`confidence` sobre un valor con forma parcialmente
    // válida NO siempre explota — a veces produce un resultado incorrecto
    // que se cuela como si fuera sano. `{ words: "no-es-un-array",
    // confidence: 0.9 }` es ese caso: sin decoder, `words.length` (13, el
    // length de la STRING) es `> 0` y `confidence` (0.9) no es `< 0.5`, así
    // que el código viejo (cast ciego) resolvía "exitosamente" con
    // `words: "no-es-un-array"` — exactamente la clase de corrupción
    // silenciosa que ADR-055 prohíbe. Con el decoder, `isWordArray` rechaza
    // el string y lanza.
    it("throws even when the malformed shape would NOT crash a blind destructure (ADR-055 §3)", async () => {
      const pool = createResolvedOcrPool({ words: "no-es-un-array", confidence: 0.9 });
      const pooledEngine = new OcrEngine(pool);
      await pooledEngine.init(ctx);
      const input = createValidOcrPageInput("doc-garbage-silent", 0);

      await expect(pooledEngine.processPage(input, ctx)).rejects.toBeInstanceOf(OcrPageFailedError);

      await pooledEngine.dispose();
    });

    it("processPages treats the decode failure as a tolerable page failure and continues (OCR_Engine.md §13 caso 6)", async () => {
      // processPages(), no processPage() directo, es el path real por el que
      // pasan las páginas en producción (Orchestrator/checklist §15.7): el
      // error tiene que llegar hasta acá sin que el warn+continue existente
      // (pensado para OcrPageFailedError "genuinos") lo trague de una forma
      // distinta a como trata cualquier otro fallo de página.
      const pool = createResolvedOcrPool("not-a-recognized-shape");
      const pooledEngine = new OcrEngine(pool);
      await pooledEngine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const inputs = [
        createValidOcrPageInput("doc-garbage-batch", 0),
        createValidOcrPageInput("doc-garbage-batch", 1),
      ];

      // No aborta el batch: a diferencia de OcrModelMissingError/CancelledError,
      // una forma no reconocida por página no impide que se siga intentando
      // con las páginas siguientes (documento parcial, cada fallo visible).
      const outputs = await pooledEngine.processPages(inputs, ctx);

      expect(outputs).toEqual([]);
      const pageFailedCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.OCR_PAGE_FAILED,
      );
      expect(pageFailedCalls.length).toBe(2);
      // OCR_FINISHED sigue emitiéndose al final del batch (§7): el documento
      // no se cuelga, aunque ninguna página haya producido words reales —
      // muy distinto del bug de NER, donde un batch íntegro fallando de este
      // modo terminaba pareciendo "0 entidades" sin ninguna señal de que algo
      // se rompió.
      expect(busEmitSpy.mock.calls.some(([, event]) => event === EngineEvents.OCR_FINISHED)).toBe(
        true,
      );

      await pooledEngine.dispose();
    });
  });

  // Caso 17 (§13, ADR-143 §4): un descriptor cuyo estimatedBytes por sí solo
  // supera ocr.maxLiveImageBytes falla sin producir — nunca se encoge el DPI
  // ni se recorta en silencio.
  describe("Caso 17: estimatedBytes de un descriptor supera maxLiveImageBytes por sí solo", () => {
    it("fails the page with OcrPageFailedError, without calling produce(), and continues with the rest", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const produce = vi.fn(createImageProducer());
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const requests = [
        // ctx.config.ocr.maxLiveImageBytes = 128 MiB (createMockConfig).
        createValidOcrPageRequest("doc-budget-alone", 0, { estimatedBytes: 200 * 1024 * 1024 }),
        createValidOcrPageRequest("doc-budget-alone", 1),
      ];

      const outputs = await engine.processSession(requests, produce, ctx);

      expect(outputs.map((o) => o.pageIndex)).toEqual([1]);
      // produce() nunca se invoca para la página 0: ni rasteriza de más.
      expect(produce).toHaveBeenCalledTimes(1);
      expect(produce).toHaveBeenCalledWith(requests[1], ctx.abortSignal);

      const pageFailedCall = busEmitSpy.mock.calls.find(
        ([, event, payload]) =>
          event === EngineEvents.OCR_PAGE_FAILED &&
          (payload as { pageIndex: number }).pageIndex === 0,
      );
      expect(pageFailedCall).toBeDefined();
      const errorPayload = (
        pageFailedCall?.[2] as { error: { message: string; details: Record<string, unknown> } }
      ).error;
      expect(errorPayload.message).toContain("supera ocr.maxLiveImageBytes");
      expect(errorPayload.details.documentId).toBe("doc-budget-alone");
      expect(errorPayload.details.pageIndex).toBe(0);
    });
  });

  // Caso 18 (§13, ADR-143 §4): un fallo del productor (Render) recibe el
  // mismo tratamiento que un fallo de página, con el `code` del error
  // original en `details`. OCR no reintenta la producción por su cuenta.
  describe("Caso 18: fallo del productor (Render)", () => {
    it("reports a producer failure as OCR_PAGE_FAILED carrying the original error's code, and continues", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const renderError = new InvalidInputError("rasterización fallida: PDF corrupto", {
        documentId: "doc-producer-fails",
      });
      const okImage = createEncodedPageImage(100, 40);
      // ctx.config.workerPool.ocrPoolSize = 1 (createMockConfig): concurrency
      // 1 garantiza orden estrictamente secuencial por índice, así que la
      // PRIMERA llamada a produce() es siempre la de la página 0.
      const produce = vi
        .fn<(request: unknown, signal: AbortSignal) => Promise<EncodedPageImage>>()
        .mockRejectedValueOnce(renderError)
        .mockResolvedValueOnce(okImage);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const requests = [
        createValidOcrPageRequest("doc-producer-fails", 0),
        createValidOcrPageRequest("doc-producer-fails", 1),
      ];

      const outputs = await engine.processSession(requests, produce, ctx);

      expect(outputs.map((o) => o.pageIndex)).toEqual([1]);
      const pageFailedCall = busEmitSpy.mock.calls.find(
        ([, event, payload]) =>
          event === EngineEvents.OCR_PAGE_FAILED &&
          (payload as { pageIndex: number }).pageIndex === 0,
      );
      expect(pageFailedCall).toBeDefined();
      const errorPayload = (
        pageFailedCall?.[2] as { error: { message: string; details: Record<string, unknown> } }
      ).error;
      expect(errorPayload.message).toContain("PDF corrupto");
      expect(errorPayload.details.originalCode).toBe(renderError.code);

      // OCR no reintenta la producción por su cuenta (ADR-143 §4): un único
      // intento fallido por la página 0.
      expect(produce).toHaveBeenCalledTimes(2);
    });

    it("propagates a CancelledError from the producer instead of treating it as a page failure", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });
      await engine.init(abortedCtx);

      const produce = vi.fn(() => {
        abortController.abort();
        return Promise.reject(new CancelledError("doc-producer-cancel"));
      });
      const requests = [createValidOcrPageRequest("doc-producer-cancel", 0)];

      await expect(engine.processSession(requests, produce, abortedCtx)).rejects.toThrow(
        CancelledError,
      );
    });
  });

  // Caso 21 (§13, ADR-160 §4): orientación ≠ 0 — camino lento, declarado.
  describe("Caso 21: orientación ≠ 0 (camino lento)", () => {
    it("orientation !== 0 still decodes the full page (slow path)", async () => {
      const image = createEncodedPageImage(100, 40);
      const detect = vi.fn((_image: unknown) => Promise.resolve(mockDetectData(180)));
      const raw = [{ text: "giro", confidence: 90, bbox: { x0: 10, y0: 10, x1: 30, y1: 20 } }];
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(raw), { detect }),
      );
      await engine.init(ctx);

      const tracker = trackOffscreenCanvasConstructions();
      let output: Awaited<ReturnType<typeof engine.processPage>>;
      try {
        output = await engine.processPage(
          { ...createValidOcrPageInput("doc-caso21-slow-path", 0), image },
          ctx,
        );
      } finally {
        tracker.restore();
      }

      // Es EXACTAMENTE el discriminante que pide ADR-149 §2 para el test
      // estructural de unit.test.ts: acá tiene que dar > 0.
      expect(tracker.constructions.some((c) => c.width === 100 && c.height === 40)).toBe(true);
      expect(output.words[0]?.bbox.rotation).toBe(180);
    });
  });

  // Caso 22 (§13, ADR-160): createImageBitmap ausente o que rechaza.
  describe("Caso 22: createImageBitmap ausente o que rechaza", () => {
    it("createImageBitmap missing or rejecting fails the page as OcrPageFailedError, not a raw ReferenceError", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));
      await engine.init(ctx);

      const original = globalThis.createImageBitmap;
      // @ts-expect-error -- se borra a propósito para simular el entorno sin la API.
      delete globalThis.createImageBitmap;
      try {
        await expect(
          engine.processPage(createValidOcrPageInput("doc-caso22-sin-bitmap", 0), ctx),
        ).rejects.toThrow(OcrPageFailedError);
      } finally {
        globalThis.createImageBitmap = original;
      }
    });

    it("a rejecting createImageBitmap fails the page as OcrPageFailedError", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));
      await engine.init(ctx);

      const original = globalThis.createImageBitmap;
      globalThis.createImageBitmap = ((): Promise<ImageBitmap> =>
        Promise.reject(new Error("boom"))) as typeof createImageBitmap;
      try {
        await expect(
          engine.processPage(createValidOcrPageInput("doc-caso22-bitmap-rechaza", 0), ctx),
        ).rejects.toThrow(OcrPageFailedError);
      } finally {
        globalThis.createImageBitmap = original;
      }
    });

    it("a strip that fails to decode is skipped without costing the upright text", async () => {
      // La franja falla (createImageBitmap rechaza SOLO para el recorte de 5
      // argumentos — OSD y el reconocimiento principal siguen andando), y el
      // texto derecho, ya reconocido, sobrevive intacto — mismo criterio que
      // el caso 16 con `cropImageData`.
      const CUERPO = [{ text: "cuerpo", confidence: 95, bbox: { x0: 60, y0: 10, x1: 90, y1: 22 } }];
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockRecognizeData(CUERPO)));
      await engine.init(ctx);

      const original = globalThis.createImageBitmap;
      globalThis.createImageBitmap = ((...args: Parameters<typeof original>) => {
        if (args.length === 5) return Promise.reject(new Error("franja rota"));
        return original(...args);
      }) as typeof createImageBitmap;
      try {
        const output = await engine.processPage(
          createValidOcrPageInput("doc-caso22-franja-falla", 0, {
            image: createEncodedPageImage(100, 40),
          }),
          ctx,
        );
        expect(output.words.map((w) => w.text)).toEqual(["cuerpo"]);
      } finally {
        globalThis.createImageBitmap = original;
      }
    });
  });

  // ─── ADR-190 §2/§3/§4: cadena de verificación — casos límite ───
  //
  // Mismo criterio que la descripción de arriba de "cadena de verificación
  // (ADR-190 §2)" en unit.test.ts: `orientationPool` inyectado a mano para
  // que `inkRatio` no comparta el stub de píxeles con las franjas de margen.
  describe("cadena de verificación — casos límite (ADR-190)", () => {
    function fakeOrientationPool(
      orientation: 0 | 90 | 180 | 270,
      inkRatio: number,
      osdHadVerdict = true,
    ): { readonly dispatch: () => Promise<unknown>; readonly releaseIdleWorkers: () => boolean } {
      return {
        dispatch: (): Promise<unknown> => Promise.resolve({ orientation, inkRatio, osdHadVerdict }),
        releaseIdleWorkers: (): boolean => false,
      };
    }

    beforeEach(() => {
      // Franjas de margen desactivadas (ADR-162): sin esto, cada intento de
      // la cadena arrastraría llamadas de margen extra por su cuenta.
      setStubDecodedPixel([255, 255, 255, 255]);
    });

    it("rejects orientation results whose inkRatio is outside [0,1]", async () => {
      for (const inkRatio of [-0.01, 1.01, NaN, Infinity, -Infinity, "0", undefined]) {
        const recognitionPool = createResolvedOcrPool({ words: [], confidence: 0 });
        const recognitionDispatch = vi.spyOn(recognitionPool, "dispatch");
        const orientationDispatch = vi.fn(() =>
          Promise.resolve({ orientation: 0, inkRatio, osdHadVerdict: true }),
        );
        const pooledEngine = new OcrEngine(recognitionPool, {
          dispatch: orientationDispatch,
          releaseIdleWorkers: (): boolean => false,
        });
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        busEmitSpy.mockClear();
        await pooledEngine.init(ctx);
        try {
          await expect(
            pooledEngine.processPage(createValidOcrPageInput("doc-190-invalid-ink", 0), ctx),
          ).rejects.toThrow("inkRatio inválido en el resultado de orientación");
          expect(orientationDispatch).toHaveBeenCalledTimes(1);
          expect(recognitionDispatch).not.toHaveBeenCalled();
          expect(busEmitSpy.mock.calls.map(([, event]) => event)).toEqual([
            EngineEvents.OCR_PAGE_FAILED,
          ]);
        } finally {
          await pooledEngine.dispose();
        }
      }
    });

    it("rejects orientation results without a boolean osdHadVerdict", async () => {
      for (const osdHadVerdict of [undefined, 0, "false"]) {
        const recognitionPool = createResolvedOcrPool({ words: [], confidence: 0 });
        const recognitionDispatch = vi.spyOn(recognitionPool, "dispatch");
        const orientationDispatch = vi.fn(() =>
          Promise.resolve({ orientation: 0, inkRatio: 0, osdHadVerdict }),
        );
        const pooledEngine = new OcrEngine(recognitionPool, {
          dispatch: orientationDispatch,
          releaseIdleWorkers: (): boolean => false,
        });
        await pooledEngine.init(ctx);
        try {
          await expect(
            pooledEngine.processPage(createValidOcrPageInput("doc-190-invalid-verdict", 0), ctx),
          ).rejects.toThrow("osdHadVerdict inválido");
          expect(recognitionDispatch).not.toHaveBeenCalled();
        } finally {
          await pooledEngine.dispose();
        }
      }
    });

    it.each([0, 1])("accepts orientation inkRatio at the valid endpoint %s", async (inkRatio) => {
      const recognitionPool = createResolvedOcrPool({ words: [], confidence: 0 });
      const recognitionDispatch = vi.spyOn(recognitionPool, "dispatch");
      const pooledEngine = new OcrEngine(recognitionPool, fakeOrientationPool(0, inkRatio));
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await pooledEngine.init(ctx);
      try {
        const output = await pooledEngine.processPage(
          createValidOcrPageInput("doc-190-valid-ink", 0),
          ctx,
        );
        expect(output.words).toEqual([]);
        expect(recognitionDispatch).toHaveBeenCalledTimes(inkRatio === 0 ? 1 : 4);
        const finished = busEmitSpy.mock.calls.find(
          ([, event]) => event === EngineEvents.OCR_PAGE_FINISHED,
        );
        expect(finished?.[2]).toEqual({
          documentId: "doc-190-valid-ink",
          pageIndex: 0,
          wordCount: 0,
          confidence: 0,
          ...(inkRatio === 1 ? { unreadableInk: true } : {}),
        });
      } finally {
        await pooledEngine.dispose();
      }
    });

    it("a blank page remains unflagged when the real orientation kernel detection fails", async () => {
      const detect = vi.fn(() =>
        Promise.reject(new Error("Too few characters. Skipping this page")),
      );
      const recognize = vi.fn(() =>
        Promise.resolve({ jobId: "blank", data: mockEmptyRecognizeData() }),
      );
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { detect, recognize }),
      );
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      // Sin puerto fake de orientación: atraviesa el kernel y mide los píxeles.
      await engine.init(ctx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-190-blank-detect-failure", 0, {
          image: createEncodedPageImage(100, 40),
        }),
        ctx,
      );
      expect(output.words).toEqual([]);
      expect(detect).toHaveBeenCalledTimes(1);
      expect(recognize).toHaveBeenCalledTimes(1);
      const finished = busEmitSpy.mock.calls.find(
        ([, event]) => event === EngineEvents.OCR_PAGE_FINISHED,
      );
      expect(finished?.[2]).toEqual({
        documentId: "doc-190-blank-detect-failure",
        pageIndex: 0,
        wordCount: 0,
        confidence: 0,
      });
    });

    // Caso 46 (§13), ADR-190 §3.
    it("a blank or noise-only page does not trigger retries nor unreadableInk", async () => {
      const recognize = vi.fn(() =>
        Promise.resolve({ jobId: "j", data: mockEmptyRecognizeData() }),
      );
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
      );
      // inkRatio por debajo de INK_PRESENT_RATIO (0.002): página en blanco/ruido.
      // Incluso un veredicto girado queda fuera de la cadena si no hay tinta.
      const pooledEngine = new OcrEngine(undefined, fakeOrientationPool(180, 0.001));
      await pooledEngine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");

      const output = await pooledEngine.processPage(
        createValidOcrPageInput("doc-190-blank", 0),
        ctx,
      );

      expect(recognize).toHaveBeenCalledTimes(1); // sin reintentos
      expect(output.words).toEqual([]);
      const finished = busEmitSpy.mock.calls.find(
        ([channel, event]) =>
          channel === EventChannel.Ocr && event === EngineEvents.OCR_PAGE_FINISHED,
      );
      expect(
        (finished?.[2] as { readonly unreadableInk?: true } | undefined)?.unreadableInk,
      ).toBeUndefined();
      await pooledEngine.dispose();
    });

    // Caso 47 (§13), ADR-190 §2: un CancelledError corta la cadena.
    it("cancellation stops the retry chain", async () => {
      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });
      let recognizeCalls = 0;
      const recognize = vi.fn(() => {
        recognizeCalls += 1;
        if (recognizeCalls === 1) {
          // Tras la primera lectura (débil), el signal se aborta ANTES de que
          // la cadena intente el próximo ángulo.
          abortController.abort();
          return Promise.resolve({
            jobId: "j1",
            data: mockRecognizeData([
              { text: "y", confidence: 40, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
            ]),
          });
        }
        throw new Error("no debería llegar acá: la cadena tenía que cortarse antes");
      });
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
      );
      const pooledEngine = new OcrEngine(undefined, fakeOrientationPool(0, 1));
      await pooledEngine.init(abortedCtx);

      await expect(
        pooledEngine.processPage(createValidOcrPageInput("doc-190-cancel", 0), abortedCtx),
      ).rejects.toBeInstanceOf(CancelledError);
      expect(recognize).toHaveBeenCalledTimes(1);
      await pooledEngine.dispose();
    });

    // Caso 47 (§13), ADR-190 §2: un fallo en un paso posterior al primero
    // conserva la mejor lectura obtenida hasta ahí, sin hacer fallar la página.
    it("a failure in a retry keeps the best reading so far", async () => {
      let recognizeCalls = 0;
      const recognize = vi.fn(() => {
        recognizeCalls += 1;
        if (recognizeCalls === 1) {
          return Promise.resolve({
            jobId: "j1",
            data: mockRecognizeData([
              { text: "debil", confidence: 40, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
            ]),
          });
        }
        // Paso 3 (90°): el despacho de reconocimiento falla, pero no es un
        // CancelledError ni un OcrModelMissingError.
        return Promise.reject(new Error("fallo transitorio del segundo intento"));
      });
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
      );
      const pooledEngine = new OcrEngine(undefined, fakeOrientationPool(0, 1));
      await pooledEngine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");

      const output = await pooledEngine.processPage(
        createValidOcrPageInput("doc-190-partial-failure", 0),
        ctx,
      );

      // La página NO falla: se queda con la lectura débil del paso 1.
      expect(output.words.map((w) => w.text)).toEqual(["debil"]);
      const failed = busEmitSpy.mock.calls.some(
        ([channel, event]) =>
          channel === EventChannel.Ocr && event === EngineEvents.OCR_PAGE_FAILED,
      );
      expect(failed).toBe(false);
      await pooledEngine.dispose();
    });

    // Caso 47 (§13): también los errores de modelo posteriores conservan la lectura.
    it("a model-missing error in a retry keeps the best reading so far", async () => {
      const documentId = "doc-190-retry-model-missing";
      const firstReading = {
        words: [
          {
            text: "legible",
            pageIndex: 0,
            source: "ocr" as const,
            confidence: 0.4,
            bbox: { x: 0, y: 0, width: 5, height: 5, rotation: 180 as const },
          },
        ],
        confidence: 0.4,
      };
      // Error tal como llega del Worker: su subclase no sobrevive (ADR-049).
      const modelMissing = EngineError.deserialize(
        new OcrModelMissingError(["spa", "eng"], "modelo ausente en reintento").serialize(),
      );
      const dispatch = vi.fn().mockResolvedValueOnce(firstReading).mockRejectedValue(modelMissing);
      const pooledEngine = new OcrEngine(
        { ...createResolvedOcrPool(firstReading), dispatch },
        fakeOrientationPool(180, 1),
      );
      await pooledEngine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");

      const output = await pooledEngine.processPage(createValidOcrPageInput(documentId, 0), ctx);

      expect(dispatch).toHaveBeenCalledTimes(4);
      expect(output.words).toEqual(firstReading.words);
      expect(output.confidence).toBe(0.4);
      expect(ctx.cache.set).toHaveBeenCalledWith(
        `ocr-words:${documentId}:0`,
        firstReading.words,
        expect.any(Number),
      );
      const events = busEmitSpy.mock.calls.map(([, event]) => event);
      expect(events).toEqual([EngineEvents.OCR_PAGE_FINISHED]);
      await pooledEngine.dispose();
    });

    // Casos 45-46 (§13): una región (ADR-065) sigue la cadena sin el paso 4
    // y nunca lleva `unreadableInk`.
    it("region requests do not upscale nor raise unreadableInk", async () => {
      let recognizeCalls = 0;
      const recognize = vi.fn(() => {
        recognizeCalls += 1;
        // Todas las lecturas son débiles — si el paso 4 corriera, agregaría
        // una quinta llamada con `upscale` en el payload.
        return Promise.resolve({
          jobId: `j${recognizeCalls}`,
          data: mockRecognizeData([
            { text: "y", confidence: 40, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
          ]),
        });
      });
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
      );
      const pooledEngine = new OcrEngine(undefined, fakeOrientationPool(0, 1));
      await pooledEngine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");

      const region = { x: 0, y: 0, width: 50, height: 40 };
      const requests = [createValidOcrPageRequest("doc-190-region", 0, { region, dpi: 150 })];
      await pooledEngine.processSession(requests, createImageProducer(), ctx);

      // Paso 1 (0°) + paso 3 (90°, 180°, 270°) = 4. Sin paso 4: nunca hay un
      // quinto despacho con `upscale`, aunque el dpi (150) sea < 300.
      expect(recognize).toHaveBeenCalledTimes(4);
      const recognizePayloads = recognize.mock.calls;
      expect(recognizePayloads.length).toBe(4);
      const finished = busEmitSpy.mock.calls.find(
        ([channel, event]) =>
          channel === EventChannel.Ocr && event === EngineEvents.OCR_PAGE_FINISHED,
      );
      expect(
        (finished?.[2] as { readonly unreadableInk?: true } | undefined)?.unreadableInk,
      ).toBeUndefined();
      await pooledEngine.dispose();
    });
  });
});
