/**
 * `scanAdvance.ts` — cuándo la pantalla de escaneo (②a) suelta al usuario en
 * el panel de trabajo (②b).
 *
 * Fuente de verdad: `ui/UX_Guidelines.md` §7.2, ADR-087 §6.
 *
 * Lógica separada de React a propósito, mismo criterio que
 * `readyRenderTrigger.ts`/`visibleRange.ts`: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom), así que lo que no está
 * en un módulo puro no se testea.
 *
 * **Por qué el umbral de páginas se mide sobre `Detecting` y no sobre "el
 * documento"**: el tracker de progreso del Orchestrator se reasigna al entrar
 * a cada etapa con progreso granular (`orchestrator.ts`: "OCR, luego Detecting
 * con NER activo"), así que `current`/`total` significan cosas distintas según
 * el stage. Promediarlos daría un porcentaje que no corresponde a ninguna
 * etapa real, y `Detecting` es además la etapa larga y la que produce la
 * mayoría de las entidades.
 *
 * **Por qué el piso y el techo son globales (desde el import) y no relativos a
 * `Detecting`**: la descarga del modelo NER (`modelLoading`, solo la primera
 * vez) es tiempo muerto anterior a `Detecting`, sin entidades apareciendo. Un
 * techo medido desde `Detecting` dejaría al usuario sin cota mirando
 * "preparando el detector". Con el techo global ese caso entra a ②b con el
 * árbol vacío y el estado honesto de `UX_Guidelines.md` §7.1.
 */

import { PipelineStage } from "@anonly/anonymization-core";

/** Fracción de páginas analizadas en `Detecting` que basta para soltar. */
export const SCAN_ADVANCE_PAGE_RATIO = 0.2;
/** Techo global desde el import: nadie espera más que esto. */
export const SCAN_ADVANCE_MAX_MS = 6000;
/** Piso global desde el import: un PDF chico no hace parpadear la pantalla. */
export const SCAN_ADVANCE_MIN_MS = 1200;

/**
 * Stages en los que el pipeline ya terminó (con o sin éxito) y no hay más
 * escaneo que mostrar: la pantalla de escaneo sale sin esperar al piso. El
 * piso existe para que una transición rápida no parpadee, no para retener al
 * usuario frente a un error.
 */
const TERMINAL_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Ready,
  PipelineStage.Done,
  PipelineStage.Failed,
  PipelineStage.Cancelled,
]);

export interface ScanAdvanceParams {
  readonly stage: PipelineStage;
  /** Páginas ya procesadas por la etapa vigente (`pipeline.store.current`). */
  readonly current: number;
  /** Total de páginas de la etapa vigente (`pipeline.store.total`). */
  readonly total: number;
  /** Milisegundos transcurridos desde el import. */
  readonly elapsedMs: number;
}

/**
 * `true` si corresponde pasar de la pantalla de escaneo al panel de trabajo.
 *
 * Regla (`UX_Guidelines.md` §7.2): se pasa con **la primera** de — `Detecting`
 * procesó `SCAN_ADVANCE_PAGE_RATIO` de las páginas, o transcurrió
 * `SCAN_ADVANCE_MAX_MS` — y **nunca** antes de `SCAN_ADVANCE_MIN_MS`, salvo
 * que el pipeline ya haya terminado.
 */
export function shouldAdvanceFromScan(params: ScanAdvanceParams): boolean {
  const { stage, current, total, elapsedMs } = params;

  // El pipeline terminó: no hay nada más que mostrar acá, y retener al usuario
  // frente a un `Failed` para cumplir el piso sería retenerlo sobre un error.
  if (TERMINAL_STAGES.has(stage)) return true;

  if (elapsedMs < SCAN_ADVANCE_MIN_MS) return false;
  if (elapsedMs >= SCAN_ADVANCE_MAX_MS) return true;

  return hasDetectedEnoughPages(stage, current, total);
}

/**
 * El umbral de páginas, aislado porque es la mitad de la regla que depende del
 * stage. `total <= 0` es el arranque de la etapa (el Orchestrator todavía no
 * publicó el total): sin denominador no hay fracción que comparar, y devolver
 * `true` soltaría en el peor momento posible — con cero entidades y sin haber
 * mostrado progreso.
 */
function hasDetectedEnoughPages(stage: PipelineStage, current: number, total: number): boolean {
  if (stage !== PipelineStage.Detecting) return false;
  if (total <= 0) return false;
  return current / total >= SCAN_ADVANCE_PAGE_RATIO;
}
