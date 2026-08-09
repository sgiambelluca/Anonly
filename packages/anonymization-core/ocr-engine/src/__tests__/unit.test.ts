import {
  CancelledError,
  EngineEvents,
  EventChannel,
  type EngineContext,
  type Word,
} from "@anonly/shared";
import { createWorker } from "tesseract.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));

import { OcrEngine } from "../ocr.engine.js";
import { OcrModelMissingError, OcrPageFailedError } from "../ocr.errors.js";

import {
  createEngineContext,
  createMockConfig,
  createResolvedOcrPool,
  createValidOcrPageInput,
  mockEmptyRecognizeData,
  mockRecognizeData,
  mockTesseractWorker,
  setStubCanvasContextAvailable,
} from "./fixtures/test-helpers.js";

describe("OcrEngine — unit tests", () => {
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

  describe("Word sorting (reading order)", () => {
    it("words sorted by bbox y then x", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "Bottom", confidence: 90, bbox: { x0: 10, y0: 60, x1: 60, y1: 80 } },
            { text: "Top", confidence: 90, bbox: { x0: 10, y0: 10, x1: 40, y1: 30 } },
            { text: "TopRight", confidence: 90, bbox: { x0: 100, y0: 10, x1: 150, y1: 30 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-sort", 0), ctx);

      expect(output.words.map((w) => w.text)).toEqual(["Top", "TopRight", "Bottom"]);
    });

    it("on same line (y within tolerance), sorts by x asc", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "ZWord", confidence: 90, bbox: { x0: 200, y0: 10, x1: 240, y1: 30 } },
            { text: "AWord", confidence: 90, bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } },
            { text: "BWord", confidence: 90, bbox: { x0: 100, y0: 11, x1: 140, y1: 31 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-same-y", 0), ctx);

      expect(output.words.map((w) => w.text)).toEqual(["AWord", "BWord", "ZWord"]);
    });
  });

  describe("Confidence range", () => {
    it("confidence in [0,1]", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData(
            [
              { text: "A", confidence: 100, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
              { text: "B", confidence: 0, bbox: { x0: 20, y0: 0, x1: 30, y1: 10 } },
            ],
            57,
          ),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-confidence", 0), ctx);

      expect(output.confidence).toBeGreaterThanOrEqual(0);
      expect(output.confidence).toBeLessThanOrEqual(1);
      expect(output.confidence).toBeCloseTo(0.57, 5);
      for (const word of output.words) {
        expect(word.confidence).toBeGreaterThanOrEqual(0);
        expect(word.confidence).toBeLessThanOrEqual(1);
      }
      expect(output.words[0]!.confidence).toBeCloseTo(1, 5);
      expect(output.words[1]!.confidence).toBeCloseTo(0, 5);
    });
  });

  describe("NFC normalization (mismo criterio que pdf-engine, ADR-020 §2)", () => {
    it("normalizes word text to NFC", async () => {
      // NFD = "P" + "e" + combining acute accent (U+0301) + "rez" (6 chars).
      // NFC = "P" + "é" precompuesta (U+00E9) + "rez" (5 chars).
      const nfdPerez = "Pérez";
      const nfcPerez = "Pérez";
      expect(nfdPerez.length).toBe(6);
      expect(nfcPerez.length).toBe(5);
      expect(nfdPerez).not.toBe(nfcPerez);
      expect(nfdPerez.normalize("NFC")).toBe(nfcPerez);

      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: nfdPerez, confidence: 90, bbox: { x0: 0, y0: 0, x1: 40, y1: 20 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-nfc", 0), ctx);

      expect(output.words[0]!.text).toBe(nfcPerez);
      expect(output.words[0]!.text.length).toBe(5);
    });
  });

  describe("Bbox conversion (tesseract x0/y0/x1/y1 -> BoundingBox x/y/width/height)", () => {
    it("converts tesseract bbox to BoundingBox", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "Box", confidence: 80, bbox: { x0: 10, y0: 20, x1: 50, y1: 45 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-bbox", 0), ctx);

      // ADR-064 §1: la salida va en PUNTOS. A 300 DPI el factor es 72/300 = 0.24.
      expect(output.words[0]!.bbox).toEqual({ x: 2.4, y: 4.8, width: 9.6, height: 6 });
    });
  });

  describe("Point conversion (ADR-064)", () => {
    it("word bboxes are converted from raster pixels to page points", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "Cuadro", confidence: 90, bbox: { x0: 0, y0: 0, x1: 417, y1: 417 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-pt", 0, { dpi: 300 }),
        ctx,
      );

      const bbox = output.words[0]!.bbox;
      expect(bbox.x).toBeCloseTo(0, 5);
      expect(bbox.y).toBeCloseTo(0, 5);
      expect(bbox.width).toBeCloseTo(100.08, 5);
      expect(bbox.height).toBeCloseTo(100.08, 5);
    });

    it("dpi 72 makes the conversion an identity", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "Igual", confidence: 90, bbox: { x0: 10, y0: 20, x1: 50, y1: 45 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-72", 0, { dpi: 72 }),
        ctx,
      );

      expect(output.words[0]!.bbox).toEqual({ x: 10, y: 20, width: 40, height: 25 });
    });

    it("reading order is unchanged by the point conversion", async () => {
      // ADR-064 §2: 3px de separación en y. Ordenando en píxeles (tolerancia
      // 1px) son líneas distintas → gana "Arriba". Si la conversión corriera
      // ANTES del sort, 3px serían 0.72pt: caerían dentro de la tolerancia y
      // se ordenarían por x, devolviendo ["Abajo", "Arriba"].
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "Abajo", confidence: 90, bbox: { x0: 10, y0: 13, x1: 60, y1: 33 } },
            { text: "Arriba", confidence: 90, bbox: { x0: 200, y0: 10, x1: 250, y1: 30 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-order", 0, { dpi: 300 }),
        ctx,
      );

      expect(output.words.map((w) => w.text)).toEqual(["Arriba", "Abajo"]);
    });
  });

  describe("Word metadata", () => {
    it("word.pageIndex matches input.pageIndex", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(
          mockRecognizeData([
            { text: "P", confidence: 80, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
          ]),
        ),
      );

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-page-idx", 5), ctx);

      expect(output.words[0]!.pageIndex).toBe(5);
    });

    it("durationMs is a non-negative number", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const output = await engine.processPage(createValidOcrPageInput("doc-duration", 0), ctx);

      expect(output.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Cache key format", () => {
    it("cache key is ocr-words:<documentId>:<pageIndex>", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const cacheSetSpy = vi.spyOn(ctx.cache, "set");
      await engine.processPage(createValidOcrPageInput("doc-key", 7), ctx);

      expect(cacheSetSpy).toHaveBeenCalledWith("ocr-words:doc-key:7", expect.any(Array));
    });
  });

  describe("Language validation", () => {
    it("accepts a page whose languages are a subset of the loaded model", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx); // ctx.config.ocr.languages = ["spa", "eng"]
      const input = createValidOcrPageInput("doc-lang-ok", 0, { languages: ["spa"] });

      await expect(engine.processPage(input, ctx)).resolves.toBeDefined();
    });
  });

  describe("modelLoading / modelDownloaded flags (ADR-021 §3)", () => {
    it("OCR_STARTED includes modelLoading=true on first run, OCR_FINISHED includes modelDownloaded=true", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.processPages([createValidOcrPageInput("doc-model-first", 0)], ctx);

      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_STARTED,
        expect.objectContaining({ modelLoading: true }),
      );
      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_FINISHED,
        expect.objectContaining({ modelDownloaded: true }),
      );
    });

    it("OCR_STARTED omits modelLoading once the worker is already loaded", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      await engine.processPages([createValidOcrPageInput("doc-model-warm", 0)], ctx);

      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.processPages([createValidOcrPageInput("doc-model-warm", 1)], ctx);

      expect(busEmitSpy).not.toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_STARTED,
        expect.objectContaining({ modelLoading: true }),
      );
      expect(busEmitSpy).not.toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_FINISHED,
        expect.objectContaining({ modelDownloaded: true }),
      );
    });
  });

  describe("processPages error resilience (OCR_Engine.md §13 caso 6)", () => {
    it("continues processing remaining pages after one page fails", async () => {
      const recognize = vi
        .fn()
        .mockRejectedValueOnce(new Error("tesseract crashed"))
        .mockResolvedValue({ jobId: "job", data: mockEmptyRecognizeData() });
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
      );

      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const inputs = [
        createValidOcrPageInput("doc-resilient", 0),
        createValidOcrPageInput("doc-resilient", 1),
      ];
      const outputs = await engine.processPages(inputs, ctx);

      expect(outputs.length).toBe(1);
      expect(outputs[0]!.pageIndex).toBe(1);
      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_PAGE_FAILED,
        expect.objectContaining({ documentId: "doc-resilient", pageIndex: 0 }),
      );
      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_FINISHED,
        expect.objectContaining({ documentId: "doc-resilient" }),
      );
    });
  });

  describe("Low confidence warning threshold", () => {
    it("does not warn for a genuinely empty page (confidence=0, no words)", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const loggerWarnSpy = vi.spyOn(ctx.logger, "warn");
      await engine.processPage(createValidOcrPageInput("doc-empty-no-warn", 0), ctx);

      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe("Confidence edge values", () => {
    it("clamps NaN confidence to 0", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker({
          confidence: Number.NaN,
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    {
                      words: [
                        {
                          text: "x",
                          confidence: Number.NaN,
                          bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );

      await engine.init(ctx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-nan-confidence", 0),
        ctx,
      );

      expect(output.confidence).toBe(0);
      expect(output.words[0]!.confidence).toBe(0);
    });
  });

  describe("Malformed tesseract.js response resilience", () => {
    it("ignores a data payload that is not an object", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker("not-an-object"));

      await engine.init(ctx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-malformed-data", 0),
        ctx,
      );

      expect(output.words).toEqual([]);
      expect(output.confidence).toBe(0);
    });

    it("silently drops blocks/paragraphs/lines/words entries with the wrong shape", async () => {
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker({
          confidence: "not-a-number",
          blocks: [
            "not-a-block",
            { paragraphs: "not-an-array" },
            { paragraphs: [{ lines: "not-an-array" }] },
            { paragraphs: [{ lines: [{ words: "not-an-array" }] }] },
            {
              paragraphs: [
                {
                  lines: [
                    {
                      words: [
                        "not-a-word",
                        { text: 42, confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
                        { text: "ok", confidence: "high", bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
                        { text: "ok2", confidence: 90, bbox: "not-a-bbox" },
                        { text: "ok3", confidence: 90, bbox: { x0: "0", y0: 0, x1: 10, y1: 10 } },
                        { text: "good", confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );

      await engine.init(ctx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-malformed-words", 0),
        ctx,
      );

      expect(output.words.length).toBe(1);
      expect(output.words[0]!.text).toBe("good");
      expect(output.confidence).toBe(0);
    });
  });

  describe("toTesseractImage (conversión a OffscreenCanvas)", () => {
    it("throws OcrPageFailedError when getContext('2d') returns null", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));
      await engine.init(ctx);

      setStubCanvasContextAvailable(false);
      try {
        await expect(
          engine.processPage(createValidOcrPageInput("doc-no-context", 0), ctx),
        ).rejects.toThrow(OcrPageFailedError);
      } finally {
        setStubCanvasContextAvailable(true);
      }
    });
  });

  describe("Fallback de idiomas por defecto", () => {
    it("falls back to default languages when ctx.config.ocr.languages is empty", async () => {
      const emptyLangCtx = createEngineContext({
        config: createMockConfig({ ocr: { languages: [], dpi: 300 } }),
      });
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(emptyLangCtx);
      const output = await engine.processPage(
        createValidOcrPageInput("doc-default-lang", 0, { languages: ["spa"] }),
        emptyLangCtx,
      );

      expect(output).toBeDefined();
      expect(vi.mocked(createWorker)).toHaveBeenCalledWith(
        ["spa", "eng"],
        undefined,
        expect.anything(),
      );
    });
  });

  describe("Clasificación de errores no-Error", () => {
    it("wraps a non-Error rejection from recognize() into OcrPageFailedError", async () => {
      // El propio test verifica la resiliencia del engine ante un rechazo
      // que NO es un Error (toPageFailure hace `err instanceof Error ?
      // err.message : String(err)`); el rechazo con string es intencional.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      const recognize = vi.fn(() => Promise.reject("plain string failure"));
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
      );

      await engine.init(ctx);
      await expect(
        engine.processPage(createValidOcrPageInput("doc-non-error-fail", 0), ctx),
      ).rejects.toThrow(OcrPageFailedError);
    });

    it("wraps a non-Error rejection from createWorker() into OcrModelMissingError", async () => {
      vi.mocked(createWorker).mockRejectedValue("plain string rejection");

      await engine.init(ctx);
      await expect(
        engine.processPage(createValidOcrPageInput("doc-non-error-model", 0), ctx),
      ).rejects.toThrow(OcrModelMissingError);
    });
  });

  describe("dispose() resiliente a fallas de terminate()", () => {
    it("completes even if worker.terminate() rejects", async () => {
      const terminate = vi.fn(() => Promise.reject(new Error("terminate failed")));
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockEmptyRecognizeData(), { terminate }),
      );

      await engine.init(ctx);
      await engine.processPage(createValidOcrPageInput("doc-dispose-fail", 0), ctx);

      await expect(engine.dispose()).resolves.toBeUndefined();
      expect(engine["disposed"]).toBe(true);
    });
  });

  describe("processPages y errores no recuperables", () => {
    it("rethrows OcrModelMissingError instead of continuing with remaining pages", async () => {
      vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

      await engine.init(ctx);
      const inputs = [
        createValidOcrPageInput("doc-lang-abort", 0, { languages: ["fra"] }),
        createValidOcrPageInput("doc-lang-abort", 1),
      ];

      await expect(engine.processPages(inputs, ctx)).rejects.toThrow(OcrModelMissingError);
    });
  });

  describe("Cancelación mientras un recognize() está en vuelo", () => {
    it("throws CancelledError when aborted while a recognize() call is in flight", async () => {
      // recognize() rápido para el precalentado del worker; se reemplaza por
      // uno que nunca resuelve recién para el segundo processPage (el que
      // se cancela en vuelo).
      const fastRecognize = vi.fn(() =>
        Promise.resolve({ jobId: "job", data: mockEmptyRecognizeData() }),
      );
      const worker = mockTesseractWorker(mockEmptyRecognizeData(), { recognize: fastRecognize });
      vi.mocked(createWorker).mockResolvedValue(worker);

      const abortController = new AbortController();
      const abortedCtx = createEngineContext({ abortSignal: abortController.signal });
      await engine.init(abortedCtx);
      // Precalienta el worker con recognize rápido.
      await engine.processPage(createValidOcrPageInput("doc-warm", 0), abortedCtx);

      // A partir de acá, recognize() nunca resuelve: el único await
      // pendiente dentro del próximo processPage queda en el Promise.race
      // de recognizeWithTimeout, listo para que gane el abortSignal.
      // Promise<never> (no resuelve nunca) es asignable a cualquier
      // Promise<T> esperado por la firma real de recognize().
      worker.recognize = vi.fn((): Promise<never> => new Promise<never>(() => {}));

      const resultPromise = engine.processPage(
        createValidOcrPageInput("doc-abort-inflight", 1),
        abortedCtx,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      abortController.abort();

      await expect(resultPromise).rejects.toThrow(CancelledError);
    });
  });

  // ─── ADR-055 §5 — tests de sobre, obligatorios ───
  //
  // A diferencia de `createTrackingOcrPool`/los pools ad-hoc de arriba (que
  // delegan en `params.run()`, o sea el camino in-process), `createResolvedOcrPool`
  // IGNORA `run()` y resuelve directo con el valor dado — es el único fake de
  // este paquete que cruza de verdad el sobre `COMPLETED.result` (ADR-055
  // Contexto §2). Sin él, ningún test ejercita `decodeKernelOcrResult`.
  describe("Sobre del dispatch (ADR-055)", () => {
    const remoteWord: Word = {
      text: "Remoto",
      bbox: { x: 1, y: 2, width: 30, height: 10 },
      pageIndex: 0,
      confidence: 0.93,
      source: "ocr",
    };

    it("decodes the bare COMPLETED.result posted by worker/entry.ts (no envelope, ADR-055 §2)", async () => {
      // worker/entry.ts:96 postea `result` pelado (el KernelOcrResult tal
      // cual, sin envolver en un sobre adicional) — a diferencia de NER, que
      // envuelve en `{ spans }`. Este fake reproduce exactamente eso.
      const pool = createResolvedOcrPool({ words: [remoteWord], confidence: 0.93 });
      const pooledEngine = new OcrEngine(pool);
      await pooledEngine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");

      const output = await pooledEngine.processPage(
        createValidOcrPageInput("doc-envelope-decode", 0),
        ctx,
      );

      expect(output.words).toEqual([remoteWord]);
      expect(output.confidence).toBe(0.93);
      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_PAGE_FINISHED,
        expect.objectContaining({ documentId: "doc-envelope-decode", pageIndex: 0, wordCount: 1 }),
      );

      await pooledEngine.dispose();
    });

    it("decodes the identical in-process shape (parity: OCR has no envelope, ADR-055 §2)", async () => {
      // En NER el sobre remoto (`{ spans }`) y el array pelado in-process son
      // DOS formas distintas que el decoder tiene que aceptar. En OCR no hay
      // tal distinción: `kernelRecognize` (invocado directo por
      // IMMEDIATE_POOL cuando no hay pool real) y `worker/entry.ts` (cuando
      // sí la hay) producen la MISMA forma `KernelOcrResult`. Este test usa
      // el mismo fake que ignora `run()` con un valor con la forma
      // "in-process" — que es bit-a-bit la misma que la del test de arriba —
      // para demostrar explícitamente esa paridad: el decoder no necesita
      // (ni tiene) una rama especial para un segundo caso.
      const inProcessWord: Word = {
        text: "InProcess",
        bbox: { x: 5, y: 6, width: 20, height: 8 },
        pageIndex: 0,
        confidence: 0.42,
        source: "ocr",
      };
      const pool = createResolvedOcrPool({ words: [inProcessWord], confidence: 0.42 });
      const pooledEngine = new OcrEngine(pool);
      await pooledEngine.init(ctx);

      const output = await pooledEngine.processPage(
        createValidOcrPageInput("doc-envelope-parity", 0),
        ctx,
      );

      expect(output.words).toEqual([inProcessWord]);
      expect(output.confidence).toBe(0.42);

      await pooledEngine.dispose();
    });
  });
});
