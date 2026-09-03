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

  it("maps WORKER_CRASHED to a message a person can act on", () => {
    // La regresión concreta: hasta este cambio no había fila para
    // WORKER_CRASHED (ADR-077) y el `?? error.message` filtraba el string
    // interno del pool a la pantalla del usuario.
    const interno = "WorkerPool(render): worker (slot 0) emitió un error de transporte.";
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.WORKER_CRASHED, message: interno }),
    );

    expect(presentation?.message).not.toBe(interno);
    expect(presentation?.message).not.toMatch(/WorkerPool|slot|transporte/);
    expect(presentation).toEqual({
      message:
        "Se interrumpió uno de los procesos que analizan el documento. Recargá la página y probá de nuevo.",
    });
  });

  it("maps PDF_INVALID to its specific message", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.PDF_INVALID }),
    );
    expect(presentation).toEqual({
      message: "El archivo no es un PDF válido. Probá con otro documento.",
    });
  });

  /*
   * ADR-126 §2: este error NO ofrece continuar. El botón "Seguir sin detectar
   * nombres" producía un documento que se exporta como anonimizado con todos
   * los nombres intactos — un resultado equivocado con cara de éxito, que es
   * peor que no poder analizar. La salida es reintentar, y el mensaje lo dice.
   */
  it("maps NER_MODEL_MISSING to a message that says to retry, never to continue without names", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.NER_MODEL_MISSING }),
    );
    // ADR-087 §4: el mensaje describe el efecto, no la etapa del pipeline.
    // Se afirma que **no** dice "NER" para que no vuelva a colarse.
    expect(presentation?.message).toMatch(/detector de nombres/);
    expect(presentation?.message).not.toMatch(/NER/);
    expect(presentation?.message).toMatch(/no se puede analizar completo/);
    // La regresión que importa: ninguna variante de "podés seguir sin".
    expect(presentation?.message).not.toMatch(/[Pp]odés seguir|[Ss]eguir sin/);
  });

  it("maps EXPORT_FAILED to its specific message", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.EXPORT_FAILED }),
    );
    expect(presentation).toEqual({
      message: "No se pudo exportar el documento. Probá de nuevo.",
    });
  });

  it("falls back to the generic error message for unmapped codes", () => {
    const presentation = getPipelineErrorPresentation(
      PipelineStage.Failed,
      makeError({ code: EngineErrorCode.PDF_CORRUPTED, message: "corrupted stream" }),
    );
    expect(presentation).toEqual({
      message: "corrupted stream",
    });
  });
});
