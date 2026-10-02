import {
  EngineErrorCode,
  type OcrOrientationPayload,
  type WorkerInbound,
  type WorkerOutbound,
} from "@anonly/shared";
import { createWorker } from "tesseract.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(),
  OEM: { TESSERACT_ONLY: 0 },
}));

import {
  createEncodedPageImage,
  mockDetectData,
  mockTesseractWorker,
} from "./fixtures/test-helpers.js";

interface FakeSelf {
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly emit: (message: WorkerInbound) => void;
}

function createFakeSelf(): FakeSelf {
  let listener: ((event: { readonly data: WorkerInbound }) => void) | undefined;
  const postMessage = vi.fn();
  const addEventListener = vi.fn((_type: string, handler: (event: unknown) => void) => {
    listener = (event) => handler(event);
  });
  return {
    postMessage,
    addEventListener,
    emit(message): void {
      listener?.({ data: message });
    },
  };
}

function messagesOfType<T extends WorkerOutbound["type"]>(
  self: FakeSelf,
  type: T,
): Array<Extract<WorkerOutbound, { readonly type: T }>> {
  return self.postMessage.mock.calls
    .map((call) => call[0])
    .filter(
      (message): message is Extract<WorkerOutbound, { readonly type: T }> =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === type,
    );
}

function orientationPayload(): OcrOrientationPayload {
  return {
    documentId: "orientation-entry",
    pageIndex: 2,
    image: createEncodedPageImage(100, 40),
    languages: ["spa", "eng"],
    timeoutMs: 1000,
  };
}

describe("orientation worker entry", () => {
  let fakeSelf: FakeSelf;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    fakeSelf = createFakeSelf();
    vi.stubGlobal("self", fakeSelf);
    await import("../worker/orientation-entry.js");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("orientation entry decodes reduced and returns only its validated angle", async () => {
    const detect = vi.fn(() => Promise.resolve(mockDetectData(270)));
    vi.mocked(createWorker).mockResolvedValue(
      mockTesseractWorker({ confidence: 90, blocks: [] }, { detect }),
    );
    fakeSelf.emit({
      type: "RUN",
      jobId: "orientation-job",
      signalId: "orientation-job",
      jobType: "ocr-orient",
      payload: orientationPayload(),
    });

    await vi.waitFor(() => expect(messagesOfType(fakeSelf, "COMPLETED")).toHaveLength(1));
    const completed = messagesOfType(fakeSelf, "COMPLETED")[0];
    expect(completed?.result).toEqual({ orientation: 270, inkRatio: 1, osdHadVerdict: true });
    expect(createWorker).toHaveBeenCalledWith(
      ["osd"],
      0,
      expect.objectContaining({ legacyCore: true }),
    );
  });

  // Code_Standards.md §7: un payload con forma inválida tiene que responder
  // FAILED con un `EngineError` tipado (INVALID_INPUT) — nunca un `Error`
  // genérico, que `startWorkerEntry` no sabe serializar con `code`/`engineId`.
  it("responds FAILED with INVALID_INPUT on a malformed ocr-orient payload", async () => {
    fakeSelf.emit({
      type: "RUN",
      jobId: "orientation-bad-payload",
      signalId: "orientation-bad-payload",
      jobType: "ocr-orient",
      payload: { documentId: "orientation-entry" }, // sin pageIndex/image/timeoutMs/languages
    });

    await vi.waitFor(() => expect(messagesOfType(fakeSelf, "FAILED")).toHaveLength(1));
    const failed = messagesOfType(fakeSelf, "FAILED")[0];
    expect(failed?.jobId).toBe("orientation-bad-payload");
    expect(failed?.error.code).toBe(EngineErrorCode.INVALID_INPUT);
    expect(createWorker).not.toHaveBeenCalled();
    // Discriminante (ADR-149 §2): `startWorkerEntry` envuelve CUALQUIER
    // `Error` no tipado en un `InvalidInputError` genérico sin `details`
    // (`shared/src/worker-entry.ts`), así que el `code` solo no distingue el
    // guard de acá de un `throw new Error(...)` sin arreglar. `details`
    // sí: solo el guard tipado de `orientation-entry.ts` los adjunta.
    expect(failed?.error.details).toEqual({ jobType: "ocr-orient" });
  });
});
