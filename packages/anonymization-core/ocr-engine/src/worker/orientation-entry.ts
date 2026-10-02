import { InvalidInputError, startWorkerEntry, type OcrOrientationPayload } from "@anonly/shared";

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
    // Code_Standards.md §7: prohibido lanzar `Error` genérico — toda
    // excepción del Core es una subclase de `EngineError` con `code`,
    // `engineId` y `details` (mismo criterio que `ocr.engine.ts` para
    // cualquier input malformado, ADR-049).
    if (!isPayload(payload)) {
      throw new InvalidInputError("Payload inválido para ocr-orient.", { jobType: "ocr-orient" });
    }
    return kernel.detect(payload, ctx.abortSignal);
  },
  dispose() {
    void kernel.dispose();
  },
});
