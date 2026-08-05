/**
 * `zoomRenderScheduler.ts` — debounce del re-render real de zoom
 * (`adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` §5): agrupa los ticks
 * sucesivos de un gesto de zoom (rueda/pinch, ~16 ms cada uno) en un solo
 * `actions.requestRender(pageIndices, kind, "preview", scale)` emitido recién
 * tras `ZOOM_RERENDER_DEBOUNCE_MS` sin nuevos ticks.
 *
 * Lógica separada de React/DOM a propósito, igual que `visibleRange.ts`: los
 * tests de `apps/react-client` corren en Node (`vitest.config.ts` raíz, sin
 * jsdom) y no pueden montar el componente para verificar el debounce, pero sí
 * pueden ejercitar este scheduler con timers falsos de Vitest.
 */

/** Constante de UI documentada en `ui/React_Client.md` §7 y `ui/Components.md` §5.5. */
export const ZOOM_RERENDER_DEBOUNCE_MS = 150;

export interface ZoomRenderScheduler {
  /** Programa `callback` tras el período de quietud; cancela cualquier programación pendiente anterior (el tick más reciente gana). */
  schedule(callback: () => void): void;
  /** Cancela cualquier programación pendiente sin ejecutar su callback (p. ej. al desmontar el componente). */
  cancel(): void;
}

export function createZoomRenderScheduler(
  delayMs: number = ZOOM_RERENDER_DEBOUNCE_MS,
): ZoomRenderScheduler {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return {
    schedule(callback) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
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
