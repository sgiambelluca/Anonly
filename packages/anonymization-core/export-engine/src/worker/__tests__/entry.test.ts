/**
 * Tests del entry-point del ExportWorker (`../entry.js`, ADR-047 §3/§4).
 * No hay `self`/`Worker` real en el entorno de test del Core
 * (`environment: "node"`) — se stubea un `self` fake (`postMessage`/
 * `addEventListener`) antes de importar el módulo (side-effects de carga:
 * auto-init + registro del listener "message", ver nota de cabecera de
 * `entry.ts`), y se ejercita el protocolo `WorkerInbound`/`WorkerOutbound`
 * end-to-end contra el ensamblador real (`../assembler.js`) con `pdf-lib`
 * mockeado (mismo criterio que `contract.test.ts`/`unit.test.ts` del
 * paquete y que `ner-engine/src/worker/__tests__/entry.test.ts`).
 *
 * A diferencia de PdfWorker (que corre el motor completo): acá el worker
 * SOLO corre el ensamblador pdf-lib — sin bus puente ni `ExportEngine`
 * instanciado (ADR-047 §1/§3). Estos tests NO cubren `export()` (validación,
 * loop, `RenderPageProvider`, retry/timeout, los cuatro eventos, blob URL):
 * eso vive host-side, cubierto por `contract.test.ts`/`unit.test.ts`/
 * `edge.test.ts`/`cancel.test.ts`. A diferencia de OCR/NER (kernels SIN
 * estado por documento): el ExportWorker SÍ retiene estado (`AssemblerState`
 * a nivel de módulo, un `PDFDocument` a la vez) — la mayoría de estos tests
 * ejercitan justamente esas reglas de estado (ADR-047 §4).
 */
import {
  EngineErrorCode,
  type ExportPagePayload,
  type ExportSavePayload,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Por el hoisting de Vitest, cada archivo de test declara su propio vi.mock
// (ver comentario en ../../__tests__/fixtures/test-helpers.ts).
vi.mock("pdf-lib", () => ({ PDFDocument: { create: vi.fn() } }));

import { asPdfDocument, createMockPdfLibDocument } from "../../__tests__/fixtures/test-helpers.js";

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

function appendPagePayload(overrides?: Partial<ExportPagePayload>): ExportPagePayload {
  return {
    documentId: "doc-worker",
    pageIndex: 0,
    pageImage: new Uint8Array([1, 2, 3, 4]).buffer,
    imageFormat: "jpeg",
    pageWidthPt: 100,
    pageHeightPt: 100,
    ...overrides,
  };
}

function savePagePayload(overrides?: Partial<ExportSavePayload>): ExportSavePayload {
  return {
    documentId: "doc-worker",
    metadata: { producer: "Anonly", creator: "Anonly", creationDate: new Date("2026-01-01") },
    ...overrides,
  };
}

describe("ExportWorker entry-point — ensamblador con estado (ADR-047 §3/§4)", () => {
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

  it("INIT vuelve a publicar READY", async () => {
    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
    fakeSelf.postMessage.mockClear();

    fakeSelf.emitMessage({ type: "INIT", config: {} });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "READY")).toBeDefined());
  });

  it("RUN(export-page) con un payload append-page responde COMPLETED (sin EVENT/LOG: sin bus puente)", async () => {
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(createMockPdfLibDocument()));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-append",
      signalId: "job-append",
      jobType: "export-page",
      payload: appendPagePayload(),
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "COMPLETED")).toBeDefined());
    const completed = outboundOfType(fakeSelf, "COMPLETED");
    expect(completed?.jobId).toBe("job-append");
    expect(completed?.result).toBeNull();

    // Sin bus/logger puente para eventos de dominio (nota de cabecera):
    // ningún mensaje EVENT/LOG.
    const eventOrLog = fakeSelf.postMessage.mock.calls
      .map((c) => c[0] as WorkerOutbound)
      .filter((m) => m.type === "EVENT" || m.type === "LOG");
    expect(eventOrLog).toEqual([]);
  });

  it("RUN(export-page) con un payload save responde COMPLETED con el ArrayBuffer final", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-page",
      signalId: "job-page",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-save" }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(1));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-save",
      signalId: "job-save",
      jobType: "export-page",
      payload: savePagePayload({ documentId: "doc-save" }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(2));

    const saveCompleted = outboundsOfType(fakeSelf, "COMPLETED")[1];
    expect(saveCompleted?.result).toBeInstanceOf(ArrayBuffer);
    expect((saveCompleted?.result as ArrayBuffer).byteLength).toBeGreaterThan(0);
    expect(mockDoc["save"]).toHaveBeenCalledTimes(1);
  });

  it("entry-point discriminates append-page vs save by payload shape (ADR-047 §3)", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-append",
      signalId: "job-append",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-discriminate" }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(1));
    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(1);
    expect(mockDoc["save"]).not.toHaveBeenCalled();

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-save",
      signalId: "job-save",
      jobType: "export-page",
      payload: savePagePayload({ documentId: "doc-discriminate" }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(2));
    expect(mockDoc["save"]).toHaveBeenCalledTimes(1);
    // El save no re-embebe: sigue en 1 desde el append-page de arriba.
    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(1);
  });

  it("entry-point rejects a jobType other than export-page", async () => {
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-bad-type",
      signalId: "job-bad-type",
      jobType: "render-page",
      payload: {},
    });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "FAILED")).toBeDefined());
    const failed = outboundOfType(fakeSelf, "FAILED");
    expect(failed?.jobId).toBe("job-bad-type");
    expect(failed?.error.code).toBe(EngineErrorCode.INVALID_INPUT);
    expect(PDFDocument.create).not.toHaveBeenCalled();
  });

  it("re-appending the same pageIndex does not duplicate the page (caso 18)", async () => {
    const mockDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValue(asPdfDocument(mockDoc));
    const payload = appendPagePayload({ documentId: "doc-idempotent", pageIndex: 0 });

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-1",
      signalId: "job-1",
      jobType: "export-page",
      payload,
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(1));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-2",
      signalId: "job-2",
      jobType: "export-page",
      payload,
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(2));

    // Ambos RUN responden COMPLETED, pero el segundo es un no-op idempotente:
    // no se re-embebe ni se dibuja de nuevo.
    expect(mockDoc["embedJpg"]).toHaveBeenCalledTimes(1);
    expect(mockDoc["addPage"]).toHaveBeenCalledTimes(1);
    expect((mockDoc["pages"] as unknown[]).length).toBe(1);
  });

  it("append-page with a new documentId discards the partial document (caso 19)", async () => {
    const firstDoc = createMockPdfLibDocument();
    const secondDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(asPdfDocument(firstDoc))
      .mockResolvedValueOnce(asPdfDocument(secondDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-doc-a",
      signalId: "job-doc-a",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-a", pageIndex: 0 }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(1));
    expect(firstDoc["addPage"]).toHaveBeenCalledTimes(1);

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-doc-b",
      signalId: "job-doc-b",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-b", pageIndex: 0 }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(2));

    // documentId distinto -> PDFDocument.create() se llama de nuevo (parcial
    // de doc-a descartado); firstDoc no recibe páginas adicionales.
    expect(PDFDocument.create).toHaveBeenCalledTimes(2);
    expect(secondDoc["addPage"]).toHaveBeenCalledTimes(1);
    expect(firstDoc["addPage"]).toHaveBeenCalledTimes(1);
  });

  it("CANCEL discards the partial PDFDocument and answers CANCELLED (caso 13)", async () => {
    const pendingDoc = createMockPdfLibDocument();
    // embedJpg nunca resuelve: simula un append-page en vuelo.
    (pendingDoc["embedJpg"] as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => undefined),
    );
    vi.mocked(PDFDocument.create).mockResolvedValueOnce(asPdfDocument(pendingDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-cancel",
      signalId: "job-cancel",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-cancel" }),
    });
    fakeSelf.emitMessage({ type: "CANCEL", jobId: "job-cancel", signalId: "job-cancel" });

    await vi.waitFor(() => expect(outboundOfType(fakeSelf, "CANCELLED")).toBeDefined());
    const cancelled = outboundOfType(fakeSelf, "CANCELLED");
    expect(cancelled?.jobId).toBe("job-cancel");
    expect(cancelled?.signalId).toBe("job-cancel");

    // El parcial quedó descartado: un append-page posterior para el MISMO
    // documentId/pageIndex crea un PDFDocument nuevo (segunda llamada a
    // PDFDocument.create) en vez de reusar el que tenía el embed pendiente.
    const freshDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create).mockResolvedValueOnce(asPdfDocument(freshDoc));
    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-after-cancel",
      signalId: "job-after-cancel",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-cancel" }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(1));
    expect(freshDoc["addPage"]).toHaveBeenCalledTimes(1);
    expect(PDFDocument.create).toHaveBeenCalledTimes(2);
  });

  it("CANCEL de un jobId desconocido es un no-op seguro", () => {
    expect(() =>
      fakeSelf.emitMessage({ type: "CANCEL", jobId: "no-existe", signalId: "no-existe" }),
    ).not.toThrow();
  });

  it("DISPOSE descarta el PDFDocument parcial; un RUN posterior arranca de cero", async () => {
    const firstDoc = createMockPdfLibDocument();
    const secondDoc = createMockPdfLibDocument();
    vi.mocked(PDFDocument.create)
      .mockResolvedValueOnce(asPdfDocument(firstDoc))
      .mockResolvedValueOnce(asPdfDocument(secondDoc));

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-before-dispose",
      signalId: "job-before-dispose",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-dispose" }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(1));
    expect(firstDoc["addPage"]).toHaveBeenCalledTimes(1);

    fakeSelf.emitMessage({ type: "DISPOSE" });

    fakeSelf.emitMessage({
      type: "RUN",
      jobId: "job-after-dispose",
      signalId: "job-after-dispose",
      jobType: "export-page",
      payload: appendPagePayload({ documentId: "doc-dispose" }),
    });
    await vi.waitFor(() => expect(outboundsOfType(fakeSelf, "COMPLETED").length).toBe(2));

    expect(PDFDocument.create).toHaveBeenCalledTimes(2);
    expect(secondDoc["addPage"]).toHaveBeenCalledTimes(1);
  });
});
