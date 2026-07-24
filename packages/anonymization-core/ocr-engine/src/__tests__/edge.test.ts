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

vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));

import { OcrEngine } from "../ocr.engine.js";
import { OcrModelMissingError, OcrPageFailedError, OcrTimeoutError } from "../ocr.errors.js";
import type { OcrPageInput } from "../ocr.types.js";

import {
  createEngineContext,
  createImageData,
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
});
