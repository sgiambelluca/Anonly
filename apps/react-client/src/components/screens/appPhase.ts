/**
 * `appPhase.ts` — cuál de los tres momentos está en pantalla.
 *
 * Fuente de verdad: `ui/UX_Guidelines.md` §2, ADR-087 §1.
 *
 * Módulo puro por el mismo motivo que `scanAdvance.ts`: los tests de
 * `apps/react-client` corren en Node sin jsdom.
 */

export type AppPhase = "load" | "scan" | "work";

export interface AppPhaseParams {
  /** `document.store.id`. */
  readonly documentId: string | null;
  /**
   * `documentId` para el que la pantalla de escaneo ya soltó, o `null`.
   *
   * **Es un latch por documento, no un booleano**, y esa es la parte que
   * importa: un `reanalyze` lleva el pipeline de `Ready` de vuelta a
   * `Detecting` (ADR-038 §5). Sin el latch, cambiar un setting con el
   * documento abierto tiraría al usuario de vuelta a la pantalla de escaneo,
   * perdiendo el panel de trabajo en el que estaba. Mismo patrón que
   * `readyRenderTrigger.ts#triggeredForDocumentId`, y por la misma razón.
   */
  readonly advancedForDocumentId: string | null;
}

export function resolveAppPhase(params: AppPhaseParams): AppPhase {
  const { documentId, advancedForDocumentId } = params;

  // `document.store.id` se puebla con `DOCUMENT_IMPORTED`, al **iniciar** el
  // import (bus-bridge.ts), no al terminar el parseo: alcanza como criterio de
  // "hay documento" y es el mismo que ya usaba `App.tsx` para elegir entre
  // Hero y visores. La ventana anterior a ese evento —`actions.importDocument`
  // hace `await file.arrayBuffer()` antes de llamar al Orchestrator— cae acá,
  // en `load`, que es donde `LoadScreen` muestra su propio "leyendo archivo…".
  if (documentId === null) return "load";

  return advancedForDocumentId === documentId ? "work" : "scan";
}
