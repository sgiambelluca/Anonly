/**
 * `ZoomControls` (`ui/Components.md` §5.5, reescrito por ADR-037 §5).
 *
 * Solo llama `viewer.store.setZoom(newZoom)` (clampeado 0.5..3 por el propio
 * store, `viewer.store.ts`). El escalado CSS inmediato y el re-render real
 * debounced son responsabilidad de `PdfViewer` (§5.2) — este componente no
 * dispara `actions.requestRender` directamente.
 *
 * `ZOOM_STEP` (incremento por click/atajo) no es una constante del spec (no
 * hay un valor documentado en `Components.md`/`ADR-037`, a diferencia de
 * `ZOOM_RERENDER_DEBOUNCE_MS`); 0.1 (10%) es un incremento convencional de
 * visores PDF, sin impacto de contrato.
 */

import { RotateCcwIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useEffect } from "react";

import { MAX_ZOOM, MIN_ZOOM, useViewerStore } from "../../store/viewer.store.js";
import { Button } from "../common/Button.js";

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
    <div className="flex items-center gap-1" role="group" aria-label="Zoom del visor">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Alejar"
        disabled={zoom <= MIN_ZOOM}
        onClick={zoomOut}
      >
        <ZoomOutIcon className="h-4 w-4" aria-hidden />
      </Button>
      <span className="min-w-[3.5ch] text-center text-sm text-text-secondary" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Acercar"
        disabled={zoom >= MAX_ZOOM}
        onClick={zoomIn}
      >
        <ZoomInIcon className="h-4 w-4" aria-hidden />
      </Button>
      <Button variant="ghost" size="sm" aria-label="Restablecer zoom" onClick={resetZoom}>
        <RotateCcwIcon className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
