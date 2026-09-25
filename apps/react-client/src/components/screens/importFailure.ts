/**
 * `importFailure.ts` — un fallo de importación vuelve a la zona de carga
 * (ADR-168 §4, `UX_Guidelines.md` §7.2/§7.5).
 *
 * **Qué es un fallo de importación**: un `PIPELINE_FAILED` cuya última etapa
 * observada fue `Importing` o `Extracting` — el documento todavía no tiene
 * páginas que revisar (p. ej. `PDF_INVALID`). La UI lo decide con lo que ya
 * tiene: `pipeline.store.failedAtStage`. Sin cambio de contrato.
 *
 * Cualquier otro `Failed` (`OCRing`, `Detecting`, `Grouping`) y todo
 * `Cancelled` siguen pasando a ②b, donde sí hay documento. Si algún día el
 * Orchestrator emite `Failed` sin haber pasado por la etapa en curso,
 * `failedAtStage` queda `null` y la clasificación cae al caso conservador
 * (banner en ②b), que es el comportamiento anterior a ADR-168 (ADR-168,
 * "En contra").
 *
 * **Cómo viaja el error hasta la `DropZone`.** Volver a ① es cerrar el
 * documento (`actions.closeDocument`), y cerrar resetea `pipeline.store` — el
 * error se perdería en el camino. Se deja acá, en un buzón de una sola
 * lectura, mismo criterio que `common/toast.ts`: es un evento efímero con un
 * solo consumidor (`LoadScreen`, que lo toma al montarse), no estado de la
 * aplicación que merezca un slice.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import { PipelineStage, type SerializedEngineError } from "@anonly/anonymization-core";

import { getPipelineErrorPresentation } from "../toolbar/pipelineErrorPresentation.js";

import { shouldAdvanceFromScan, type ScanAdvanceParams } from "./scanAdvance.js";

/** Las dos etapas en las que el documento todavía no tiene nada que revisar. */
const IMPORT_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Importing,
  PipelineStage.Extracting,
]);

/** `true` si el pipeline falló antes de tener páginas (ADR-168 §4). */
export function isImportFailure(
  stage: PipelineStage,
  failedAtStage: PipelineStage | null,
): boolean {
  return (
    stage === PipelineStage.Failed && failedAtStage !== null && IMPORT_STAGES.has(failedAtStage)
  );
}

/**
 * Qué registra el bridge en `failedAtStage` al llegar `PIPELINE_FAILED`: el
 * `stage` que el store tenía en ese momento. Si ya estaba en `Failed` (un
 * segundo aviso), se conserva lo que ya se había registrado — `Failed` no es
 * una etapa previa a sí mismo.
 */
export function resolveFailedAtStage(
  stageBeforeFailure: PipelineStage,
  previousFailedAtStage: PipelineStage | null,
): PipelineStage | null {
  if (stageBeforeFailure === PipelineStage.Failed) return previousFailedAtStage;
  return stageBeforeFailure;
}

/**
 * Adónde sale la pantalla de escaneo (ADR-150 + ADR-168 §4):
 * - `"load"`: fallo de importación → se cierra el documento y se vuelve a ①.
 * - `"work"`: la regla de `scanAdvance.ts` dice que ya se puede pasar a ②b.
 * - `"stay"`: se queda en ②a.
 */
export type ScanExit = "stay" | "work" | "load";

export function resolveScanExit(
  params: ScanAdvanceParams & { readonly failedAtStage: PipelineStage | null },
): ScanExit {
  if (isImportFailure(params.stage, params.failedAtStage)) return "load";
  return shouldAdvanceFromScan(params) ? "work" : "stay";
}

/** Lo que la `DropZone` muestra en su estado de error. */
export interface DropZoneError {
  /** Nombre del archivo que no se pudo abrir, o `null` si no se conoce. */
  readonly fileName: string | null;
  /** El motivo, en lenguaje del usuario (ADR-087 §4). */
  readonly message: string;
}

/** Mensaje para un archivo que ni siquiera parece un PDF (rechazo local, sin pipeline). */
export const NOT_A_PDF_MESSAGE = "No es un archivo PDF. Elegí un documento .pdf.";

/** Mensaje de respaldo si el `PIPELINE_FAILED` llegó sin error serializado. */
const FALLBACK_MESSAGE = "El archivo no se pudo abrir. Probá con otro documento.";

/**
 * El error de un fallo de importación, con el motivo que ya arma
 * `pipelineErrorPresentation.ts` (el mismo texto que antes mostraba el banner
 * de ②b).
 */
export function describeImportFailure(
  fileName: string | null,
  error: SerializedEngineError | null,
): DropZoneError {
  const presentation = getPipelineErrorPresentation(PipelineStage.Failed, error);
  return { fileName, message: presentation?.message ?? FALLBACK_MESSAGE };
}

let pending: DropZoneError | null = null;

/** Deja el error para la próxima `LoadScreen` que se monte. */
export function recordImportFailure(error: DropZoneError): void {
  pending = error;
}

/**
 * Lee el error pendiente sin consumirlo. **Leer y vaciar van separados** a
 * propósito: React (en `StrictMode`) invoca dos veces el inicializador de
 * `useState`, así que un "tomar y vaciar" ahí devolvía el error en la primera
 * llamada y `null` en la que queda — la `DropZone` volvía en reposo. La
 * pantalla lee acá al montarse y vacía en un efecto (`clearImportFailure`).
 */
export function peekImportFailure(): DropZoneError | null {
  return pending;
}

/** Vacía el buzón: el error se muestra una vez, no en cada vuelta a ①. */
export function clearImportFailure(): void {
  pending = null;
}
