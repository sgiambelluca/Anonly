import { InvalidInputError, type OcrOrientationPayload } from "@anonly/shared";
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
  setStubDrawImageThrowsOnce,
  setStubDecodedDataReadThrowsOnce,
  setStubDecodedPixelPainterSequence,
  trackOffscreenCanvasConstructions,
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
        inkRatio: 1,
        osdHadVerdict: true,
      });
      expect(createWorker).toHaveBeenCalledTimes(1);
      expect(createWorker).toHaveBeenCalledWith(
        ["osd"],
        OEM.TESSERACT_ONLY,
        expect.objectContaining({ legacyCore: true }),
      );
      // ADR-190 §1: 100×40 (lado largo 100) escala con factor
      // min(2, 1754/100) = 2 -> 200×80.
      expect(tracked.calls[0]?.[1]).toEqual({ resizeWidth: 200, resizeHeight: 80 });
    } finally {
      tracked.restore();
      await kernel.dispose();
    }
  });

  it("does not treat a non-finite OSD confidence as a verdict", async () => {
    const detect = vi.fn(() => Promise.resolve(mockDetectData(90, Number.POSITIVE_INFINITY)));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 90, blocks: [] }, { detect }),
    );
    const kernel = createOrientationKernel();
    try {
      await expect(kernel.detect(payload(), new AbortController().signal)).resolves.toEqual({
        orientation: 0,
        inkRatio: 1,
        osdHadVerdict: false,
      });
    } finally {
      await kernel.dispose();
    }
  });

  it("keeps the OSD canvas alive after timeout until the pending detect job settles", async () => {
    let finishDetect: ((value: { jobId: string; data: unknown }) => void) | undefined;
    const detect = vi.fn(
      (_image: OffscreenCanvas) =>
        new Promise<{ jobId: string; data: unknown }>((resolve) => {
          finishDetect = resolve;
        }),
    );
    const worker = mockTesseractWorker({ confidence: 0, blocks: [] }, { detect });
    vi.mocked(createWorker).mockResolvedValue(worker);
    const kernel = createOrientationKernel();

    try {
      await expect(
        kernel.detect(payload({ timeoutMs: 5 }), new AbortController().signal),
      ).rejects.toBeInstanceOf(OcrTimeoutError);
      expect(detect).toHaveBeenCalledTimes(1);
      const canvas = detect.mock.calls[0]?.[0];
      if (canvas === undefined) throw new Error("expected OSD OffscreenCanvas");
      expect(canvas.width).toBe(200);
      expect(canvas.height).toBe(80);

      finishDetect?.({ jobId: "late-after-timeout", data: mockDetectData(0) });
      await vi.waitFor(() => {
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
      });
    } finally {
      await kernel.dispose();
    }
  });

  it("releases the OSD canvas when image drawing fails before detect owns it", async () => {
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker({ confidence: 0, blocks: [] }));
    const tracked = trackOffscreenCanvasConstructions();
    const kernel = createOrientationKernel();
    setStubDrawImageThrowsOnce();

    try {
      await expect(kernel.detect(payload(), new AbortController().signal)).resolves.toEqual({
        orientation: 0,
        inkRatio: 1,
        osdHadVerdict: false,
      });
      expect(tracked.canvases).toHaveLength(1);
      expect(tracked.canvases[0]?.width).toBe(0);
      expect(tracked.canvases[0]?.height).toBe(0);
    } finally {
      tracked.restore();
      await kernel.dispose();
    }
  });

  // Caso 46 (§13), ADR-190 §3: `inkRatio` usa el predicado LITERAL de
  // ADR-162 (`isPixelPresent`) sobre la MISMA imagen reducida que ve
  // `detect()` — acá 200×80 (factor 2 sobre el payload 100×40 default).
  it("orientation result reports inkRatio with the ADR-162 predicate", async () => {
    vi.mocked(createWorker).mockResolvedValue(mockTesseractWorker({ confidence: 90, blocks: [] }));
    // Mitad izquierda negra opaca (presente), mitad derecha blanca opaca (no
    // presente): con un canvas de 200 px de ancho, exactamente la mitad de
    // los píxeles cumplen el predicado -> inkRatio = 0,5.
    setStubDecodedPixelPainterSequence([(x) => (x < 100 ? [0, 0, 0, 255] : [255, 255, 255, 255])]);
    const kernel = createOrientationKernel();

    try {
      await expect(kernel.detect(payload(), new AbortController().signal)).resolves.toEqual({
        orientation: 0,
        inkRatio: 0.5,
        osdHadVerdict: true,
      });
    } finally {
      await kernel.dispose();
    }
  });

  it("orientation detection failure preserves measured inkRatio", async () => {
    const detect = vi.fn(() => Promise.reject(new Error("Too few characters. Skipping this page")));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 0, blocks: [] }, { detect }),
    );

    for (const inkRatio of [0, 0.5, 1]) {
      // El raster reducido mide 200 × 80. Se mide antes de fallar detect().
      setStubDecodedPixelPainterSequence([
        (x) => (x < 200 * inkRatio ? [0, 0, 0, 255] : [255, 255, 255, 255]),
      ]);
      const kernel = createOrientationKernel();
      try {
        await expect(kernel.detect(payload(), new AbortController().signal)).resolves.toEqual({
          orientation: 0,
          inkRatio,
          osdHadVerdict: false,
        });
      } finally {
        await kernel.dispose();
      }
    }
    expect(detect).toHaveBeenCalledTimes(3);
  });

  it("orientation detection failure fails open when ink measurement is unavailable", async () => {
    const detect = vi.fn(() => Promise.reject(new Error("OSD failed")));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 0, blocks: [] }, { detect }),
    );
    setStubDecodedDataReadThrowsOnce();
    const kernel = createOrientationKernel();
    try {
      await expect(kernel.detect(payload(), new AbortController().signal)).resolves.toEqual({
        orientation: 0,
        inkRatio: 1,
        osdHadVerdict: false,
      });
      expect(detect).toHaveBeenCalledTimes(1);
    } finally {
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
        inkRatio: 1,
        osdHadVerdict: true,
      });
      await expect(
        kernelB.detect(payload({ documentId: "B" }), new AbortController().signal),
      ).resolves.toEqual({
        orientation: 270,
        inkRatio: 1,
        osdHadVerdict: true,
      });
      await kernelA.dispose();
      expect(terminateA).toHaveBeenCalledTimes(1);
      await expect(
        kernelB.detect(payload({ documentId: "B", pageIndex: 1 }), new AbortController().signal),
      ).resolves.toEqual({
        orientation: 270,
        inkRatio: 1,
        osdHadVerdict: true,
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
      inkRatio: 1,
      osdHadVerdict: false,
    });
    await kernel.dispose();
  });

  // Caso 48 (§13), ADR-190 enmienda 2026-09-28: 0° detectado con confianza
  // suficiente (`osdHadVerdict: true`) no es lo mismo que el fallback a 0°
  // (`false`), ya sea por confianza insuficiente o por falla de `detect`.
  it("reports whether OSD returned a real verdict or fell back to zero", async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce(mockDetectData(0, 1))
      .mockResolvedValueOnce(mockDetectData(0, 0.2))
      .mockRejectedValueOnce(new Error("Too few characters. Skipping this page"));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 90, blocks: [] }, { detect }),
    );
    const kernel = createOrientationKernel();
    try {
      const signal = new AbortController().signal;
      await expect(kernel.detect(payload({ pageIndex: 0 }), signal)).resolves.toMatchObject({
        orientation: 0,
        osdHadVerdict: true,
      });
      await expect(kernel.detect(payload({ pageIndex: 1 }), signal)).resolves.toMatchObject({
        orientation: 0,
        osdHadVerdict: false,
      });
      await expect(kernel.detect(payload({ pageIndex: 2 }), signal)).resolves.toMatchObject({
        orientation: 0,
        osdHadVerdict: false,
      });
    } finally {
      await kernel.dispose();
    }
  });

  // Las variantes de timeout/abort durante detect(), durante la carga del
  // worker OSD y durante la decodificación del bitmap viven ahora en
  // `edge.test.ts` ("terminates timed out or aborted OSD and ignores late
  // initialization and decode", OCR_Engine.md §14, caso 28), junto con el
  // caso de una orientación encolada que se cancela sin llegar a cargar ni
  // reconocer ("cancels queued orientation without loading or recognizing").

  // OCR_Engine.md §13 caso 28 / §14: "dos repros de r4, más resolución tardía
  // sin pisar generación nueva". Repro 1: una inicialización que time-outea
  // no bloquea la SIGUIENTE solicitud válida (nueva generación) ni impide que
  // el worker viejo, cuando resuelve tarde, se libere sin pisar la nueva.
  // Repro 2: `dispose()` tampoco espera una inicialización invalidada que
  // nunca resuelve.
  it("recovers and disposes without waiting for an invalidated initialization", async () => {
    // Repro 1: recupera sin esperar la carga vieja; el worker tardío se termina.
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
      inkRatio: 1,
      osdHadVerdict: true,
    });
    expect(createWorker).toHaveBeenCalledTimes(2);

    // Resolución tardía de la inicialización invalidada: se libera sin pisar
    // la generación nueva (la segunda instancia sigue siendo la vigente).
    releaseFirst(firstWorker);
    await Promise.resolve();
    await Promise.resolve();
    expect(firstTerminate).toHaveBeenCalledTimes(1);

    await kernel.dispose();

    // Repro 2: dispose() no espera una inicialización invalidada que nunca
    // resuelve — un kernel nuevo, para forzar una inicialización propia.
    vi.mocked(createWorker).mockImplementation(() => new Promise(() => undefined));
    const kernel2 = createOrientationKernel();
    const stuck = kernel2.detect(
      payload({ documentId: "stuck", timeoutMs: 5 }),
      new AbortController().signal,
    );
    await expect(stuck).rejects.toBeInstanceOf(OcrTimeoutError);

    let disposed = false;
    const dispose = kernel2.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(true);
    await dispose;
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
  // Contracts §7.1 (`OcrPagePayload.upscale`): 1 ≤ upscale ≤ 300/dpi. Un NaN
  // llegaría a `ensureDpiApplied`/`upscaleImageData` sin este control.
  it.each([
    [Number.NaN, 150],
    [Number.POSITIVE_INFINITY, 150],
    [0, 150],
    [-1, 150],
    [0.5, 150],
    [2.5, 150], // tope 300/150 = 2
    [1.01, 300], // tope 300/300 = 1
    [1.5, 600], // a más de 300 dpi no hay factor válido mayor que 1
  ])(
    "rejects an out-of-range recognition upscale %s at %s dpi without creating OSD",
    async (upscale, dpi) => {
      const invalidPayload = {
        documentId: "invalid-upscale",
        pageIndex: 0,
        image: createEncodedPageImage(100, 40),
        dpi,
        languages: ["spa", "eng"],
        orientation: 0 as const,
        upscale,
      };

      await expect(
        kernelRecognize(invalidPayload, {
          timeoutMs: 100,
          abortSignal: new AbortController().signal,
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
      expect(createWorker).not.toHaveBeenCalled();
    },
  );
});
