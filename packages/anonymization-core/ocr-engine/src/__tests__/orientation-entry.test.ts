import {
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
    expect(completed?.result).toEqual({ orientation: 270 });
    expect(createWorker).toHaveBeenCalledWith(
      ["osd"],
      0,
      expect.objectContaining({ legacyCore: true }),
    );
  });
});
