import {
  CancelledError,
  EngineEvents,
  EventChannel,
  type EngineContext,
  type Word,
} from "@anonly/shared";
import { createWorker, OEM } from "tesseract.js";
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
import { OcrModelMissingError, OcrPageFailedError } from "../ocr.errors.js";

import {
  createEngineContext,
  createMockConfig,
  createResolvedOcrPool,
  createImageData,
  createValidOcrPageInput,
  mockDetectData,
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
      /*
       * ADR-119 §1: el worker de reconocimiento carga SOLO los idiomas de la
       * config. `osd` se mudó a su propio worker porque `detect()` necesita el
       * OEM legacy, y ese OEM no puede convivir con el reconocimiento: el
       * `traineddata` pineado es `tessdata_best`, sin componentes legacy.
       */
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

  // ─── ADR-090: orientación del escaneo ───

  describe("orientación del escaneo (ADR-090 §2/§3/§4)", () => {
    /** Una palabra sola, para poder seguir su caja a través de la rotación. */
    const UNA_PALABRA = [
      { text: "Perez", confidence: 90, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } },
    ];

    /** Raster de 100 × 40, el mismo que arma `createValidOcrPageInput`. */
    function inputConRaster(documentId: string): ReturnType<typeof createValidOcrPageInput> {
      return { ...createValidOcrPageInput(documentId, 0), imageData: createImageData(100, 40) };
    }

    it("tells Tesseract the dpi instead of letting it estimate, and only when it changes", async () => {
      // Tipado: sin el parámetro declarado, `mock.calls` es una tupla vacía y
      // no se puede leer el objeto que se pasó.
      const setParameters = vi.fn((_params: Record<string, unknown>) => Promise.resolve());
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(UNA_PALABRA), { setParameters }),
      );

      await engine.init(ctx);
      await engine.processPage(inputConRaster("doc-dpi-1"), ctx);
      await engine.processPage(inputConRaster("doc-dpi-2"), ctx);

      // El dpi de `createMockConfig` no cambia entre páginas: una sola llamada.
      // Se filtra por clave porque ADR-112 agregó un `setParameters` propio
      // para el modo de segmentación; contar las llamadas totales ataría este
      // test a un parámetro que no es el suyo.
      const dpiCalls = setParameters.mock.calls.filter(
        ([params]) => params["user_defined_dpi"] !== undefined,
      );
      expect(dpiCalls).toHaveLength(1);
      expect(setParameters).toHaveBeenCalledWith({
        user_defined_dpi: String(ctx.config.ocr.dpi),
      });
    });

    it("does not rotate anything when the page is upright (no regression)", async () => {
      const recognize = vi.fn(() =>
        Promise.resolve({ jobId: "j", data: mockRecognizeData(UNA_PALABRA) }),
      );
      const detect = vi.fn(() => Promise.resolve(mockDetectData(0)));
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(UNA_PALABRA), { recognize, detect }),
      );

      await engine.init(ctx);
      const output = await engine.processPage(inputConRaster("doc-derecha"), ctx);

      expect(detect).toHaveBeenCalledTimes(1);
      // Sin `rotation`: ausente ≡ 0 (`Contracts.md` §5), así que un escaneo
      // derecho produce exactamente lo de antes del ADR.
      expect(output.words[0]?.bbox.rotation).toBeUndefined();
      const factor = 72 / ctx.config.ocr.dpi;
      expect(output.words[0]?.bbox.x).toBeCloseTo(10 * factor, 6);
      expect(output.words[0]?.bbox.y).toBeCloseTo(20 * factor, 6);
    });

    it("recognizes the uprighted raster and brings the boxes back, with rotation", async () => {
      // El raster original es 100 × 40. Con orientación 90 se endereza a
      // 40 × 100, así que la caja que reporta Tesseract vive EN ESE espacio y
      // tiene que caber ahí: (5, 20) de 20 × 40. La inversa la devuelve al
      // espacio original — x = y₀', y = H − (x₀' + ancho') — con el ancho y el
      // alto intercambiados.
      const detect = vi.fn(() => Promise.resolve(mockDetectData(90)));
      const enderezada = [
        { text: "Perez", confidence: 90, bbox: { x0: 5, y0: 20, x1: 25, y1: 60 } },
      ];
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(enderezada), { detect }),
      );

      await engine.init(ctx);
      const output = await engine.processPage(inputConRaster("doc-rotada"), ctx);

      const factor = 72 / ctx.config.ocr.dpi;
      const word = output.words[0];
      expect(word?.bbox.rotation).toBe(90);
      expect(word?.bbox.x).toBeCloseTo(20 * factor, 6); // y₀'
      expect(word?.bbox.y).toBeCloseTo((40 - (5 + 20)) * factor, 6); // H − (x₀' + ancho')
      expect(word?.bbox.width).toBeCloseTo(40 * factor, 6); // el alto', intercambiado
      expect(word?.bbox.height).toBeCloseTo(20 * factor, 6); // el ancho', intercambiado
      // La caja cae DENTRO de la página, que es lo que un mapeo mal hecho
      // rompe primero.
      expect(word?.bbox.x).toBeGreaterThanOrEqual(0);
      expect(word?.bbox.y).toBeGreaterThanOrEqual(0);
    });

    it("falls back to the pre-ADR path when detect fails, returns null or is unsure", async () => {
      const casos: ReadonlyArray<ReturnType<typeof vi.fn>> = [
        vi.fn(() => Promise.reject(new Error("osd no cargó"))),
        vi.fn(() => Promise.resolve(mockDetectData(null))),
        vi.fn(() => Promise.resolve(mockDetectData(90, 0.2))), // debajo del piso
      ];

      for (const detect of casos) {
        vi.mocked(createWorker).mockResolvedValue(
          mockTesseractWorker(mockRecognizeData(UNA_PALABRA), { detect }),
        );
        const engineLocal = new OcrEngine();
        await engineLocal.init(ctx);
        const output = await engineLocal.processPage(inputConRaster("doc-osd-falla"), ctx);
        await engineLocal.dispose();

        expect(output.words[0]?.bbox.rotation).toBeUndefined();
        expect(output.words[0]?.bbox.x).toBeCloseTo((10 * 72) / ctx.config.ocr.dpi, 6);
      }
    });
  });

  // ─── ADR-119: la orientación se detecta con el motor que la sabe leer ───

  describe("worker de OSD (ADR-119 §1/§2/§3)", () => {
    const UNA_PALABRA = [
      { text: "Perez", confidence: 90, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } },
    ];
    function inputConRaster(documentId: string): ReturnType<typeof createValidOcrPageInput> {
      return { ...createValidOcrPageInput(documentId, 0), imageData: createImageData(100, 40) };
    }

    it("the OSD worker uses the legacy OCR engine mode", async () => {
      /*
       * ES la línea que estaba mal. Con el OEM por default —LSTM— `detect()`
       * no tira pero devuelve `0 / 0` SIEMPRE, el piso de confianza lo
       * descarta y el kernel no rota nunca: medido sobre dos documentos y
       * cuatro orientaciones cada uno. `legacyCore: true` solo, que es lo que
       * dedujo ADR-090 §1, no alcanza.
       */
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(UNA_PALABRA)),
      );

      await engine.init(ctx);
      await engine.processPage(inputConRaster("doc-osd-oem"), ctx);

      expect(vi.mocked(createWorker)).toHaveBeenCalledWith(
        ["osd"],
        OEM.TESSERACT_ONLY,
        expect.objectContaining({ legacyCore: true }),
      );
      // Y el de reconocimiento NO lleva `osd` ni pide el core legacy: con el
      // OEM legacy los idiomas no cargarían (`tessdata_best` es solo LSTM).
      expect(vi.mocked(createWorker)).toHaveBeenCalledWith(
        ["spa", "eng"],
        undefined,
        expect.not.objectContaining({ legacyCore: true }),
      );
    });

    it("detects orientation on a half-scale raster (ADR-119 §2)", async () => {
      /*
       * OSD solo elige entre cuatro orientaciones, no lee. A media escala
       * acierta las cuatro con confianza 12-16 y tarda 290 ms en vez de 690 —
       * y eso es lo que hace que arreglar OSD no cueste tiempo.
       */
      const detect = vi.fn(() => Promise.resolve(mockDetectData(0)));
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(UNA_PALABRA), { detect }),
      );

      await engine.init(ctx);
      await engine.processPage(inputConRaster("doc-osd-escala"), ctx);

      expect(detect).toHaveBeenCalledTimes(1);
      const recibido = detect.mock.calls[0]?.[0] as { width: number; height: number };
      // el raster es 100 × 40
      expect(recibido.width).toBe(50);
      expect(recibido.height).toBe(20);
    });

    it("a failing OSD worker throws instead of pretending every page is upright", async () => {
      /*
       * ADR-119 §3: el resto de las fallas de este camino degradan a `0`, y
       * está bien. Que la detección no esté DISPONIBLE es distinto de "esta
       * página está derecha", y confundir las dos es exactamente lo que dejó a
       * ADR-090 sin funcionar sin que nadie se enterara.
       */
      vi.mocked(createWorker)
        .mockResolvedValueOnce(mockTesseractWorker(mockRecognizeData(UNA_PALABRA)))
        .mockRejectedValueOnce(new Error("osd.traineddata no está"));

      await engine.init(ctx);
      await expect(engine.processPage(inputConRaster("doc-osd-caido"), ctx)).rejects.toThrow(
        OcrModelMissingError,
      );
    });
  });

  // ─── ADR-112: modo de segmentación de página ───

  describe("modo de segmentación de página (ADR-112 §1)", () => {
    const UNA_PALABRA = [
      { text: "Perez", confidence: 90, bbox: { x0: 10, y0: 20, x1: 50, y1: 40 } },
    ];

    function inputConRaster(documentId: string): ReturnType<typeof createValidOcrPageInput> {
      return { ...createValidOcrPageInput(documentId, 0), imageData: createImageData(100, 40) };
    }

    /** Doble de `setParameters` con el parámetro declarado, para poder leerlo. */
    function spyParameters(): ReturnType<
      typeof vi.fn<(params: Record<string, unknown>) => Promise<void>>
    > {
      return vi.fn((_params: Record<string, unknown>) => Promise.resolve());
    }

    /** Las llamadas a `setParameters` que fijan el modo, no las del dpi. */
    function pageSegCalls(setParameters: ReturnType<typeof spyParameters>): unknown[] {
      return setParameters.mock.calls
        .map(([params]) => params["tessedit_pageseg_mode"])
        .filter((value) => value !== undefined);
    }

    it("applies sparse-text segmentation once per worker instance", async () => {
      const setParameters = spyParameters();
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(UNA_PALABRA), { setParameters }),
      );

      await engine.init(ctx);
      await engine.processPage(inputConRaster("doc-psm-1"), ctx);
      await engine.processPage(inputConRaster("doc-psm-2"), ctx);

      // El modo es una constante: se aplica una vez, no una por página.
      expect(pageSegCalls(setParameters)).toEqual(["11"]);
    });

    it("re-applies the mode when the worker is recreated for a different language set", async () => {
      const setParameters = spyParameters();
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(UNA_PALABRA), { setParameters }),
      );

      await engine.init(ctx);
      await engine.processPage(inputConRaster("doc-psm-spa"), ctx);

      // ADR-045 §3: otro set de idiomas recrea la instancia, y una instancia
      // nueva no tiene el modo aplicado.
      const otroCtx = createEngineContext({
        config: createMockConfig({ ocr: { languages: ["eng"], dpi: ctx.config.ocr.dpi } }),
      });
      const otroEngine = new OcrEngine();
      await otroEngine.init(otroCtx);
      await otroEngine.processPage(
        { ...inputConRaster("doc-psm-eng"), languages: ["eng"] },
        otroCtx,
      );
      await otroEngine.dispose();

      expect(pageSegCalls(setParameters)).toEqual(["11", "11"]);
    });

    it("a rejecting setParameters does not fail the page", async () => {
      // Best-effort, mismo criterio que el dpi de ADR-090 §2: sin el modo se
      // reconoce con el default de Tesseract, que es el camino previo al ADR.
      const setParameters = vi.fn(() => Promise.reject(new Error("parámetro desconocido")));
      vi.mocked(createWorker).mockResolvedValue(
        mockTesseractWorker(mockRecognizeData(UNA_PALABRA), { setParameters }),
      );

      await engine.init(ctx);
      const output = await engine.processPage(inputConRaster("doc-psm-rechaza"), ctx);

      expect(output.words).toHaveLength(1);
      expect(output.words[0]?.text).toBe("Perez");
    });

    it("the mode is the tesseract.js PSM enum member, not a hardcoded number", async () => {
      // El doble de `tesseract.js` trae su propio `PSM` (ver el `vi.mock` de
      // arriba). Este test lo contrasta contra el enum REAL de la librería:
      // si tesseract.js renumera `SPARSE_TEXT`, el doble deja de ser fiel y
      // esto falla, en vez de que la suite siga verde con el número viejo.
      const real: unknown = await vi.importActual("tesseract.js");
      const psm = (real as { PSM?: Record<string, unknown> }).PSM;
      expect(psm?.["SPARSE_TEXT"]).toBe("11");
    });
  });
});
