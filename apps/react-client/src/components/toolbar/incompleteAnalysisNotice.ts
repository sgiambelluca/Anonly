/**
 * `degradationNotice.ts` — el aviso de "terminó, pero incompleto".
 *
 * **Por qué existe.** Cuando un worker de un motor se cae, el pool rechaza
 * ese job pero el pipeline sigue: `NER_FINISHED` se emite igual, con
 * `occurrenceCount: 0`, y detrás va `PIPELINE_READY`. Nada de eso es un
 * `PIPELINE_FAILED`, así que `pipelineErrorPresentation.ts` no aplica y la
 * toolbar dice **"Listo"** sobre un documento en el que no se detectó nada.
 *
 * Medido el 2026-08-28 sobre una pericia real: los 11 jobs de `ner-page`
 * fallaron con `WORKER_CRASHED` en 10 ms cada uno, y la app mostró "Listo,
 * Exportar" con un único grupo —una patente que encontró Regex— sin un solo
 * cartel. En una herramienta de privacidad ese es el peor modo de falla que
 * existe: **silencioso y con cara de éxito**. El usuario exporta creyendo que
 * anonimizó, y publica los nombres.
 *
 * `OCR_PAGE_FAILED` entra en el mismo aviso: hasta este cambio no estaba
 * suscrito a ningún store (gap conocido y anotado desde el PR5 del Hito 10),
 * así que un escaneo cuyo OCR falla entero llegaba igual a "Listo" sin texto.
 *
 * Módulo puro, sin React: los tests de `apps/react-client` corren en Node sin
 * jsdom (mismo criterio que `pipelineStageLabel.ts` y `layoutMode.ts`).
 */

import { PipelineStage, type WorkerJobType } from "@anonly/anonymization-core";

/** Cuántos jobs fallaron, por tipo. Ausente = ninguno falló. */
export type FailedJobs = Readonly<Partial<Record<WorkerJobType, number>>>;

export interface IncompleteAnalysisNotice {
  readonly message: string;
  /**
   * `true` si lo que falló pudo **dejar datos sensibles sin detectar**. Separa
   * "la vista previa salió fea" de "puede haber nombres sin tapar", que para
   * esta herramienta no son el mismo problema ni merecen el mismo tono.
   */
  readonly affectsDetection: boolean;
}

/**
 * Qué perdió el usuario, en su idioma. No nombra motores ni códigos
 * (`ADR-087` §4): "nombres", no "NER"; "texto de las imágenes", no "OCR".
 */
const CONSEQUENCE_BY_JOB: Readonly<Partial<Record<WorkerJobType, string>>> = {
  "ner-page": "los nombres de personas y organizaciones",
  "ocr-page": "el texto de las páginas escaneadas",
};

/** Los que no comprometen la detección: molestan, pero no esconden datos. */
const COSMETIC_BY_JOB: Readonly<Partial<Record<WorkerJobType, string>>> = {
  "render-page": "la vista previa de algunas páginas",
};

/**
 * Solo en stages terminales: mientras el pipeline corre, un job caído todavía
 * puede recuperarse por reintento (`WorkerCrashedError` es `retryable`,
 * ADR-077), y avisar de algo que se va a arreglar solo es ruido.
 */
const TERMINAL_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Ready,
  PipelineStage.Done,
]);

function listar(partes: ReadonlyArray<string>): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} ni ${partes[partes.length - 1]}`;
}

/** `null` si no hay nada que avisar. */
export function getIncompleteAnalysisNotice(
  stage: PipelineStage,
  failedJobs: FailedJobs,
): IncompleteAnalysisNotice | null {
  if (!TERMINAL_STAGES.has(stage)) return null;

  const fallado = (job: WorkerJobType): boolean => (failedJobs[job] ?? 0) > 0;

  const deteccion = (Object.keys(CONSEQUENCE_BY_JOB) as WorkerJobType[])
    .filter(fallado)
    .map((job) => CONSEQUENCE_BY_JOB[job] as string);

  if (deteccion.length > 0) {
    return {
      // Dice qué pasó, qué significa y qué hacer — un cartel sin salida no es
      // una ayuda (`UX_Guidelines.md` §9 "error-recovery").
      message:
        `El análisis terminó incompleto: no se pudo revisar ${listar(deteccion)}. ` +
        `Puede haber datos sensibles sin detectar. Recargá la página y probá de nuevo ` +
        `antes de exportar.`,
      affectsDetection: true,
    };
  }

  const cosmetico = (Object.keys(COSMETIC_BY_JOB) as WorkerJobType[])
    .filter(fallado)
    .map((job) => COSMETIC_BY_JOB[job] as string);

  if (cosmetico.length > 0) {
    return {
      message: `No se pudo generar ${listar(cosmetico)}. La detección no se vio afectada.`,
      affectsDetection: false,
    };
  }

  return null;
}
