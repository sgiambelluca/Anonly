/**
 * `ZoomControls` (`ui/Components.md` §5.5, reescrito por ADR-037 §5; sin botón
 * de restablecer por ADR-169 §9).
 *
 * Solo llama `viewer.store.setZoom(newZoom)` (clampeado 0.5..3 por el propio
 * store). El escalado CSS inmediato y el re-render real debounced son
 * responsabilidad de `PdfViewer` (§5.2) — este componente no dispara
 * `actions.requestRender` directamente. El pellizco del trackpad y `Ctrl +
 * rueda` también los atiende `PdfViewer` (listener `{ passive: false }`).
 *
 * Quedan `−`, el porcentaje (ancho fijo, UX-10) y `+`. **Sin botón de
 * restablecer**: sobraba (pruebas de usuario de la 0.9.2). El atajo
 * `Ctrl/Cmd + 0` se conserva.
 *
 * `ZOOM_STEP` no es una constante del spec; 0.1 (10 %) es el incremento
 * convencional de visores PDF, sin impacto de contrato.
 */

import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect } from "react";

import { MAX_ZOOM, MIN_ZOOM, useViewerStore } from "../../store/viewer.store.js";

const ZOOM_STEP = 0.1;
const DEFAULT_ZOOM = 1;

function zoomIn(): void {
  const state = useViewerStore.getState();
  state.setZoom(state.zoom + ZOOM_STEP);
}

function zoomOut(): void {
  const state = useViewerStore.getState();
  state.setZoom(state.zoom - ZOOM_STEP);
}

function resetZoom(): void {
  useViewerStore.getState().setZoom(DEFAULT_ZOOM);
}

export function ZoomControls() {
  const zoom = useViewerStore((state) => state.zoom);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  return (
    <div
      role="group"
      aria-label="Zoom del visor"
      className="inline-flex items-center overflow-hidden rounded-lg border border-border"
    >
      <button
        type="button"
        aria-label="Alejar"
        disabled={zoom <= MIN_ZOOM}
        onClick={zoomOut}
        className="flex h-8 w-8 items-center justify-center text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-40"
      >
        <MinusIcon className="h-4 w-4" aria-hidden />
      </button>
      <span
        aria-live="polite"
        className="w-[3.25rem] border-x border-border text-center text-sm leading-8 tabular-nums text-text-primary"
      >
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        aria-label="Acercar"
        disabled={zoom >= MAX_ZOOM}
        onClick={zoomIn}
        className="flex h-8 w-8 items-center justify-center text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-40"
      >
        <PlusIcon className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
