/**
 * `scanProgress.ts` — qué progreso muestra la pantalla de escaneo en cada
 * momento (`ui/UX_Guidelines.md` §7.3).
 *
 * **El contador por página cuenta el escaneo del documento, y nada más.** Es
 * decir: solo corre en `Detecting`, que es cuando de verdad se recorre el
 * documento buscando datos.
 *
 * Antes corría también en `Extracting` y `OCRing`, y eso producía la secuencia
 * que el humano reportó: el contador llegaba a **"10 de 10" antes de haber
 * detectado nada**, y después volvía a "1 de 10" cuando arrancaba la
 * detección. Dos recorridos completos del mismo número para dos cosas
 * distintas — el primero decía "terminé" sobre un trabajo que el usuario ni
 * siquiera considera el trabajo.
 *
 * Las etapas de preparación (abrir, leer el texto, reconocer imágenes) pasan a
 * **indeterminado**: hay movimiento, no hay número. Es lo honesto — están
 * trabajando, pero su progreso no es el progreso que la pantalla promete.
 *
 * La descarga del modelo es la excepción: tiene un porcentaje real y propio
 * (cuánto se bajó), así que se muestra determinado **sin contador de páginas**
 * — no hay páginas que contar todavía.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import { PipelineStage } from "@anonly/anonymization-core";

export interface ScanProgressInput {
  readonly stage: PipelineStage;
  /** `pipeline.store.current`, de la etapa vigente. */
  readonly current: number;
  /** `document.store.pageCount`. Ver `scanAdvance.ts` para por qué no `total`. */
  readonly pageCount: number;
  /** `pipeline.store.modelLoading?.progress`, o `null`. */
  readonly modelLoadingProgress: number | null;
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

export function resolveScanProgress(input: ScanProgressInput): ScanProgress {
  const { stage, current, pageCount, modelLoadingProgress } = input;

  if (modelLoadingProgress !== null) {
    return {
      kind: "determinate",
      percent: clampPercent(modelLoadingProgress * 100),
      counter: null,
    };
  }

  if (stage === PipelineStage.Detecting && pageCount > 0) {
    // Acotado por los dos lados: `Math.min` evita un "12 de 10" con un
    // contador rezagado de la etapa anterior, y `Math.max` evita un "-3 de 10"
    // si el valor llega corrupto. Ninguno de los dos debería pasar; los dos
    // son baratos y el costo de equivocarse es un número absurdo en pantalla.
    const scanned = Math.max(0, Math.min(current, pageCount));
    return {
      kind: "determinate",
      percent: clampPercent((scanned / pageCount) * 100),
      counter: { current: scanned, total: pageCount },
    };
  }

  return { kind: "indeterminate" };
}
