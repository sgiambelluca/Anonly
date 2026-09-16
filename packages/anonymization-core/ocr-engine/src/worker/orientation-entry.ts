import { startWorkerEntry, type OcrOrientationPayload } from "@anonly/shared";

import { createOrientationKernel } from "./orientation-kernel.js";

const kernel = createOrientationKernel();

function isPayload(value: unknown): value is OcrOrientationPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OcrOrientationPayload>;
  return (
    typeof candidate.documentId === "string" &&
    typeof candidate.pageIndex === "number" &&
    typeof candidate.image === "object" &&
    candidate.image !== null &&
    typeof candidate.timeoutMs === "number" &&
    Array.isArray(candidate.languages)
  );
}

startWorkerEntry({
  workerId: "ocr-orientation",
  jobType: "ocr-orient",
  capabilities: { maxPageBatchSize: 1 },
  run(payload, ctx) {
    if (!isPayload(payload)) throw new Error("Payload inválido para ocr-orient.");
    return kernel.detect(payload, ctx.abortSignal);
  },
  dispose() {
    void kernel.dispose();
  },
});
