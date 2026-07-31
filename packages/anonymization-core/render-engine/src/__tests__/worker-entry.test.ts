/**
 * Tests del entry-point del RenderWorker (`../worker/entry.js`, ADR-043 §4).
 * No hay `self`/`Worker` real en el entorno de test del Core
 * (`environment: "node"`) — se stubea un `self` fake (`postMessage`/
 * `addEventListener`) antes de importar el módulo (side-effects de carga:
 * auto-init + registro del listener "message", ver nota de cabecera de
 * `entry.ts`), y se ejercita el protocolo `WorkerInbound`/`WorkerOutbound`
 * end-to-end contra el kernel real (`../worker/kernel.js`) con `pdfjs-dist`
 * mockeado (mismo criterio que `contract.test.ts`/`unit.test.ts` de este
 * paquete y que `pdf-engine/src/__tests__/worker-entry.test.ts`).
 *
 * Foco principal (checklist §15 item 22, ADR-043 §4): la discriminación por
 * FORMA de los 4 payloads posibles bajo `jobType: "render-page"`, en el orden
 * exacto `"buffer" in payload` -> load; `"kind" in payload` -> render;
 * `"pageIndex" in payload` -> rasterize; si no -> unload.
 */
import {
  EngineErrorCode,
  type LoadDocumentPayload,
  type RasterizePagePayload,
  type RenderPagePayload,
  type UnloadDocumentPayload,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { getDocument } from "pdfjs-dist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "mock-render-worker-url" }));

import {
  createMockPage,
  createMockPdfDocument,
  mockGetDocumentResult,
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

function validBuffer(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

describe("RenderWorker entry-point (ADR-043 §4)", () => {
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

  // ─── Discriminación por forma (ADR-043 §4), en el orden exacto ───

  it('RUN("render-page") con payload que trae "buffer" despacha load-document', async () => {
    vi.mocked(getDocument).mockReturnValue(
      mockGetDocumentResult(createMockPdfDocument({ pageCount: 3 })),
    );
    const payload: LoadDocumentPayload = { documentId: "doc-load", buffer: validBuffer() };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-load",
      signalId: "job-load",
      jobType: "render-page",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-load");
    expect(completed?.result).toEqual({ pageCount: 3 });
  });

  it('RUN("render-page") con payload que trae "kind" (sin "buffer") despacha render', async () => {
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => createMockPage({ width: 100, height: 100 }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    // Precondición ADR-030: el documento debe estar cargado en el kernel antes
    // de renderizar — se ejercita vía el mismo entry-point (load primero).
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-load-render",
      signalId: "job-load-render",
      jobType: "render-page",
      payload: { documentId: "doc-render", buffer: validBuffer() } satisfies LoadDocumentPayload,
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    const payload: RenderPagePayload = {
      documentId: "doc-render",
      pageIndex: 0,
      kind: "original",
      mode: "preview",
      scale: 1,
      imageFormat: "png",
    };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-render",
      signalId: "job-render",
      jobType: "render-page",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-render");
    const result = completed?.result as { imageData: ImageData; encoded: unknown };
    expect(result.imageData.width).toBe(100);
    expect(result.encoded).toBeDefined();
  });

  it('RUN("render-page") con payload que trae "pageIndex" (sin "buffer"/"kind") despacha rasterize', async () => {
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => createMockPage({ width: 50, height: 60 }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-load-rasterize",
      signalId: "job-load-rasterize",
      jobType: "render-page",
      payload: { documentId: "doc-rasterize", buffer: validBuffer() } satisfies LoadDocumentPayload,
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    const payload: RasterizePagePayload = { documentId: "doc-rasterize", pageIndex: 0, scale: 2 };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-rasterize",
      signalId: "job-rasterize",
      jobType: "render-page",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-rasterize");
    const imageData = completed?.result as ImageData;
    expect(imageData.width).toBe(100); // 50 * scale(2)
    expect(imageData.height).toBe(120); // 60 * scale(2)
  });

  it('RUN("render-page") con payload sin "buffer"/"kind"/"pageIndex" despacha unload (idempotente)', async () => {
    const payload: UnloadDocumentPayload = { documentId: "doc-never-loaded" };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-unload",
      signalId: "job-unload",
      jobType: "render-page",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-unload");
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("RUN con jobType no soportado responde FAILED sin invocar el kernel", async () => {
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

  it("render sobre un documento no cargado responde FAILED (ADR-030)", async () => {
    const payload: RenderPagePayload = {
      documentId: "doc-unloaded",
      pageIndex: 0,
      kind: "original",
      mode: "preview",
    };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-not-loaded",
      signalId: "job-not-loaded",
      jobType: "render-page",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.error.code).toBe(EngineErrorCode.INVALID_INPUT);
  });

  it("CANCEL antes de que arranque el proceso aborta el job -> responde CANCELLED", async () => {
    const mockDoc = createMockPdfDocument({
      pageCount: 1,
      pageFactory: () => createMockPage({ renderNeverResolves: true }),
    });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-load-cancel",
      signalId: "job-load-cancel",
      jobType: "render-page",
      payload: { documentId: "doc-cancel", buffer: validBuffer() } satisfies LoadDocumentPayload,
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    const payload: RenderPagePayload = {
      documentId: "doc-cancel",
      pageIndex: 0,
      kind: "original",
      mode: "preview",
    };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-cancel",
      signalId: "job-cancel",
      jobType: "render-page",
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

  it("DISPOSE libera los documentos del kernel; un render posterior falla por no-cargado", async () => {
    const mockDoc = createMockPdfDocument({ pageCount: 1 });
    vi.mocked(getDocument).mockReturnValue(mockGetDocumentResult(mockDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-load-dispose",
      signalId: "job-load-dispose",
      jobType: "render-page",
      payload: { documentId: "doc-dispose", buffer: validBuffer() } satisfies LoadDocumentPayload,
    });
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    fakeSelf.emitMessage({ type: "DISPOSE" });
    expect(mockDoc.destroy).toHaveBeenCalledTimes(1);

    const payload: RenderPagePayload = {
      documentId: "doc-dispose",
      pageIndex: 0,
      kind: "original",
      mode: "preview",
    };
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-after-dispose",
      signalId: "job-after-dispose",
      jobType: "render-page",
      payload,
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.error.code).toBe(EngineErrorCode.INVALID_INPUT);
  });

  it("INIT adopta la config real (render.jpegQuality) y vuelve a publicar READY", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    fakeSelf.emitMessage({
      type: "INIT",
      config: {
        render: { previewScale: 1, fullScale: 2, jpegQuality: 0.42, cachePages: 16 },
        workerPool: { timeouts: { "render-page": 5000 } },
      },
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
  });
});
