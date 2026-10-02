/**
 * `scanProgress.ts` — qué progreso muestra la pantalla de escaneo en cada
 * momento (`ui/UX_Guidelines.md` §7.3, ADR-152).
 *
 * **Regla dura (ADR-152 §2): el único total que se MUESTRA es
 * `document.store.pageCount`, en todas las etapas.** En un documento mixto
 * (20 páginas, 8 escaneadas) mostrar "3 de 8" sobre un documento que el
 * usuario sabe que tiene 20 se lee como "cargué el archivo equivocado", no
 * como "3 de las 8 que hay que leer" — y un usuario que ve un total que no
 * reconoce cancela justo cuando la herramienta está funcionando bien.
 *
 * Por etapa (la tabla completa de textos vive en `UX_Guidelines.md` §7.3;
 * acá solo lo normativo, qué se puede afirmar y con qué números):
 *
 * - `Importing`/`Extracting`: indeterminado — abrir el documento.
 * - `OCRing`: determinado. El **contador** que se muestra ("página X de Y")
 *   usa `X` = la última página que terminó de leerse (`OCR_PAGE_FINISHED`,
 *   +1) y `Y` = `pageCount` — **no** cuántas páginas se leyeron, sino cuál se
 *   está leyendo, numerada sobre el documento entero. La **barra**, en
 *   cambio, sí usa `current`/`total` de `pipeline.store` (el tamaño real del
 *   trabajo de OCR, `textlessPages.length + ocrRegions.length`): avanza
 *   pareja aunque los números de página salten (documento mixto, pendiente
 *   de validación con usuarios — `roadmap/Post_Hito10.8_Pendientes.md` §32).
 * - `Detecting` con el modelo cargando: indeterminado — preparar el
 *   detector. Gana sobre el stage: sin esto, `current/total` reporta 1/1
 *   durante la descarga y el contador afirmaría "1 de 1" con el documento
 *   entero todavía sin analizar.
 * - `Detecting` detectando: determinado, `X = current` e `Y = pageCount`
 *   (no `total`: es la misma trampa que la descarga del modelo, medida en el
 *   browser antes de ADR-087 §6).
 * - `Grouping`: indeterminado — ordenar los resultados.
 *
 * El contador nunca retrocede **dentro de una etapa** ni excede su
 * denominador (acotado por los dos lados); que vuelva a empezar **al cambiar
 * de etapa** es correcto: son dos trabajos distintos.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import { PipelineStage } from "@anonly/anonymization-core";

export interface ScanProgressInput {
  readonly stage: PipelineStage;
  /** `pipeline.store.current`, de la etapa vigente. Gobierna la barra en OCRing y Detecting. */
  readonly current: number;
  /** `pipeline.store.total`, de la etapa vigente. Gobierna la barra en OCRing (tamaño real del trabajo de OCR). */
  readonly total: number;
  /** `document.store.pageCount` — el único total que se MUESTRA (ADR-152 §2). */
  readonly pageCount: number;
  /** `pipeline.store.modelLoading?.progress`, o `null`. */
  readonly modelLoadingProgress: number | null;
  /** `pipeline.store.lastOcrPageIndex` — el `pageIndex` del último `OCR_PAGE_FINISHED`, o `null` si ninguno llegó todavía. */
  readonly lastOcrPageIndex: number | null;
}

export type ScanProgress =
  | { readonly kind: "indeterminate" }
  | {
      readonly kind: "determinate";
      readonly percent: number;
      /** `null` ⇒ barra sin contador de páginas. */
      readonly counter: { readonly current: number; readonly total: number } | null;
    };

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

/** Acota `value` por los dos lados contra `[0, max]` — nunca negativo, nunca por encima de su denominador. */
function clampCount(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

export function resolveScanProgress(input: ScanProgressInput): ScanProgress {
  const { stage, current, total, pageCount, modelLoadingProgress, lastOcrPageIndex } = input;

  if (modelLoadingProgress !== null) {
    /*
     * **Indeterminada, no 100%.** El progreso que reporta la carga del modelo
     * no mide nada: desde ADR-130 el modelo es un archivo local del
     * instalador, y Transformers.js informa la carga completa de una sola vez
     * — así que el valor llega siempre en 1 y la barra se dibujaba llena
     * mientras el modelo todavía se estaba preparando. Una barra al 100% que
     * no avanza es peor que una barra que no promete un número: la primera
     * parece colgada, la segunda dice la verdad.
     */
    return { kind: "indeterminate" };
  }

  if (stage === PipelineStage.OCRing && total > 0) {
    const percent = clampPercent((clampCount(current, total) / total) * 100);
    const counter =
      lastOcrPageIndex !== null && pageCount > 0
        ? { current: clampCount(lastOcrPageIndex + 1, pageCount), total: pageCount }
        : null;
    return { kind: "determinate", percent, counter };
  }

  if (stage === PipelineStage.Detecting && pageCount > 0) {
    // Acotado por los dos lados: evita un "12 de 10" con un contador
    // rezagado de la etapa anterior y un "-3 de 10" si el valor llega
    // corrupto.
    const scanned = clampCount(current, pageCount);
    return {
      kind: "determinate",
      percent: clampPercent((scanned / pageCount) * 100),
      counter: { current: scanned, total: pageCount },
    };
  }

  return { kind: "indeterminate" };
}
