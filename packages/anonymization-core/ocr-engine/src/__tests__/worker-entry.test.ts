/**
 * Tests del entry-point del OcrWorker (`../worker/entry.js`, ADR-045 §3).
 * No hay `self`/`Worker` real en el entorno de test del Core
 * (`environment: "node"`) — se stubea un `self` fake (`postMessage`/
 * `addEventListener`) antes de importar el módulo (side-effects de carga:
 * auto-init + registro del listener "message", ver nota de cabecera de
 * `entry.ts`), y se ejercita el protocolo `WorkerInbound`/`WorkerOutbound`
 * end-to-end contra el kernel real (`../worker/kernel.js`) con `tesseract.js`
 * mockeado (mismo criterio que `contract.test.ts`/`unit.test.ts` de este
 * paquete y que `render-engine/src/__tests__/worker-entry.test.ts`).
 *
 * A diferencia del entry-point de PdfWorker (que envuelve el motor
 * completo): acá el worker SOLO corre el kernel de reconocimiento — sin
 * bus/cache puente, sin `OcrEngine` instanciado (ADR-045 §1/§3, precedente
 * ADR-043 para Render). Estos tests NO cubren `processPage`/`processPages`
 * (loop, retry, depósito en cache, eventos): eso vive host-side, cubierto
 * por `contract.test.ts`/`unit.test.ts`/`edge.test.ts`.
 */
import {
  EngineErrorCode,
  type OcrPagePayload,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Por el hoisting de Vitest, cada archivo de test declara su propio vi.mock
// (ver comentario en fixtures/test-helpers.ts).
vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));

import {
  createImageData,
  mockEmptyRecognizeData,
  mockRecognizeData,
  mockTesseractWorker,
} from "./fixtures/test-helpers.js";

interface FakeWorkerSelf {
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  emitMessage(message: WorkerInbound): void;
}

function createFakeSelf(): FakeWorkerSelf {
  let listener: ((ev: { readonly data: WorkerInbound }) => void) | undefined;
  const addEventListener = vi.fn((type: string, handler: (ev: unknown) => void) => {
    if (type === "message") {
      listener = handler as (ev: { readonly data: WorkerInbound }) => void;
    }
  });
  return {
    postMessage: vi.fn(),
    addEventListener,
    emitMessage(message: WorkerInbound): void {
      listener?.({ data: message });
    },
  };
}

function outboundOfType<T extends WorkerOutbound["type"]>(
  fakeSelf: FakeWorkerSelf,
  type: T,
): Extract<WorkerOutbound, { type: T }> | undefined {
  const call = fakeSelf.postMessage.mock.calls.find((c) => (c[0] as WorkerOutbound).type === type);
  return call?.[0] as Extract<WorkerOutbound, { type: T }> | undefined;
}

function basePayload(overrides?: Partial<OcrPagePayload>): OcrPagePayload {
  return {
    documentId: "doc-worker",
    pageIndex: 0,
    imageData: createImageData(100, 40),
    dpi: 300,
    languages: ["spa", "eng"],
    ...overrides,
  };
}

describe("OcrWorker entry-point — kernel puro (ADR-045 §3)", () => {
  let fakeSelf: FakeWorkerSelf;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    fakeSelf = createFakeSelf();
    vi.stubGlobal("self", fakeSelf);
    await import("../worker/entry.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts READY on module load (auto-init eager, sin esperar INIT)", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    const ready = outboundOfType(fakeSelf, "READY");
    expect(ready?.capabilities).toEqual({ maxPageBatchSize: 8 });
  });

  it("RUN(ocr-page) responde COMPLETED con { words, confidence } (sin EVENT/LOG: sin bus puente)", async () => {
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Hola", confidence: 90, bbox: { x0: 10, y0: 10, x1: 60, y1: 30 } },
        ]),
      ),
    );

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-1",
      signalId: "job-1",
      jobType: "ocr-page",
      payload: basePayload(),
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-1");
    const result = completed?.result as { words: ReadonlyArray<unknown>; confidence: number };
    expect(result.words.length).toBe(1);
    expect(result.confidence).toBeGreaterThan(0);

    // Sin bus/logger puente (nota de cabecera): ningún mensaje EVENT/LOG.
    const eventOrLog = fakeSelf.postMessage.mock.calls
      .map((c) => c[0] as WorkerOutbound)
      .filter((m) => m.type === "EVENT" || m.type === "LOG");
    expect(eventOrLog).toEqual([]);
  });

  it("RUN con jobType no soportado responde FAILED sin invocar tesseract", async () => {
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-bad-type",
      signalId: "job-bad-type",
      jobType: "pdf-parse",
      payload: {},
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.jobId).toBe("job-bad-type");
    expect(failed?.error.code).toBe(EngineErrorCode.INVALID_INPUT);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("CANCEL antes de que arranque el proceso aborta el job -> responde CANCELLED", async () => {
    const recognize = vi.fn(() => new Promise(() => {})); // nunca resuelve
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(mockEmptyRecognizeData(), { recognize }),
    );

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-cancel",
      signalId: "job-cancel",
      jobType: "ocr-page",
      payload: basePayload({ documentId: "doc-cancel" }),
    });
    fakeSelf.emitMessage({ type: "CANCEL", jobId: "job-cancel", signalId: "job-cancel" });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "CANCELLED")).toBeDefined());
    const cancelled = outboundOfType(fakeSelf, "CANCELLED");
    expect(cancelled?.jobId).toBe("job-cancel");
    expect(cancelled?.signalId).toBe("job-cancel");
  });

  it("CANCEL de un jobId desconocido es un no-op seguro", () => {
    expect(() =>
      fakeSelf.emitMessage({ type: "CANCEL", jobId: "no-existe", signalId: "no-existe" }),
    ).not.toThrow();
  });

  it("DISPOSE termina la instancia de tesseract; un RUN posterior recarga y funciona", async () => {
    const terminate = vi.fn(() => Promise.resolve());
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(mockEmptyRecognizeData(), { terminate }),
    );

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-before-dispose",
      signalId: "job-before-dispose",
      jobType: "ocr-page",
      payload: basePayload({ documentId: "doc-dispose" }),
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());

    fakeSelf.emitMessage({ type: "DISPOSE" });
    // handleDispose() es async (kernelDispose -> terminate()); deja pasar microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(terminate).toHaveBeenCalledTimes(1);

    fakeSelf.postMessage.mockClear();
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-after-dispose",
      signalId: "job-after-dispose",
      jobType: "ocr-page",
      payload: basePayload({ documentId: "doc-dispose" }),
    });

    // A diferencia de Render (que exige load-document previo), OCR no tiene
    // precondición de "documento cargado": recarga la instancia de tesseract
    // bajo demanda y el RUN posterior a DISPOSE completa igual.
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("INIT adopta la config real (workerPool.timeouts['ocr-page']) y vuelve a publicar READY", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    fakeSelf.emitMessage({
      type: "INIT",
      config: { workerPool: { timeouts: { "ocr-page": 5000 } } },
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
  });

  // ─── Tests nuevos de ADR-045 §3 / OCR_Engine.md §14 ───

  it("kernel RUN(ocr-page) returns words/confidence identical to in-process path", async () => {
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker(
        mockRecognizeData([
          { text: "Parity", confidence: 85, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
        ]),
      ),
    );

    const payload = basePayload({ documentId: "doc-parity" });

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-parity",
      signalId: "job-parity",
      jobType: "ocr-page",
      payload,
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const viaWorker = outboundOfType(fakeSelf, "COMPLETED")?.result;

    // Llamada directa al kernel real que este entry-point envuelve (mismo
    // módulo, ya con la instancia de tesseract cargada por el RUN de arriba)
    // — demuestra que el wrapper de mensajería no distorsiona la salida
    // (fallback in-process, ADR-035, invoca exactamente esta misma función).
    const { kernelRecognize } = await import("../worker/kernel.js");
    const viaDirect = await kernelRecognize(payload, {
      timeoutMs: 60_000,
      abortSignal: new AbortController().signal,
    });

    expect(viaWorker).toEqual(viaDirect);
  });

  it("kernel recreates tesseract instance on language set change", async () => {
    const terminateA = vi.fn(() => Promise.resolve());
    const terminateB = vi.fn(() => Promise.resolve());
    vi.mocked(createWorker)
      .mockResolvedValueOnce(
        mockTesseractWorker(mockEmptyRecognizeData(), { terminate: terminateA }),
      )
      .mockResolvedValueOnce(
        mockTesseractWorker(mockEmptyRecognizeData(), { terminate: terminateB }),
      );

    const withLanguages = (languages: ReadonlyArray<string>): OcrPagePayload =>
      basePayload({ documentId: "doc-lang-change", languages });

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-1",
      signalId: "job-1",
      jobType: "ocr-page",
      payload: withLanguages(["spa", "eng"]),
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenNthCalledWith(1, ["spa", "eng"], undefined, expect.anything());

    fakeSelf.postMessage.mockClear();

    // Segundo RUN con un set de idiomas DISTINTO: recrea la instancia.
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-2",
      signalId: "job-2",
      jobType: "ocr-page",
      payload: withLanguages(["fra"]),
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    expect(terminateA).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(createWorker).toHaveBeenNthCalledWith(2, ["fra"], undefined, expect.anything());

    fakeSelf.postMessage.mockClear();

    // Tercer RUN con el MISMO set que el segundo: no recrea de nuevo.
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-3",
      signalId: "job-3",
      jobType: "ocr-page",
      payload: withLanguages(["fra"]),
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(terminateB).not.toHaveBeenCalled();
  });
});
