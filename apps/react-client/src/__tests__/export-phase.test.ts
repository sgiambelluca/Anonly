import { describe, expect, it } from "vitest";

import { resolveExportPhase } from "../components/export/exportPhase.js";

describe("resolveExportPhase", () => {
  it("is 'form' when nothing was submitted yet, regardless of leftover store state", () => {
    expect(resolveExportPhase(false, null, false)).toBe("form");
    expect(resolveExportPhase(false, { blobUrl: "blob:x", sizeBytes: 10 }, true)).toBe("form");
  });

  it("is 'progress' when submitted and no result/error arrived yet", () => {
    expect(resolveExportPhase(true, null, false)).toBe("progress");
  });

  it("is 'error' when submitted and an error is present without a result", () => {
    expect(resolveExportPhase(true, null, true)).toBe("error");
  });

  it("is 'done' when a result is present, even if a stale error is also present", () => {
    expect(resolveExportPhase(true, { blobUrl: "blob:x", sizeBytes: 10 }, false)).toBe("done");
    // Un reintento exitoso después de un fallo previo: pipeline.store.error
    // puede seguir poblado (nada lo limpia en éxito), pero el resultado manda.
    expect(resolveExportPhase(true, { blobUrl: "blob:x", sizeBytes: 10 }, true)).toBe("done");
  });
});
