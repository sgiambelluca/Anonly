import {
  CancelledError,
  EngineDisposedError,
  EngineError,
  EngineEvents,
  EventChannel,
  InvalidInputError,
  type EngineContext,
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

import {
  createEngineContext,
  createImageData,
  createResolvedOcrPool,
  createValidOcrPageInput,
  mockEmptyRecognizeData,
  mockRecognizeData,
  mockTesseractWorker,
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
  // tratamiento que ADR-020 §9 aplicó al buffer del PDF Engine.
  describe("Caso 4: imageData ya transferido", () => {
    it("throws on already-transferred imageData", async () => {
      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-transferred", 0, {
        imageData: createImageData(0, 0),
      });

      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError when width is 0", async () => {
      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-zero-width", 0, {
        imageData: createImageData(0, 50),
      });
      await expect(engine.processPage(input, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError when height is 0", async () => {
      await engine.init(ctx);
      const input = createValidOcrPageInput("doc-zero-height", 0, {
        imageData: createImageData(50, 0),
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

  // ADR-045 §2: cualquier timeout que emerja del despacho (propio o del
  // pool) se normaliza a OcrTimeoutError ANTES de que el loop de retry lo
  // evalúe. Un timeout que cruzó un worker remoto llega deserializado
  // (EngineError.deserialize, Contracts.md §4): misma `code` pero NO
  // `instanceof OcrTimeoutError` — sin la normalización, el loop lo trataría
  // como no-recuperable y la política de reintentos cambiaría de forma según
  // haya pool real o fallback.
  describe("Normalización de timeout en el borde del puerto (ADR-045 §2)", () => {
    it("dispatch timeout normalized to OcrTimeoutError and retried by engine loop", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

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
});
