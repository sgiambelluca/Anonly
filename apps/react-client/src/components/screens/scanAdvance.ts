/**
 * `scanAdvance.ts` — cuándo la pantalla de escaneo (②a) suelta al usuario en
 * el panel de trabajo (②b).
 *
 * Fuente de verdad: `ui/UX_Guidelines.md` §7.2, ADR-150 (esta regla),
 * ADR-151 (la página 1 precalentada que la gracia espera).
 *
 * Lógica separada de React a propósito, mismo criterio que
 * `readyRenderTrigger.ts`/`visibleRange.ts`: `apps/react-client` corre sus
 * tests en Node (`vitest.config.ts` raíz, sin jsdom), así que lo que no está
 * en un módulo puro no se testea.
 *
 * **Por qué se retiraron el techo y el umbral por páginas (ADR-150 §2)**:
 * ADR-087 §6 tenía dos objetivos — acotar la espera y no dejar editar sobre
 * datos que todavía se mueven (las entidades entran incrementalmente y cada
 * una renumera los marcadores de todo el documento). No hay valor del techo
 * que cumpla los dos: cualquier pase anterior a `Ready` es un pase sobre
 * datos en movimiento. ADR-150 elige la segunda razón, que es la que protege
 * el resultado del trabajo, y paga la primera con progreso real en vivo y
 * `Cancelar` (ADR-152).
 *
 * **La única condición de pase es que el `stage` sea terminal**:
 *
 * - `Ready`/`Done` ⇒ se pasa cuando se cumplen las dos: transcurrió el
 *   **piso** de `SCAN_ADVANCE_MIN_MS` desde el import, y la **página 1 ya
 *   está dibujada** (el precalentado de ADR-151, `firstPagePreviewReady`) o
 *   venció su **gracia** (`SCAN_ADVANCE_PREWARM_GRACE_MS` desde que se
 *   alcanzó `Ready`). El vencimiento de la gracia **no es un error**: se
 *   entra igual y el panel se llena como antes de ADR-151.
 * - `Failed`/`Cancelled` ⇒ se pasa **de inmediato**, sin piso y sin esperar
 *   ningún preview — no hay panel que llenar, y retener al usuario frente a
 *   un error sería retenerlo sobre el error.
 * - Cualquier otro stage ⇒ se queda.
 */

import { PipelineStage } from "@anonly/anonymization-core";

/** Piso global desde el import: un PDF chico no hace parpadear la pantalla. */
export const SCAN_ADVANCE_MIN_MS = 1200;

/**
 * Gracia desde `Ready`/`Done` para que la página 1 precalentada (ADR-151)
 * aparezca: un render que falla o se cuelga no puede encerrar a nadie en la
 * pantalla de escaneo. Valor de partida (ADR-150 §1): la referencia medida es
 * un render de ~120 ms en un PDF nativo; H-10 la confirma sobre una página
 * escaneada, que es más pesada.
 */
export const SCAN_ADVANCE_PREWARM_GRACE_MS = 1000;

const READY_STAGES: ReadonlySet<PipelineStage> = new Set([PipelineStage.Ready, PipelineStage.Done]);

/**
 * Stages en los que el pipeline ya terminó sin éxito: la pantalla de escaneo
 * sale de inmediato, sin piso y sin preview que esperar — no hay panel que
 * llenar.
 */
const ERROR_STAGES: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Failed,
  PipelineStage.Cancelled,
]);

export interface ScanAdvanceParams {
  readonly stage: PipelineStage;
  /** Milisegundos transcurridos desde el import. */
  readonly elapsedMs: number;
  /** `viewer.store.previewByPage.original.has(0)` — la página 1 ya está dibujada (ADR-151). */
  readonly firstPagePreviewReady: boolean;
  /**
   * Milisegundos transcurridos desde que el pipeline alcanzó `Ready`/`Done`,
   * o `null` si todavía no lo alcanzó. Gobierna la gracia del precalentado;
   * es independiente de `elapsedMs`, que sigue corriendo desde el import.
   */
  readonly elapsedSinceReadyMs: number | null;
}

/** `true` si corresponde pasar de la pantalla de escaneo al panel de trabajo. */
export function shouldAdvanceFromScan(params: ScanAdvanceParams): boolean {
  const { stage, elapsedMs, firstPagePreviewReady, elapsedSinceReadyMs } = params;

  if (ERROR_STAGES.has(stage)) return true;
  if (!READY_STAGES.has(stage)) return false;

  if (elapsedMs < SCAN_ADVANCE_MIN_MS) return false;
  if (firstPagePreviewReady) return true;
  return elapsedSinceReadyMs !== null && elapsedSinceReadyMs >= SCAN_ADVANCE_PREWARM_GRACE_MS;
}
