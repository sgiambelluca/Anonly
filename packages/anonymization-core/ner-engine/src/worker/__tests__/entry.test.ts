/**
 * Tests del entry-point del NerWorker (`../entry.js`, ADR-046 §3).
 * No hay `self`/`Worker` real en el entorno de test del Core
 * (`environment: "node"`) — se stubea un `self` fake (`postMessage`/
 * `addEventListener`) antes de importar el módulo (side-effects de carga:
 * auto-init + registro del listener "message", ver nota de cabecera de
 * `entry.ts`), y se ejercita el protocolo `WorkerInbound`/`WorkerOutbound`
 * end-to-end contra el kernel real (`../kernel.js`) con
 * `@huggingface/transformers` mockeado (mismo criterio que
 * `contract.test.ts`/`unit.test.ts` del paquete y que
 * `ocr-engine/src/__tests__/worker-entry.test.ts`).
 *
 * A diferencia del entry-point de PdfWorker (que envuelve el motor
 * completo): acá el worker SOLO corre el kernel de inferencia — sin bus
 * puente ni `NerEngine` instanciado (ADR-046 §1/§3, precedentes
 * ADR-043/ADR-045). Estos tests NO cubren `processPage`/`processPages`
 * (loop, retry, mapeo bbox, eventos de dominio): eso vive host-side,
 * cubierto por `contract.test.ts`/`unit.test.ts`/`edge.test.ts`. A
 * diferencia de OCR/Render, SÍ verifica el reenvío de `PROGRESS` (el ciclo
 * de vida del modelo, único caso de telemetría observable del NerWorker).
 */
import {
  EngineErrorCode,
  type NerPagePayload,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { pipeline } from "@huggingface/transformers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Por el hoisting de Vitest, cada archivo de test declara su propio vi.mock
// (ver comentario en ../../__tests__/fixtures/test-helpers.ts).
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: true,
    localModelPath: "/models/",
    backends: { onnx: { wasm: {} } },
  },
}));

import {
  asPipelineMock,
  mockTokenClassificationPipeline,
  nerToken,
  type TokenClassificationSingle,
} from "../../__tests__/fixtures/test-helpers.js";

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

function outboundsOfType<T extends WorkerOutbound["type"]>(
  fakeSelf: FakeWorkerSelf,
  type: T,
): ReadonlyArray<Extract<WorkerOutbound, { type: T }>> {
  return fakeSelf.postMessage.mock.calls
    .map((c) => c[0] as WorkerOutbound)
    .filter((m): m is Extract<WorkerOutbound, { type: T }> => m.type === type);
}

function basePayload(overrides?: Partial<NerPagePayload>): NerPagePayload {
  return {
    documentId: "doc-worker",
    pageIndex: 0,
    text: "Juan Pérez",
    modelId: "test-model",
    quantization: "q8",
    ...overrides,
  };
}

describe("NerWorker entry-point — kernel puro (ADR-046 §3)", () => {
  let fakeSelf: FakeWorkerSelf;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    fakeSelf = createFakeSelf();
    vi.stubGlobal("self", fakeSelf);
    await import("../entry.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts READY on module load (auto-init eager, sin esperar INIT)", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    const ready = outboundOfType(fakeSelf, "READY");
    expect(ready?.capabilities).toEqual({ maxPageBatchSize: 8 });
  });

  it("RUN(ner-page) responde COMPLETED con { spans } (sin EVENT/LOG: sin bus puente)", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-PER", "Juan", 0.9, 0)])),
    );

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-1",
      signalId: "job-1",
      jobType: "ner-page",
      payload: basePayload({ text: "Juan" }),
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-1");
    const result = completed?.result as { spans: ReadonlyArray<unknown> };
    expect(result.spans.length).toBe(1);

    // Sin bus/logger puente para eventos de dominio (nota de cabecera):
    // ningún mensaje EVENT/LOG.
    const eventOrLog = fakeSelf.postMessage.mock.calls
      .map((c) => c[0] as WorkerOutbound)
      .filter((m) => m.type === "EVENT" || m.type === "LOG");
    expect(eventOrLog).toEqual([]);
  });

  it("entry-point rejects a jobType other than ner-page", async () => {
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
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("entry-point CANCEL aborts the in-flight batch and answers CANCELLED", async () => {
    const classify = vi.fn(
      (): Promise<ReadonlyArray<TokenClassificationSingle>> => new Promise(() => {}), // nunca resuelve
    );
    asPipelineMock(pipeline).mockResolvedValue(mockTokenClassificationPipeline(classify));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-cancel",
      signalId: "job-cancel",
      jobType: "ner-page",
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

  it("reenvía PROGRESS del ciclo de vida del modelo tal cual, sin traducirlo (ADR-046 §4)", async () => {
    asPipelineMock(pipeline).mockImplementation((_task, _model, options) => {
      options?.progress_callback?.({ status: "progress", progress: 50 });
      return Promise.resolve(mockTokenClassificationPipeline(() => Promise.resolve([])));
    });

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-progress",
      signalId: "job-progress",
      jobType: "ner-page",
      payload: basePayload({ modelId: "model-progress" }),
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const progressMessages = outboundsOfType(fakeSelf, "PROGRESS");
    expect(progressMessages.length).toBeGreaterThanOrEqual(2); // model-loading + model-ready
    expect(progressMessages[0]).toMatchObject({
      jobId: "job-progress",
      progress: 0.5,
      partial: { phase: "model-loading", modelId: "model-progress" },
    });
    expect(progressMessages.at(-1)).toMatchObject({
      jobId: "job-progress",
      partial: { phase: "model-ready", modelId: "model-progress" },
    });
  });

  it("DISPOSE libera el pipeline; un RUN posterior recarga y funciona", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([])),
    );

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-before-dispose",
      signalId: "job-before-dispose",
      jobType: "ner-page",
      payload: basePayload({ documentId: "doc-dispose" }),
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    expect(pipeline).toHaveBeenCalledTimes(1);

    fakeSelf.emitMessage({ type: "DISPOSE" });
    // handleDispose() es async (kernelDispose -> classifier.dispose()); deja
    // pasar microtasks.
    await Promise.resolve();
    await Promise.resolve();

    fakeSelf.postMessage.mockClear();
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-after-dispose",
      signalId: "job-after-dispose",
      jobType: "ner-page",
      payload: basePayload({ documentId: "doc-dispose" }),
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it("INIT adopta la config real (workerPool.timeouts['ner-page']) y vuelve a publicar READY", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    fakeSelf.emitMessage({
      type: "INIT",
      config: { workerPool: { timeouts: { "ner-page": 5000 } } },
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
  });

  it("entry-point RUN(ner-page) returns spans identical to calling the kernel directly", async () => {
    asPipelineMock(pipeline).mockResolvedValue(
      mockTokenClassificationPipeline(() => Promise.resolve([nerToken("B-ORG", "Acme", 0.9, 0)])),
    );

    const payload = basePayload({ documentId: "doc-parity", text: "Acme" });

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-parity",
      signalId: "job-parity",
      jobType: "ner-page",
      payload,
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const viaWorker = outboundOfType(fakeSelf, "COMPLETED")?.result;

    // Llamada directa al kernel real que este entry-point envuelve (mismo
    // módulo, ya con la instancia cargada por el RUN de arriba) — demuestra
    // que el wrapper de mensajería no distorsiona la salida (fallback
    // in-process, ADR-035, invoca exactamente esta misma función).
    const { kernelClassify } = await import("../kernel.js");
    const viaDirect = await kernelClassify(payload, {
      timeoutMs: 20_000,
      abortSignal: new AbortController().signal,
    });

    expect(viaWorker).toEqual({ spans: viaDirect });
  });
});
