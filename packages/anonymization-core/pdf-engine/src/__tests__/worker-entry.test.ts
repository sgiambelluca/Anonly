/**
 * Tests del entry-point del PdfWorker (`../worker/entry.js`, ADR-036 §3,
 * ADR-041 §4). No hay `self`/`Worker` real en el entorno de test del Core
 * (`environment: "node"`, ver `worker-pool.ts` nota de cabecera) — se stubea
 * un `self` fake (`postMessage`/`addEventListener`) antes de importar el
 * módulo (side-effects de carga: auto-init + registro del listener
 * "message", ver nota de cabecera de `entry.ts`), y se maneja el protocolo
 * `WorkerInbound`/`WorkerOutbound` end-to-end contra el `PdfEngine` real con
 * `pdfjs-dist` mockeado (mismo criterio que `contract.test.ts`/`unit.test.ts`
 * de este paquete).
 */
import {
  EngineErrorCode,
  EngineEvents,
  EventChannel,
  type PdfParsePayload,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PdfWorkerEntryModule from "../worker/entry.js";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "mock-pdf-worker-url" }));

import { createMockPdfDocument, mockGetDocumentResult } from "./fixtures/test-helpers.js";

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

function validPdfBuffer(): ArrayBuffer {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
  const body = new Uint8Array(64).fill(0x41);
  const combined = new Uint8Array(header.length + body.length);
  combined.set(header, 0);
  combined.set(body, header.length);
  return combined.buffer;
}

function outboundOfType<T extends WorkerOutbound["type"]>(
  fakeSelf: FakeWorkerSelf,
  type: T,
): Extract<WorkerOutbound, { type: T }> | undefined {
  const call = fakeSelf.postMessage.mock.calls.find((c) => (c[0] as WorkerOutbound).type === type);
  return call?.[0] as Extract<WorkerOutbound, { type: T }> | undefined;
}

describe("PdfWorker entry-point (ADR-036 §3, ADR-041 §4)", () => {
  let fakeSelf: FakeWorkerSelf;
  let entryModule: typeof PdfWorkerEntryModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    fakeSelf = createFakeSelf();
    vi.stubGlobal("self", fakeSelf);
    entryModule = await import("../worker/entry.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts READY on module load (auto-init eager, sin esperar INIT)", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    const ready = outboundOfType(fakeSelf, "READY");
    expect(ready?.capabilities).toEqual({ maxPageBatchSize: 8 });
  });

  it("RUN(pdf-parse) responde COMPLETED y reenvía PAGE_PARSED/DOCUMENT_PARSED como EVENT", async () => {
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(2)));

    const payload: PdfParsePayload = { documentId: "doc-worker", buffer: validPdfBuffer() };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-1",
      signalId: "job-1",
      jobType: "pdf-parse",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-1");

    const events = fakeSelf.postMessage.mock.calls
      .map((c) => c[0] as WorkerOutbound)
      .filter((m): m is Extract<WorkerOutbound, { type: "EVENT" }> => m.type === "EVENT");
    expect(events.some((e) => e.event === EngineEvents.PAGE_PARSED)).toBe(true);
    expect(events.some((e) => e.event === EngineEvents.DOCUMENT_PARSED)).toBe(true);

    // ctx.logger.info(...) con meta (DOCUMENT_PARSED) viaja como LOG.
    const logs = fakeSelf.postMessage.mock.calls
      .map((c) => c[0] as WorkerOutbound)
      .filter((m): m is Extract<WorkerOutbound, { type: "LOG" }> => m.type === "LOG");
    expect(logs.some((l) => l.meta !== undefined)).toBe(true);
  });

  it("RUN con jobType no soportado responde FAILED sin invocar PdfEngine", async () => {
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-bad-type",
      signalId: "job-bad-type",
      jobType: "ocr-page",
      payload: {},
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.jobId).toBe("job-bad-type");
    expect(failed?.error.code).toBe(EngineErrorCode.INVALID_INPUT);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("RUN(pdf-parse) con buffer vacío responde FAILED con el EngineError real (PDF_INVALID)", async () => {
    const payload: PdfParsePayload = { documentId: "doc-empty", buffer: new ArrayBuffer(0) };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-empty",
      signalId: "job-empty",
      jobType: "pdf-parse",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.error.code).toBe(EngineErrorCode.PDF_INVALID);

    // PDF_INVALID también se emite por el bus puente antes de lanzar (ADR-020 §3).
    const events = fakeSelf.postMessage.mock.calls
      .map((c) => c[0] as WorkerOutbound)
      .filter((m): m is Extract<WorkerOutbound, { type: "EVENT" }> => m.type === "EVENT");
    expect(events.some((e) => e.event === EngineEvents.PDF_INVALID)).toBe(true);
  });

  it("RUN con payload malformado (sin buffer) responde FAILED envolviendo el error no-EngineError", async () => {
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-malformed",
      signalId: "job-malformed",
      jobType: "pdf-parse",
      payload: { documentId: "doc-malformed" },
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    // No es un EngineError (TypeError al leer buffer.byteLength de undefined):
    // handleRun lo envuelve en InvalidInputError (rama `else` del catch).
    expect(failed?.error.code).toBe(EngineErrorCode.INVALID_INPUT);
  });

  it("CANCEL antes de que arranque el proceso aborta el job -> responde CANCELLED", async () => {
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(1)));

    const payload: PdfParsePayload = { documentId: "doc-cancel", buffer: validPdfBuffer() };
    // Mismo tick: RUN registra el AbortController síncronamente (antes del
    // primer await de handleRun); CANCEL lo aborta antes de que
    // engine.process() llegue a chequear la señal.
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-cancel",
      signalId: "job-cancel",
      jobType: "pdf-parse",
      payload,
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

  it("DISPOSE libera el motor; un RUN posterior falla como disposed", async () => {
    fakeSelf.emitMessage({ type: "DISPOSE" });

    // handleDispose() es async (await engine.dispose()); deja pasar un microtask.
    await Promise.resolve();
    await Promise.resolve();

    const payload: PdfParsePayload = { documentId: "doc-after-dispose", buffer: validPdfBuffer() };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-after-dispose",
      signalId: "job-after-dispose",
      jobType: "pdf-parse",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.error.code).toBe(EngineErrorCode.ENGINE_DISPOSED);
  });

  it("INIT re-inicializa el motor con la config real y vuelve a publicar READY", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    const customConfig = {
      workerPool: {
        pdfPoolSize: 1,
        ocrPoolSize: 1,
        nerPoolSize: 1,
        renderPoolSize: 1,
        maxQueuePerPool: { pdf: 32, ocr: 8, ner: 8, render: 32 },
        timeouts: {
          "pdf-parse": 30_000,
          "ocr-page": 60_000,
          "ner-page": 20_000,
          "render-page": 10_000,
          "export-page": 30_000,
        },
        maxRetries: {
          "pdf-parse": 1,
          "ocr-page": 2,
          "ner-page": 1,
          "render-page": 1,
          "export-page": 1,
        },
        baseRetryDelayMs: 250,
        maxRetryDelayMs: 2000,
        cancelSlaMs: 200,
        idleDisposeMs: 60_000,
      },
      pdf: { maxPageCount: 1 }, // override: 1 sola página permitida
      ner: {
        modelId: "test",
        quantization: "q8",
        confidenceThreshold: 0.7,
        batchSize: 1,
        enabled: false,
      },
      ocr: { languages: ["spa"], dpi: 300 },
      grouping: { similarityThreshold: 0.88, minAliasFrequency: 1 },
      render: { previewScale: 1, fullScale: 2, jpegQuality: 0.85, cachePages: 16 },
      export: { defaultDpi: 150, defaultImageFormat: "jpeg" as const, defaultJpegQuality: 0.85 },
    };

    fakeSelf.emitMessage({ type: "INIT", config: customConfig });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());

    // La config nueva (maxPageCount: 1) se usa en el próximo RUN: un
    // documento de 2 páginas ahora excede el límite -> PDF_INVALID.
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(createMockPdfDocument(2)));
    const payload: PdfParsePayload = { documentId: "doc-init", buffer: validPdfBuffer() };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-init",
      signalId: "job-init",
      jobType: "pdf-parse",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.error.code).toBe(EngineErrorCode.PDF_INVALID);
  });

  // ─── Bridges internas: PdfEngine nunca ejercita on/once/off/emitAsync del
  // bus ni la mayoría de ICache (nunca lee ctx.cache) — se testean directo
  // contra las factories exportadas para cubrir esos contratos igual. ───

  describe("createBridgeBus (exportada para test directo)", () => {
    it("on/once/off son no-ops seguros; emit/emitAsync postean EVENT al host", async () => {
      const bus = entryModule.createBridgeBus();

      const unsubscribeOn = bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, () => undefined);
      const unsubscribeOnce = bus.once(EventChannel.Pdf, EngineEvents.PAGE_PARSED, () => undefined);
      expect(() => unsubscribeOn()).not.toThrow();
      expect(() => unsubscribeOnce()).not.toThrow();
      expect(() =>
        bus.off(EventChannel.Pdf, EngineEvents.PAGE_PARSED, () => undefined),
      ).not.toThrow();

      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "doc-bus",
        pageIndex: 0,
        wordCount: 1,
        requiresOCR: false,
      });
      await bus.emitAsync(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, {
        documentId: "doc-bus",
        pageCount: 1,
        textlessPages: [],
        sourceKind: "text",
      });

      const events = fakeSelf.postMessage.mock.calls
        .map((c) => c[0] as WorkerOutbound)
        .filter((m): m is Extract<WorkerOutbound, { type: "EVENT" }> => m.type === "EVENT");
      expect(events.some((e) => e.event === EngineEvents.PAGE_PARSED)).toBe(true);
      expect(events.some((e) => e.event === EngineEvents.DOCUMENT_PARSED)).toBe(true);
    });
  });

  describe("createLocalCache (exportada para test directo)", () => {
    it("implementa get/set/delete/clear/size/bytes", () => {
      const cache = entryModule.createLocalCache();

      expect(cache.size).toBe(0);
      expect(cache.bytes).toBe(0);

      cache.set("k", "v");
      expect(cache.size).toBe(1);
      expect(cache.get<string>("k")).toBe("v");

      cache.delete("k");
      expect(cache.get("k")).toBeUndefined();
      expect(cache.size).toBe(0);

      cache.set("k2", "v2");
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
