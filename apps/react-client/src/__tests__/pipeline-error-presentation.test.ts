import {
  EngineErrorCode,
  PipelineStage,
  type SerializedEngineError,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { getPipelineErrorPresentation } from "../components/toolbar/pipelineErrorPresentation.js";

function makeError(overrides: Partial<SerializedEngineError> = {}): SerializedEngineError {
  return {
    code: EngineErrorCode.PDF_INVALID,
    engineId: "core",
    message: "boom",
    retryable: false,
    details: {},
    ...overrides,
  };
}

describe("getPipelineErrorPresentation", () => {
  it("returns null when stage is not Failed, regardless of error", () => {
    expect(getPipelineErrorPresentation(PipelineStage.Ready, makeError())).toBeNull();
    expect(getPipelineErrorPresentation(PipelineStage.Detecting, makeError())).toBeNull();
  });

  it("returns null when stage is Failed but there is no serialized error", () => {
    expect(getPipelineErrorPresentation(PipelineStage.Failed, null)).toBeNull();
  });

  it("maps PDF_INVALID to its specific message", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.PDF_INVALID }),
    );
    expect(presentation).toEqual({
      message: "El archivo no es un PDF válido. Probá con otro documento.",
      offerDisableNerReanalyze: false,
    });
  });

  it("maps NER_MODEL_MISSING to its specific message and offers the disable-NER action", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.NER_MODEL_MISSING }),
    );
    expect(presentation?.offerDisableNerReanalyze).toBe(true);
    // ADR-087 §4: el mensaje describe el efecto, no la etapa del pipeline.
    // Se afirma que **no** dice "NER" para que no vuelva a colarse.
    expect(presentation?.message).toMatch(/detector de nombres/);
    expect(presentation?.message).not.toMatch(/NER/);
  });

  it("maps EXPORT_FAILED to its specific message", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.EXPORT_FAILED }),
    );
    expect(presentation).toEqual({
      message: "No se pudo exportar el documento. Probá de nuevo.",
      offerDisableNerReanalyze: false,
    });
  });

  it("falls back to the generic error message for unmapped codes", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.PDF_CORRUPTED, message: "corrupted stream" }),
    );
    expect(presentation).toEqual({
      message: "corrupted stream",
      offerDisableNerReanalyze: false,
    });
  });
});
