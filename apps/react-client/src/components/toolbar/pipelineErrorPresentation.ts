/**
 * `pipelineErrorPresentation.ts` — enrutamiento de errores para `PipelineStatus`
 * (`ui/React_Client.md` §8, filas `PIPELINE_FAILED` / `PDF_INVALID` /
 * `PIPELINE_FAILED con error.code === "NER_MODEL_MISSING"` / `EXPORT_FAILED`).
 *
 * Decisión de este PR: las cuatro filas de §8 que aplican acá comparten la
 * MISMA señal de store (`pipeline.stage === Failed` + `pipeline.error`) — el
 * bus-bridge de PR5 no distingue "toast" de "banner" en el store, y
 * `PDF_INVALID`/`EXPORT_FAILED` siempre llegan como `PIPELINE_FAILED` (ver
 * comentarios de `core-adapter/bus-bridge.ts` y `core/Orchestrator.md` §13
 * caso 4 para `PDF_INVALID`; `EXPORT_FAILED` con reintento agotado encadena a
 * `PIPELINE_FAILED`, `06_Pipeline.md` §13). Por eso se implementa como un único
 * banner persistente con mensaje específico por `error.code`, en vez de un
 * sistema de toasts efímeros separado (Radix `Toast.Provider`/`Viewport`, cola,
 * auto-dismiss) que no está especificado en ningún doc y que ninguno de los
 * componentes de este PR requiere de forma aislada.
 *
 * `OCR_PAGE_FAILED` (evento) queda **fuera** de esta función a propósito: el
 * bus-bridge de PR5 no lo suscribe a ningún store (no hay `pageIndex` ni
 * `error` disponibles para ese caso) — reportado como ambigüedad/gap en el
 * reporte del PR, no implementado acá.
 */

import {
  EngineErrorCode,
  PipelineStage,
  type SerializedEngineError,
} from "@anonly/anonymization-core";

export interface PipelineErrorPresentation {
  readonly message: string;
  /** `true` solo para `NER_MODEL_MISSING`: ofrece "Seguir sin detectar nombres" (React_Client.md §8, §3.7). */
  readonly offerDisableNerReanalyze: boolean;
}

/**
 * Mensajes en lenguaje del usuario (ADR-087 §4): no nombran "NER" ni explican
 * cómo se distribuyen los modelos. **Cada uno dice qué pasó y qué se puede
 * hacer** — un mensaje de error sin salida es un cartel, no una ayuda
 * (`UX_Guidelines.md` §9 "error-recovery"). La salida de
 * `NER_MODEL_MISSING` es el botón que ofrece `offerDisableNerReanalyze`.
 */
const MESSAGE_BY_CODE: Readonly<Partial<Record<EngineErrorCode, string>>> = {
  [EngineErrorCode.PDF_INVALID]: "El archivo no es un PDF válido. Probá con otro documento.",
  [EngineErrorCode.NER_MODEL_MISSING]:
    "No se pudo cargar el detector de nombres. Podés seguir sin él: se van a detectar los datos con formato conocido (DNI, CUIT, emails, teléfonos), pero no los nombres ni las organizaciones.",
  [EngineErrorCode.EXPORT_FAILED]: "No se pudo exportar el documento. Probá de nuevo.",
};

/**
 * `null` si no corresponde mostrar nada (stage distinto de `Failed`, o sin
 * error serializado — no debería ocurrir según el contrato de `PipelineFailed`,
 * pero se maneja de forma defensiva).
 */
export function getPipelineErrorPresentation(
  stage: PipelineStage,
  error: SerializedEngineError | null,
): PipelineErrorPresentation | null {
  if (stage !== PipelineStage.Failed || error === null) return null;

  return {
    message: MESSAGE_BY_CODE[error.code] ?? error.message,
    offerDisableNerReanalyze: error.code === EngineErrorCode.NER_MODEL_MISSING,
  };
}
