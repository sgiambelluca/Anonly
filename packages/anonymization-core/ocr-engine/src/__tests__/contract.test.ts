import {
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EventChannel,
  type EngineContext,
  type Unsubscribe,
} from "@anonly/shared";
import { createWorker } from "tesseract.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Por el hoisting de Vitest, cada archivo de test declara su propio vi.mock
// (ver comentario en fixtures/test-helpers.ts).
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

import {
  createEngineContext,
  createTrackingOcrPool,
  createValidOcrPageInput,
  mockEmptyRecognizeData,
  mockRecognizeData,
  mockTesseractWorker,
} from "./fixtures/test-helpers.js";

describe("OcrEngine — contract tests", () => {
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

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Ocr);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("processPage() before init() throws EngineNotInitializedError", async () => {
    const input = createValidOcrPageInput("doc-1", 0);
    await expect(engine.processPage(input, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("processPages() before init() throws EngineNotInitializedError", async () => {
    const inputs = [createValidOcrPageInput("doc-1", 0)];
    await expect(engine.processPages(inputs, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("emits OCR_STARTED before pages", async () => {
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Hola", confidence: 90, bbox: { x0: 10, y0: 10, x1: 60, y1: 30 } },
        ]),
      ),
    );

    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const inputs = [
      createValidOcrPageInput("doc-started", 0),
      createValidOcrPageInput("doc-started", 1),
    ];
    await engine.processPages(inputs, ctx);

    const startedIndex = busEmitSpy.mock.calls.findIndex(
      (call) => call[1] === EngineEvents.OCR_STARTED,
    );
    const firstPageFinishedIndex = busEmitSpy.mock.calls.findIndex(
      (call) => call[1] === EngineEvents.OCR_PAGE_FINISHED,
    );
    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(firstPageFinishedIndex).toBeGreaterThan(startedIndex);
    expect(busEmitSpy).toHaveBeenCalledWith(
      EventChannel.Ocr,
      EngineEvents.OCR_STARTED,
      expect.objectContaining({ documentId: "doc-started", pagesToProcess: [0, 1] }),
    );
  });

  it("emits OCR_PAGE_FINISHED per page", async () => {
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Hola", confidence: 90, bbox: { x0: 10, y0: 10, x1: 60, y1: 30 } },
        ]),
      ),
    );

    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const inputs = [
      createValidOcrPageInput("doc-per-page", 0),
      createValidOcrPageInput("doc-per-page", 1),
      createValidOcrPageInput("doc-per-page", 2),
    ];
    await engine.processPages(inputs, ctx);

    const pageFinishedCalls = busEmitSpy.mock.calls.filter(
      (call) => call[1] === EngineEvents.OCR_PAGE_FINISHED,
    );
    expect(pageFinishedCalls.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(busEmitSpy).toHaveBeenCalledWith(
        EventChannel.Ocr,
        EngineEvents.OCR_PAGE_FINISHED,
        expect.objectContaining({ documentId: "doc-per-page", pageIndex: i }),
      );
    }
  });

  it("emits OCR_FINISHED after all pages", async () => {
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const inputs = [
      createValidOcrPageInput("doc-finished", 0),
      createValidOcrPageInput("doc-finished", 1),
    ];
    await engine.processPages(inputs, ctx);

    const lastCall = busEmitSpy.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(EngineEvents.OCR_FINISHED);
    expect(busEmitSpy).toHaveBeenCalledWith(
      EventChannel.Ocr,
      EngineEvents.OCR_FINISHED,
      expect.objectContaining({ documentId: "doc-finished" }),
    );
  });

  it('word.source === "ocr"', async () => {
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Palabra", confidence: 88, bbox: { x0: 5, y0: 5, x1: 55, y1: 25 } },
        ]),
      ),
    );

    await engine.init(ctx);
    const output = await engine.processPage(createValidOcrPageInput("doc-source", 0), ctx);

    expect(output.words.length).toBeGreaterThan(0);
    for (const word of output.words) {
      expect(word.source).toBe("ocr");
    }
  });

  it("deposits words in ctx.cache", async () => {
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Cache", confidence: 91, bbox: { x0: 1, y0: 1, x1: 40, y1: 20 } },
        ]),
      ),
    );

    await engine.init(ctx);
    const cacheSetSpy = vi.spyOn(ctx.cache, "set");
    const output = await engine.processPage(createValidOcrPageInput("doc-cache", 3), ctx);

    expect(cacheSetSpy).toHaveBeenCalledWith("ocr-words:doc-cache:3", output.words);
  });

  it("engine never subscribes to the bus (ADR-014)", async () => {
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

    // Spies nombrados (no referencias de método del bus) para evitar
    // @typescript-eslint/unbound-method en los asserts.
    const onSpy = vi.fn((): Unsubscribe => vi.fn());
    const onceSpy = vi.fn((): Unsubscribe => vi.fn());
    const busCtx = createEngineContext({
      bus: {
        on: onSpy,
        once: onceSpy,
        off: vi.fn(),
        emit: vi.fn(),
        emitAsync: vi.fn(() => Promise.resolve()),
      },
    });

    await engine.init(busCtx);
    await engine.processPage(createValidOcrPageInput("doc-no-sub", 0), busCtx);
    await engine.processPages([createValidOcrPageInput("doc-no-sub-2", 0)], busCtx);

    expect(onSpy).not.toHaveBeenCalled();
    expect(onceSpy).not.toHaveBeenCalled();
  });

  it("dispose() terminates BOTH Tesseract workers (ADR-119 §1)", async () => {
    const terminate = vi.fn(() => Promise.resolve());
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(mockEmptyRecognizeData(), { terminate }),
    );

    await engine.init(ctx);
    await engine.processPage(createValidOcrPageInput("doc-dispose", 0), ctx);
    await engine.dispose();

    // Son dos instancias: la de reconocimiento y la de OSD. Dejar viva la de
    // OSD son ~99 MB que nadie libera.
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(engine["disposed"]).toBe(true);
    expect(engine["initialized"]).toBe(false);
  });

  it("processPages returns outputs in the same order as inputs", async () => {
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

    await engine.init(ctx);
    const inputs = [
      createValidOcrPageInput("doc-order", 2),
      createValidOcrPageInput("doc-order", 0),
      createValidOcrPageInput("doc-order", 1),
    ];
    const outputs = await engine.processPages(inputs, ctx);

    expect(outputs.map((o) => o.pageIndex)).toEqual([2, 0, 1]);
  });

  // ─── ADR-045 §2/§4/§5 — puerto interno OcrJobPool ───

  it("dispatch uses maxRetriesOverride 0 (pool never retries ocr-page)", async () => {
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(mockEmptyRecognizeData()));

    const pool = createTrackingOcrPool();
    const pooledEngine = new OcrEngine(pool);
    await pooledEngine.init(ctx);
    await pooledEngine.processPage(createValidOcrPageInput("doc-max-retries-override", 0), ctx);

    expect(pool.calls.length).toBe(1);
    expect(pool.calls[0]!.maxRetriesOverride).toBe(0);

    await pooledEngine.dispose();
  });

  it("cache set happens before OCR_PAGE_FINISHED on host", async () => {
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Hola", confidence: 90, bbox: { x0: 0, y0: 0, x1: 40, y1: 20 } },
        ]),
      ),
    );
    await engine.init(ctx);

    const cacheSetSpy = vi.spyOn(ctx.cache, "set");
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");

    await engine.processPage(createValidOcrPageInput("doc-order", 0), ctx);

    const cacheOrder = cacheSetSpy.mock.invocationCallOrder[0]!;
    const pageFinishedCallIndex = busEmitSpy.mock.calls.findIndex(
      (call) => call[1] === EngineEvents.OCR_PAGE_FINISHED,
    );
    const emitOrder = busEmitSpy.mock.invocationCallOrder[pageFinishedCallIndex]!;

    expect(cacheOrder).toBeLessThan(emitOrder);
  });

  it("events identical with and without pool (fallback ADR-035)", async () => {
    const recognizeData = mockRecognizeData([
      { text: "Parity", confidence: 90, bbox: { x0: 0, y0: 0, x1: 40, y1: 20 } },
    ]);

    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(recognizeData));
    await engine.init(ctx);
    const busEmitSpyA = vi.spyOn(ctx.bus, "emit");
    await engine.processPage(createValidOcrPageInput("doc-parity", 0), ctx);
    const eventsA = busEmitSpyA.mock.calls.map((call) => call[1]);

    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker(recognizeData));
    const pool = createTrackingOcrPool();
    const pooledEngine = new OcrEngine(pool);
    const ctxB = createEngineContext();
    await pooledEngine.init(ctxB);
    const busEmitSpyB = vi.spyOn(ctxB.bus, "emit");
    await pooledEngine.processPage(createValidOcrPageInput("doc-parity", 0), ctxB);
    const eventsB = busEmitSpyB.mock.calls.map((call) => call[1]);

    expect(eventsB).toEqual(eventsA);
    await pooledEngine.dispose();
  });
});
