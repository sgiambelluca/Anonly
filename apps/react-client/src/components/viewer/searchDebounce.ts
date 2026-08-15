/**
 * `DocumentSearchBox` (`ui/Components.md` §5.4c, ADR-061 §8): `findText` es
 * sincrónica y recorre todas las palabras del documento en el main thread —
 * una llamada por tecla se nota en documentos largos (`Regex_Engine.md`
 * §12). El debounce es responsabilidad de este componente, no del Core.
 *
 * Estructura idéntica a `zoomRenderScheduler.ts` (mismo motivo: los tests de
 * `apps/react-client` corren en Node sin jsdom, así que la lógica de timers
 * vive separada del componente para poder ejercitarla con timers falsos).
 */

export const SEARCH_DEBOUNCE_MS = 200;

export interface SearchDebouncer {
  /** Programa `callback` tras el período de quietud; el tick más reciente gana. */
  schedule(callback: () => void): void;
  cancel(): void;
}

export function createSearchDebouncer(delayMs: number = SEARCH_DEBOUNCE_MS): SearchDebouncer {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return {
    schedule(callback) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        callback();
      }, delayMs);
    },
    cancel() {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    },
  };
}
