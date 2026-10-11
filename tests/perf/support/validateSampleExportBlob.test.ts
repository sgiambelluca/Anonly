import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installV1ExportBlobReaderInPage,
  readV1ExportBlobInPage,
  restoreV1ExportBlobReaderInPage,
} from "./validateSampleExportBlob.js";

afterEach(() => {
  restoreV1ExportBlobReaderInPage();
  vi.restoreAllMocks();
});

describe("M-V1 transparent memory-only export Blob reference", () => {
  it("forwards the exact argument and receiver, returns the unchanged native URL and retains PDF only", () => {
    const receivers: unknown[] = [];
    const original = vi.spyOn(URL, "createObjectURL").mockImplementation(function (
      this: typeof URL,
    ) {
      receivers.push(this);
      return "blob:synthetic-reference";
    });
    installV1ExportBlobReaderInPage();
    const image = new Blob([new Uint8Array([1])], { type: "image/png" });
    expect(URL.createObjectURL(image)).toBe("blob:synthetic-reference");
    expect(globalThis.__anonlyV1ExportBlobReader?.blobs.size).toBe(0);
    const pdf = new Blob([new Uint8Array([0, 127, 128, 255])], { type: "application/pdf" });
    expect(URL.createObjectURL(pdf)).toBe("blob:synthetic-reference");
    expect(original).toHaveBeenNthCalledWith(1, image);
    expect(original).toHaveBeenNthCalledWith(2, pdf);
    expect(receivers).toEqual([URL, URL]);
    const retained = globalThis.__anonlyV1ExportBlobReader?.blobs;
    expect(retained?.get("blob:synthetic-reference")).toBe(pdf);
    restoreV1ExportBlobReaderInPage();
    expect(URL.createObjectURL).toBe(original);
    expect(retained?.size).toBe(0);
    expect(globalThis.__anonlyV1ExportBlobReader).toBeUndefined();
  });
  it("transfers binary bytes exactly from the matching href without fetch or download", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-exact");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    installV1ExportBlobReaderInPage();
    const expected = Buffer.from([0, 127, 128, 255, 37, 80, 68, 70]);
    const href = URL.createObjectURL(new Blob([expected], { type: "application/pdf" }));
    const value = await readV1ExportBlobInPage({ href, expectedBytes: expected.length });
    expect(Buffer.from(value, "base64").equals(expected)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("rejects a mismatched href/length and restores all state after a binary read failure", async () => {
    const original = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-error");
    installV1ExportBlobReaderInPage();
    const pdf = new Blob([new Uint8Array([0, 127, 128, 255])], { type: "application/pdf" });
    const href = URL.createObjectURL(pdf);
    await expect(readV1ExportBlobInPage({ href: "blob:wrong", expectedBytes: 4 })).rejects.toThrow(
      "reference missing",
    );
    await expect(readV1ExportBlobInPage({ href, expectedBytes: 5 })).rejects.toThrow(
      "length mismatch",
    );
    vi.spyOn(pdf, "arrayBuffer").mockRejectedValue(new Error("synthetic-read-failure"));
    const retained = globalThis.__anonlyV1ExportBlobReader?.blobs;
    try {
      await expect(readV1ExportBlobInPage({ href, expectedBytes: 4 })).rejects.toThrow(
        "synthetic-read-failure",
      );
    } finally {
      restoreV1ExportBlobReaderInPage();
    }
    expect(URL.createObjectURL).toBe(original);
    expect(retained?.size).toBe(0);
    expect(globalThis.__anonlyV1ExportBlobReader).toBeUndefined();
  });
  it("preserves a native creation failure and permits idempotent restoration", () => {
    const failure = new Error("synthetic-creation-failure");
    const original = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw failure;
    });
    installV1ExportBlobReaderInPage();
    try {
      expect(() => URL.createObjectURL(new Blob([], { type: "application/pdf" }))).toThrow(failure);
    } finally {
      restoreV1ExportBlobReaderInPage();
    }
    expect(URL.createObjectURL).toBe(original);
    expect(() => restoreV1ExportBlobReaderInPage()).not.toThrow();
  });
});
