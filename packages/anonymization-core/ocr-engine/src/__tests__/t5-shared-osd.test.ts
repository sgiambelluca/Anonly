import {
  CancelledError,
  EngineError,
  type EngineContext,
  type OcrOrientationPayload,
} from "@anonly/shared";
import { createWorker } from "tesseract.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OcrEngine } from "../ocr.engine.js";
import { OcrModelMissingError, OcrTimeoutError } from "../ocr.errors.js";

import {
  createEncodedPageImage,
  createEngineContext,
  createResolvedOcrPool,
  createValidOcrPageInput,
  createValidOcrPageRequest,
  createImageProducer,
  mockTesseractWorker,
} from "./fixtures/test-helpers.js";

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
  OEM: { TESSERACT_ONLY: 0 },
  PSM: { SPARSE_TEXT: "11" },
}));

interface FakePool {
  readonly dispatch: (params: {
    readonly payload?: unknown;
    readonly run: () => Promise<unknown>;
  }) => Promise<unknown>;
  readonly releaseIdleWorkers: () => void;
}

function contextWithConcurrency(ocrPoolSize: number): EngineContext {
  const base = createEngineContext();
  return createEngineContext({
    config: {
      ...base.config,
      workerPool: { ...base.config.workerPool, ocrPoolSize },
    },
  });
}

function result(): { readonly words: []; readonly confidence: number } {
  return { words: [], confidence: 0 };
}

describe("T-5 shared OSD contract", () => {
  const engines: OcrEngine[] = [];

  afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.dispose()));
  });

  it("shares one OSD across concurrent OCR requests and overlaps detection with recognition", async () => {
    let recognitionStarted = false;
    let overlap = false;
    let orientationCall = 0;
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        orientationCall += 1;
        const delay = orientationCall === 1 ? 0 : 10;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (recognitionStarted) overlap = true;
        return { orientation: 0 };
      },
      releaseIdleWorkers: vi.fn(),
    };
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        recognitionStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        return result();
      },
      releaseIdleWorkers: vi.fn(),
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(2);
    await engine.init(ctx);

    await engine.processSession(
      [createValidOcrPageRequest("shared", 0), createValidOcrPageRequest("shared", 1)],
      createImageProducer(),
      ctx,
    );

    expect(orientationCall).toBe(2);
    expect(overlap).toBe(true);
  });

  it("orients the third request while two recognitions are blocked without producing a fourth", async () => {
    let recognitionInFlight = 0;
    let maxRecognitionInFlight = 0;
    let orientationCalls = 0;
    const queued: Array<{
      readonly resolve: (value: unknown) => void;
      readonly reject: (reason: unknown) => void;
    }> = [];
    const recognitionReleases: Array<() => void> = [];
    const pump = (): void => {
      while (recognitionInFlight < 2) {
        const next = queued.shift();
        if (next === undefined) return;
        recognitionInFlight += 1;
        maxRecognitionInFlight = Math.max(maxRecognitionInFlight, recognitionInFlight);
        recognitionReleases.push(() => {
          recognitionInFlight -= 1;
          next.resolve(result());
          pump();
        });
      }
    };
    const recognitionPool: FakePool = {
      dispatch: (_params): Promise<unknown> =>
        new Promise<unknown>((resolve, reject) => {
          queued.push({ resolve, reject });
          pump();
        }),
      releaseIdleWorkers: vi.fn(),
    };
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        orientationCalls += 1;
        return { orientation: 0 };
      },
      releaseIdleWorkers: vi.fn(),
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(2);
    await engine.init(ctx);
    const requests = [0, 1, 2, 3].map((pageIndex) =>
      createValidOcrPageRequest("lookahead", pageIndex),
    );
    const produce = vi.fn(createImageProducer());
    const session = engine.processSession(requests, produce, ctx);
    await vi.waitFor(() => expect(orientationCalls).toBe(3));
    expect(produce).toHaveBeenCalledTimes(3);
    expect(maxRecognitionInFlight).toBe(2);
    expect(recognitionReleases).toHaveLength(2);
    expect(queued).toHaveLength(1);
    recognitionReleases.shift()?.();
    recognitionReleases.shift()?.();
    await vi.waitFor(() => expect(recognitionReleases).toHaveLength(1));
    recognitionReleases.shift()?.();
    await vi.waitFor(() => expect(orientationCalls).toBe(4));
    expect(produce).toHaveBeenCalledTimes(4);
    await vi.waitFor(() => expect(recognitionReleases).toHaveLength(1));
    recognitionReleases.shift()?.();
    await expect(session).resolves.toHaveLength(4);
  });

  it("preserves low-resource fallback and pre-materialized input behavior", async () => {
    let recognitionInFlight = 0;
    let maxRecognitionInFlight = 0;
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        recognitionInFlight += 1;
        maxRecognitionInFlight = Math.max(maxRecognitionInFlight, recognitionInFlight);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        recognitionInFlight -= 1;
        return result();
      },
      releaseIdleWorkers: vi.fn(),
    };
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => ({ orientation: 0 }),
      releaseIdleWorkers: vi.fn(),
    };
    const injectedEngine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(injectedEngine);
    const baseContext = createEngineContext();
    const lowResourceCtx = createEngineContext({
      config: {
        ...baseContext.config,
        workerPool: { ...baseContext.config.workerPool, ocrPoolSize: 1 },
      },
    });
    await injectedEngine.init(lowResourceCtx);
    await injectedEngine.processSession(
      [createValidOcrPageRequest("low-resource", 0), createValidOcrPageRequest("low-resource", 1)],
      createImageProducer(),
      lowResourceCtx,
    );
    expect(maxRecognitionInFlight).toBe(1);

    const fallbackWorker = mockTesseractWorker({ confidence: 90, blocks: [] });
    vi.mocked(createWorker).mockResolvedValue(fallbackWorker);
    const fallbackEngine = new OcrEngine(undefined, orientationPool);
    engines.push(fallbackEngine);
    const fallbackCtx = contextWithConcurrency(2);
    await fallbackEngine.init(fallbackCtx);
    const outputs = await fallbackEngine.processPages(
      [createValidOcrPageInput("fallback", 0), createValidOcrPageInput("fallback", 1)],
      fallbackCtx,
    );
    expect(outputs.map((output) => output.pageIndex)).toEqual([0, 1]);
  });

  it("keeps lookahead under the decoded image budget through recognition and retries", async () => {
    let recognitionCalls = 0;
    const pendingRecognitions: Array<(value: unknown) => void> = [];
    const timeout = new OcrTimeoutError("budget-retry", 0, 10);
    const recognitionPool: FakePool = {
      dispatch: (): Promise<unknown> => {
        recognitionCalls += 1;
        if (recognitionCalls === 1) {
          return Promise.reject(EngineError.deserialize(timeout.serialize()));
        }
        return new Promise<unknown>((resolve) => pendingRecognitions.push(resolve));
      },
      releaseIdleWorkers: vi.fn(),
    };
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => ({ orientation: 0 }),
      releaseIdleWorkers: vi.fn(),
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const baseContext = createEngineContext();
    const budgetCtx = createEngineContext({
      config: {
        ...baseContext.config,
        workerPool: { ...baseContext.config.workerPool, ocrPoolSize: 2 },
        ocr: { ...baseContext.config.ocr, maxLiveImageBytes: 2 },
      },
    });
    await engine.init(budgetCtx);
    const produce = vi.fn(createImageProducer());
    const session = engine.processSession(
      [0, 1, 2].map((pageIndex) =>
        createValidOcrPageRequest("budget-lookahead", pageIndex, { estimatedBytes: 1 }),
      ),
      produce,
      budgetCtx,
    );

    await vi.waitFor(() => expect(produce).toHaveBeenCalledTimes(2));
    expect(recognitionCalls).toBe(3);
    expect(pendingRecognitions).toHaveLength(2);
    pendingRecognitions.shift()?.(result());
    pendingRecognitions.shift()?.(result());
    await vi.waitFor(() => expect(produce).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(recognitionCalls).toBe(4));
    pendingRecognitions.shift()?.(result());
    await expect(session).resolves.toHaveLength(3);
  });

  it("does not release services while producing and cancels the pending lookahead", async () => {
    const abortController = new AbortController();
    const releaseRecognition = vi.fn();
    const releaseOrientation = vi.fn();
    let finishRecognition!: () => void;
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        await new Promise<void>((resolve) => {
          finishRecognition = resolve;
        });
        return result();
      },
      releaseIdleWorkers: releaseRecognition,
    };
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => ({ orientation: 0 }),
      releaseIdleWorkers: releaseOrientation,
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const baseContext = createEngineContext();
    const ctx = createEngineContext({
      abortSignal: abortController.signal,
      config: {
        ...baseContext.config,
        workerPool: { ...baseContext.config.workerPool, ocrPoolSize: 2 },
        ocr: { ...baseContext.config.ocr, maxLiveImageBytes: 1 },
      },
    });
    await engine.init(ctx);
    const produce = vi.fn(createImageProducer());
    const session = engine.processSession(
      [0, 1, 2].map((pageIndex) =>
        createValidOcrPageRequest("cancel-lookahead", pageIndex, { estimatedBytes: 1 }),
      ),
      produce,
      ctx,
    );
    await vi.waitFor(() => expect(produce).toHaveBeenCalledTimes(1));
    abortController.abort();
    await expect(session).rejects.toBeInstanceOf(CancelledError);
    engine.releaseIdleWorkers();
    expect(releaseRecognition).not.toHaveBeenCalled();
    expect(releaseOrientation).not.toHaveBeenCalled();
    finishRecognition();
    await vi.waitFor(() => expect(produce).toHaveBeenCalledTimes(1));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    engine.releaseIdleWorkers();
    await vi.waitFor(() => expect(releaseRecognition).toHaveBeenCalledTimes(1));
    expect(releaseOrientation).toHaveBeenCalledTimes(1);
  });

  it("keeps one OSD detection in flight while two OCR jobs overlap", async () => {
    let detectInFlight = 0;
    let maxDetectInFlight = 0;
    let recognitionInFlight = 0;
    let recognitionOverlap = false;
    const worker = mockTesseractWorker(
      { confidence: 90, blocks: [] },
      {
        detect: vi.fn(async () => {
          detectInFlight += 1;
          maxDetectInFlight = Math.max(maxDetectInFlight, detectInFlight);
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          detectInFlight -= 1;
          return { data: { orientation_degrees: 0, orientation_confidence: 17 } };
        }),
      },
    );
    vi.mocked(createWorker).mockResolvedValue(worker);
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        recognitionInFlight += 1;
        if (recognitionInFlight > 1) recognitionOverlap = true;
        await new Promise<void>((resolve) => setTimeout(resolve, 15));
        recognitionInFlight -= 1;
        return result();
      },
      releaseIdleWorkers: vi.fn(),
    };
    const engine = new OcrEngine(recognitionPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(2);
    await engine.init(ctx);
    await engine.processSession(
      [
        createValidOcrPageRequest("same-document", 7),
        createValidOcrPageRequest("same-document", 7),
      ],
      createImageProducer(),
      ctx,
    );
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(maxDetectInFlight).toBe(1);
    expect(recognitionOverlap).toBe(true);
  });

  it("routes different orientations for regions sharing a pageIndex by job", async () => {
    const orientations = new Map<number, number>([
      [100, 90],
      [200, 270],
    ]);
    const recognitionPayloads: unknown[] = [];
    const recognitionCompletions: number[] = [];
    let recognitionInFlight = 0;
    let maxRecognitionInFlight = 0;
    let orientationTail = Promise.resolve();
    let detectInFlight = 0;
    let maxDetectInFlight = 0;
    const orientationPool: FakePool = {
      dispatch: async (params): Promise<unknown> => {
        const value = params.payload as OcrOrientationPayload;
        const run = orientationTail.then(async () => {
          detectInFlight += 1;
          maxDetectInFlight = Math.max(maxDetectInFlight, detectInFlight);
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          detectInFlight -= 1;
          return { orientation: orientations.get(value.image.widthPx) ?? 0 };
        });
        orientationTail = run.then(() => undefined);
        return run;
      },
      releaseIdleWorkers: vi.fn(),
    };
    const recognitionPool: FakePool = {
      dispatch: async (params): Promise<unknown> => {
        recognitionPayloads.push(params.payload);
        const payload = params.payload as { readonly image: { readonly widthPx: number } };
        recognitionInFlight += 1;
        maxRecognitionInFlight = Math.max(maxRecognitionInFlight, recognitionInFlight);
        await new Promise<void>((resolve) =>
          setTimeout(resolve, payload.image.widthPx === 100 ? 20 : 0),
        );
        recognitionInFlight -= 1;
        recognitionCompletions.push(payload.image.widthPx);
        return {
          confidence: 1,
          words: [
            {
              text: `region-${payload.image.widthPx}`,
              source: "ocr",
              pageIndex: 4,
              confidence: 1,
              bbox: { x: 1, y: 2, width: 3, height: 4 },
            },
          ],
        };
      },
      releaseIdleWorkers: vi.fn(),
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(2);
    await engine.init(ctx);

    const requests = [
      createValidOcrPageRequest("same-document", 4),
      createValidOcrPageRequest("same-document", 4),
    ];
    const images = new Map([
      [requests[0]!, createEncodedPageImage(100, 40)],
      [requests[1]!, createEncodedPageImage(200, 40)],
    ]);
    const produce = (
      request: (typeof requests)[number],
    ): Promise<ReturnType<typeof createEncodedPageImage>> => Promise.resolve(images.get(request)!);
    const outputs = await engine.processSession(requests, produce, ctx);

    expect(recognitionPayloads).toHaveLength(2);
    expect(maxDetectInFlight).toBe(1);
    expect(maxRecognitionInFlight).toBe(2);
    expect(recognitionCompletions).toEqual([200, 100]);
    expect(outputs.map((output) => output.pageIndex)).toEqual([4, 4]);
    expect(recognitionPayloads[0]).toMatchObject({
      documentId: "same-document",
      pageIndex: 4,
      orientation: 90,
      image: { widthPx: 100 },
    });
    expect(recognitionPayloads[1]).toMatchObject({
      documentId: "same-document",
      pageIndex: 4,
      orientation: 270,
      image: { widthPx: 200 },
    });
    expect(outputs.map((output) => output.words.map((word) => word.text))).toEqual([
      ["region-100"],
      ["region-200"],
    ]);
  });

  it("retries an OSD timeout only through the page retry loop", async () => {
    let orientationCalls = 0;
    let recognitionCalls = 0;
    const timeout = new OcrTimeoutError("retry-orientation", 0, 60000);
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        orientationCalls += 1;
        if (orientationCalls === 1)
          return Promise.reject(EngineError.deserialize(timeout.serialize()));
        return { orientation: 0 };
      },
      releaseIdleWorkers: vi.fn(),
    };
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        recognitionCalls += 1;
        return result();
      },
      releaseIdleWorkers: vi.fn(),
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(1);
    await engine.init(ctx);

    await engine.processPage(createValidOcrPageInput("retry-orientation", 0), ctx);

    expect(orientationCalls).toBe(2);
    expect(recognitionCalls).toBe(1);
  });

  it("preserves OSD failure semantics across the worker boundary", async () => {
    const modelError = new OcrModelMissingError(["osd"], "traineddata missing");
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> =>
        Promise.reject(EngineError.deserialize(modelError.serialize())),
      releaseIdleWorkers: vi.fn(),
    };
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => result(),
      releaseIdleWorkers: vi.fn(),
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(1);
    await engine.init(ctx);

    await expect(
      engine.processPage(createValidOcrPageInput("osd-failure", 0), ctx),
    ).rejects.toBeInstanceOf(OcrModelMissingError);
  });

  it("releases both OCR services only when idle and recreates them on reanalysis", async () => {
    const releaseOrientation = vi.fn();
    const releaseRecognition = vi.fn();
    const engine = new OcrEngine(
      { ...createResolvedOcrPool(result()), releaseIdleWorkers: releaseRecognition },
      { ...createResolvedOcrPool({ orientation: 0 }), releaseIdleWorkers: releaseOrientation },
    );
    engines.push(engine);
    const ctx = contextWithConcurrency(1);
    await engine.init(ctx);
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker({ confidence: 90, blocks: [] }));
    await engine.processPage(createValidOcrPageInput("release", 0), ctx);
    engine.releaseIdleWorkers();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(releaseRecognition).toHaveBeenCalledTimes(1);
    expect(releaseOrientation).toHaveBeenCalledTimes(1);
  });

  it("rebuilds both real local services for a second session after release", async () => {
    const firstOrientation = mockTesseractWorker({ confidence: 90, blocks: [] });
    const firstRecognition = mockTesseractWorker({ confidence: 90, blocks: [] });
    const secondOrientation = mockTesseractWorker({ confidence: 90, blocks: [] });
    const secondRecognition = mockTesseractWorker({ confidence: 90, blocks: [] });
    vi.mocked(createWorker)
      .mockResolvedValueOnce(firstOrientation)
      .mockResolvedValueOnce(firstRecognition)
      .mockResolvedValueOnce(secondOrientation)
      .mockResolvedValueOnce(secondRecognition);
    const engine = new OcrEngine();
    engines.push(engine);
    const ctx = contextWithConcurrency(1);
    await engine.init(ctx);

    await engine.processPage(createValidOcrPageInput("generation-1", 0), ctx);
    engine.releaseIdleWorkers();
    await vi.waitFor(() => expect(firstOrientation.terminate).toHaveBeenCalledTimes(1));

    await engine.processPage(createValidOcrPageInput("generation-2", 0), ctx);
    expect(createWorker).toHaveBeenCalledTimes(4);
    expect(secondOrientation.terminate).not.toHaveBeenCalled();
    expect(secondRecognition.terminate).not.toHaveBeenCalled();
  });

  it("does not release a pool while processPage is active, including recognition wait", async () => {
    let finishRecognition!: () => void;
    const releaseRecognition = vi.fn();
    const releaseOrientation = vi.fn();
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        await new Promise<void>((resolve) => {
          finishRecognition = resolve;
        });
        return result();
      },
      releaseIdleWorkers: releaseRecognition,
    };
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => ({ orientation: 0 }),
      releaseIdleWorkers: releaseOrientation,
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(1);
    await engine.init(ctx);
    const page = engine.processPage(createValidOcrPageInput("active", 0), ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    engine.releaseIdleWorkers();
    expect(releaseRecognition).not.toHaveBeenCalled();
    expect(releaseOrientation).not.toHaveBeenCalled();
    finishRecognition();
    await page;
    engine.releaseIdleWorkers();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(releaseRecognition).toHaveBeenCalledTimes(1);
    expect(releaseOrientation).toHaveBeenCalledTimes(1);
  });

  it("does not release while a session consumer is still producing its image", async () => {
    const releaseRecognition = vi.fn();
    const releaseOrientation = vi.fn();
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => result(),
      releaseIdleWorkers: releaseRecognition,
    };
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => ({ orientation: 0 }),
      releaseIdleWorkers: releaseOrientation,
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(1);
    await engine.init(ctx);
    let releaseImage!: (image: ReturnType<typeof createEncodedPageImage>) => void;
    const produce = vi.fn(
      () =>
        new Promise<ReturnType<typeof createEncodedPageImage>>((resolve) => {
          releaseImage = resolve;
        }),
    );
    const session = engine.processSession(
      [createValidOcrPageRequest("producing", 0)],
      produce,
      ctx,
    );
    await vi.waitFor(() => expect(produce).toHaveBeenCalledTimes(1));
    engine.releaseIdleWorkers();
    expect(releaseRecognition).not.toHaveBeenCalled();
    expect(releaseOrientation).not.toHaveBeenCalled();
    releaseImage(createEncodedPageImage(2, 2));
    await session;
    engine.releaseIdleWorkers();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(releaseRecognition).toHaveBeenCalledTimes(1);
    expect(releaseOrientation).toHaveBeenCalledTimes(1);
  });

  it("keeps rejected session branches active until every producer settles", async () => {
    const releaseRecognition = vi.fn();
    const releaseOrientation = vi.fn();
    const missing = new OcrModelMissingError(["osd"], "late branch repro");
    let orientationCalls = 0;
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        orientationCalls += 1;
        if (orientationCalls === 1) {
          throw EngineError.deserialize(missing.serialize());
        }
        return { orientation: 0 };
      },
      releaseIdleWorkers: releaseOrientation,
    };
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => result(),
      releaseIdleWorkers: releaseRecognition,
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(2);
    await engine.init(ctx);

    let releaseSecondImage!: (image: ReturnType<typeof createEncodedPageImage>) => void;
    let produced = 0;
    const produce = vi.fn(() => {
      produced += 1;
      if (produced === 1) return Promise.resolve(createEncodedPageImage(2, 2));
      return new Promise<ReturnType<typeof createEncodedPageImage>>((resolve) => {
        releaseSecondImage = resolve;
      });
    });
    const session = engine.processSession(
      [
        createValidOcrPageRequest("rejected-branch", 0),
        createValidOcrPageRequest("rejected-branch", 1),
      ],
      produce,
      ctx,
    );
    await expect(session).rejects.toBeInstanceOf(OcrModelMissingError);
    expect(produced).toBe(2);
    engine.releaseIdleWorkers();
    expect(releaseRecognition).not.toHaveBeenCalled();
    expect(releaseOrientation).not.toHaveBeenCalled();

    releaseSecondImage(createEncodedPageImage(2, 2));
    await vi.waitFor(() => expect(orientationCalls).toBe(2));
    await vi.waitFor(() => expect(releaseRecognition).not.toHaveBeenCalled());
    engine.releaseIdleWorkers();
    await vi.waitFor(() => expect(releaseRecognition).toHaveBeenCalledTimes(1));
    expect(releaseOrientation).toHaveBeenCalledTimes(1);
  });

  it("dispose waits for rejected-session branches before releasing or accepting new OCR", async () => {
    const releaseRecognition = vi.fn();
    const releaseOrientation = vi.fn();
    const missing = new OcrModelMissingError(["osd"], "dispose branch repro");
    let orientationCalls = 0;
    let recognitionCalls = 0;
    const orientationPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        orientationCalls += 1;
        if (orientationCalls === 1) throw EngineError.deserialize(missing.serialize());
        return { orientation: 0 };
      },
      releaseIdleWorkers: releaseOrientation,
    };
    const recognitionPool: FakePool = {
      dispatch: async (): Promise<unknown> => {
        recognitionCalls += 1;
        return result();
      },
      releaseIdleWorkers: releaseRecognition,
    };
    const engine = new OcrEngine(recognitionPool, orientationPool);
    engines.push(engine);
    const ctx = contextWithConcurrency(2);
    await engine.init(ctx);

    let releaseSecondImage!: (image: ReturnType<typeof createEncodedPageImage>) => void;
    let produced = 0;
    const produce = vi.fn(() => {
      produced += 1;
      if (produced === 1) return Promise.resolve(createEncodedPageImage(2, 2));
      return new Promise<ReturnType<typeof createEncodedPageImage>>((resolve) => {
        releaseSecondImage = resolve;
      });
    });
    const session = engine.processSession(
      [
        createValidOcrPageRequest("dispose-rejected-branch", 0),
        createValidOcrPageRequest("dispose-rejected-branch", 1),
      ],
      produce,
      ctx,
    );
    void session.catch(() => undefined);
    await vi.waitFor(() => expect(produced).toBe(2));
    await expect(session).rejects.toBeInstanceOf(OcrModelMissingError);

    let disposed = false;
    const disposal = engine.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(false);
    expect(releaseRecognition).not.toHaveBeenCalled();
    expect(releaseOrientation).not.toHaveBeenCalled();

    releaseSecondImage(createEncodedPageImage(2, 2));
    await disposal;
    expect(disposed).toBe(true);
    expect(releaseRecognition).toHaveBeenCalledTimes(1);
    expect(releaseOrientation).toHaveBeenCalledTimes(1);
    expect(orientationCalls).toBe(1);
    expect(recognitionCalls).toBe(0);

    await expect(
      engine.processPage(createValidOcrPageInput("after-dispose", 0), ctx),
    ).rejects.toThrow();
    expect(recognitionCalls).toBe(0);
  });

  it("isolates orientation state between OcrEngine instances", async () => {
    const orientationPool = (angles: ReadonlyMap<number, number>): FakePool => ({
      dispatch: async (params): Promise<unknown> => {
        const payload = params.payload as OcrOrientationPayload;
        return { orientation: angles.get(payload.image.widthPx) ?? 0 };
      },
      releaseIdleWorkers: vi.fn(),
    });
    const payloadsA: unknown[] = [];
    const payloadsB: unknown[] = [];
    const recognitionPool = (sink: unknown[]): FakePool => ({
      dispatch: async (params): Promise<unknown> => {
        sink.push(params.payload);
        return result();
      },
      releaseIdleWorkers: vi.fn(),
    });
    const engineA = new OcrEngine(
      recognitionPool(payloadsA),
      orientationPool(
        new Map([
          [100, 90],
          [120, 0],
        ]),
      ),
    );
    const engineB = new OcrEngine(
      recognitionPool(payloadsB),
      orientationPool(
        new Map([
          [100, 180],
          [120, 270],
        ]),
      ),
    );
    engines.push(engineA, engineB);
    const ctxA = contextWithConcurrency(1);
    const ctxB = contextWithConcurrency(1);
    await engineA.init(ctxA);
    await engineB.init(ctxB);
    await engineA.processPage(
      createValidOcrPageInput("isolated-a", 0, { image: createEncodedPageImage(100, 40) }),
      ctxA,
    );
    await engineB.processPage(
      createValidOcrPageInput("isolated-b", 0, { image: createEncodedPageImage(100, 40) }),
      ctxB,
    );
    engineA.releaseIdleWorkers();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await engineB.processPage(
      createValidOcrPageInput("isolated-b", 1, { image: createEncodedPageImage(120, 40) }),
      ctxB,
    );

    expect(payloadsA[0]).toMatchObject({ orientation: 90 });
    expect(payloadsB).toHaveLength(2);
    expect(payloadsB[0]).toMatchObject({ orientation: 180, image: { widthPx: 100 } });
    expect(payloadsB[1]).toMatchObject({ orientation: 270, image: { widthPx: 120 } });
  });
});
