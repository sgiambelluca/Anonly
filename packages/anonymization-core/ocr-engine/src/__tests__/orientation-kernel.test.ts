import { CancelledError, InvalidInputError, type OcrOrientationPayload } from "@anonly/shared";
import { createWorker, OEM } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
  OEM: { TESSERACT_ONLY: 0 },
  PSM: { SPARSE_TEXT: "11" },
}));

import { OcrModelMissingError, OcrTimeoutError } from "../ocr.errors.js";
import { kernelRecognize } from "../worker/kernel.js";
import { createOrientationKernel } from "../worker/orientation-kernel.js";

import {
  createEncodedPageImage,
  mockDetectData,
  mockTesseractWorker,
  trackCreateImageBitmapCalls,
} from "./fixtures/test-helpers.js";

function payload(overrides?: Partial<OcrOrientationPayload>): OcrOrientationPayload {
  return {
    documentId: "orientation-test",
    pageIndex: 0,
    image: createEncodedPageImage(100, 40),
    languages: ["spa", "eng"],
    timeoutMs: 100,
    ...overrides,
  };
}

describe("orientation kernel — OSD compartido por instancia", () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates one legacy OSD worker, reduces the raster, and returns the validated angle", async () => {
    const detect = vi.fn(() => Promise.resolve(mockDetectData(90)));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 90, blocks: [] }, { detect }),
    );
    const tracked = trackCreateImageBitmapCalls();
    const kernel = createOrientationKernel();

    try {
      await expect(kernel.detect(payload(), new AbortController().signal)).resolves.toEqual({
        orientation: 90,
      });
      expect(createWorker).toHaveBeenCalledTimes(1);
      expect(createWorker).toHaveBeenCalledWith(
        ["osd"],
        OEM.TESSERACT_ONLY,
        expect.objectContaining({ legacyCore: true }),
      );
      expect(tracked.calls[0]?.[1]).toEqual({ resizeWidth: 50, resizeHeight: 20 });
    } finally {
      tracked.restore();
      await kernel.dispose();
    }
  });

  it("keeps two kernel resources isolated when one is released", async () => {
    const terminateA = vi.fn(() => Promise.resolve());
    const detectA = vi.fn(() => Promise.resolve(mockDetectData(90)));
    const workerA = mockTesseractWorker(
      { confidence: 90, blocks: [] },
      { detect: detectA, terminate: terminateA },
    );
    const detectB = vi.fn(() => Promise.resolve(mockDetectData(270)));
    const workerB = mockTesseractWorker({ confidence: 90, blocks: [] }, { detect: detectB });
    vi.mocked(createWorker).mockResolvedValueOnce(workerA).mockResolvedValueOnce(workerB);
    const kernelA = createOrientationKernel();
    const kernelB = createOrientationKernel();
    try {
      await expect(
        kernelA.detect(payload({ documentId: "A" }), new AbortController().signal),
      ).resolves.toEqual({
        orientation: 90,
      });
      await expect(
        kernelB.detect(payload({ documentId: "B" }), new AbortController().signal),
      ).resolves.toEqual({
        orientation: 270,
      });
      await kernelA.dispose();
      expect(terminateA).toHaveBeenCalledTimes(1);
      await expect(
        kernelB.detect(payload({ documentId: "B", pageIndex: 1 }), new AbortController().signal),
      ).resolves.toEqual({
        orientation: 270,
      });
      expect(detectB).toHaveBeenCalledTimes(2);
      expect(terminateA).toHaveBeenCalledTimes(1);
    } finally {
      await kernelB.dispose();
    }
  });

  it("falls back to upright when OSD detection is unsure", async () => {
    const detect = vi.fn(() => Promise.resolve(mockDetectData(180, 0.2)));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 90, blocks: [] }, { detect }),
    );
    const kernel = createOrientationKernel();

    await expect(kernel.detect(payload(), new AbortController().signal)).resolves.toEqual({
      orientation: 0,
    });
    await kernel.dispose();
  });

  it("terminates OSD on abort and does not keep a late detection alive", async () => {
    const terminate = vi.fn(() => Promise.resolve());
    const detect = vi.fn(() => new Promise<never>(() => undefined));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 90, blocks: [] }, { detect, terminate }),
    );
    const controller = new AbortController();
    const kernel = createOrientationKernel();
    const result = kernel.detect(payload(), controller.signal);
    controller.abort();

    await expect(result).rejects.toBeInstanceOf(CancelledError);
    expect(terminate).toHaveBeenCalledTimes(1);
    await kernel.dispose();
  });

  it("terminates OSD on timeout and reports OcrTimeoutError", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn(() => Promise.resolve());
    const detect = vi.fn(() => new Promise<never>(() => undefined));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 90, blocks: [] }, { detect, terminate }),
    );
    const kernel = createOrientationKernel();
    const result = kernel.detect(payload({ timeoutMs: 10 }), new AbortController().signal);
    const assertion = expect(result).rejects.toBeInstanceOf(OcrTimeoutError);
    await vi.advanceTimersByTimeAsync(11);

    await assertion;
    expect(terminate).toHaveBeenCalledTimes(1);
    await kernel.dispose();
  });

  it.each(["timeout", "abort"])(
    "settles %s while OSD worker initialization is pending",
    async (mode) => {
      vi.useFakeTimers();
      let release!: (worker: Awaited<ReturnType<typeof createWorker>>) => void;
      vi.mocked(createWorker).mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const kernel = createOrientationKernel();
      const controller = new AbortController();
      const task = kernel.detect(payload({ timeoutMs: 10 }), controller.signal);
      const assertion = expect(task).rejects.toBeInstanceOf(
        mode === "abort" ? CancelledError : OcrTimeoutError,
      );
      if (mode === "abort") controller.abort();
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
      release(mockTesseractWorker({ confidence: 90, blocks: [] }));
      await kernel.dispose();
    },
  );

  it("starts a new generation after a timed out initialization and cleans a late worker", async () => {
    let releaseFirst!: (worker: Awaited<ReturnType<typeof createWorker>>) => void;
    const firstTerminate = vi.fn(() => Promise.resolve());
    const firstWorker = mockTesseractWorker(
      { confidence: 90, blocks: [] },
      { terminate: firstTerminate },
    );
    const secondWorker = mockTesseractWorker({ confidence: 90, blocks: [] });
    vi.mocked(createWorker)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(secondWorker);
    const kernel = createOrientationKernel();

    const first = kernel.detect(payload({ timeoutMs: 5 }), new AbortController().signal);
    await expect(first).rejects.toBeInstanceOf(OcrTimeoutError);

    await expect(
      kernel.detect(payload({ pageIndex: 1 }), new AbortController().signal),
    ).resolves.toEqual({
      orientation: 0,
    });
    expect(createWorker).toHaveBeenCalledTimes(2);

    releaseFirst(firstWorker);
    await Promise.resolve();
    await Promise.resolve();
    expect(firstTerminate).toHaveBeenCalledTimes(1);
    await kernel.dispose();
  });

  it("does not make dispose wait for an initialization that never resolves", async () => {
    vi.mocked(createWorker).mockImplementation(() => new Promise(() => undefined));
    const kernel = createOrientationKernel();
    const task = kernel.detect(payload({ timeoutMs: 5 }), new AbortController().signal);
    await expect(task).rejects.toBeInstanceOf(OcrTimeoutError);

    let disposed = false;
    const dispose = kernel.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(true);
    await dispose;
  });

  it("closes a bitmap that resolves after the OSD deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker({ confidence: 90, blocks: [] }));
    const originalBitmap = await createImageBitmap(new Blob());
    let release!: (bitmap: ImageBitmap) => void;
    vi.spyOn(globalThis, "createImageBitmap").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const close = vi.spyOn(originalBitmap, "close");
    const kernel = createOrientationKernel();
    const task = kernel.detect(payload({ timeoutMs: 10 }), new AbortController().signal);
    const assertion = expect(task).rejects.toBeInstanceOf(OcrTimeoutError);
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    release(originalBitmap);
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    await kernel.dispose();
  });

  it("propagates OSD model load failure without pretending every page is upright", async () => {
    vi.mocked(createWorker).mockRejectedValue(new Error("osd.traineddata missing"));
    const kernel = createOrientationKernel();

    await expect(kernel.detect(payload(), new AbortController().signal)).rejects.toBeInstanceOf(
      OcrModelMissingError,
    );
    await kernel.dispose();
  });

  it("rejects missing or invalid recognition orientation without creating OSD", async () => {
    const invalidPayload = {
      documentId: "invalid-orientation",
      pageIndex: 0,
      image: createEncodedPageImage(100, 40),
      dpi: 300,
      languages: ["spa", "eng"],
      orientation: 45,
    };

    // El wire puede traer cualquier número; el tipo público restringe los cuatro ángulos.
    await expect(
      // @ts-expect-error — discriminante inválido probado en runtime.
      kernelRecognize(invalidPayload, {
        timeoutMs: 100,
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(createWorker).not.toHaveBeenCalled();
  });
});
