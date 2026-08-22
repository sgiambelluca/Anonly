/**
 * `PageCanvas` (`ui/Components.md` §5.4, alcance reducido a lo que pide el
 * PR7 del Hito 10: "recibe pageIndex, kind, blobUrl?, dibuja la imagen o un
 * skeleton si no hay blobUrl todavía"). `annotations`/`highlights` (bordes por
 * tipo, hover con tooltip, click para seleccionar grupo) dependen del panel de
 * Entidades (PR8/PR9, fuera de alcance de este PR) — se agregan cuando ese
 * panel exista.
 *
 * **Estado de fallo** (`failed`): cuando `PREVIEW_PAGE_FAILED` marcó la
 * página, se dibuja un aviso encima del canvas en vez del skeleton pelado.
 * Sin eso, "falló para siempre" y "todavía no llegó" son el mismo gris — que
 * es exactamente cómo un defecto real del render pudo dejar el visor entero
 * en blanco sin una sola señal (`Post_Hito10.8_Pendientes.md` §21).
 *
 * El copy dice **que el documento no cambió**: el usuario está mirando una
 * herramienta de anonimización, y un error sobre el documento se lee como
 * "algo le pasó a mi archivo" si nadie aclara lo contrario.
 *
 * `width`/`height` no están en la lista de props del catálogo, pero son
 * necesarias para poder dibujar "con dimensión correcta" (spec) incluso antes
 * de tener una imagen real: las computa `PdfViewer`/`PageVirtualizer` a partir
 * de `pageLayout.ts` (no hay dimensiones de página reales expuestas por el
 * Core al cliente, ver esa nota en `pageLayout.ts`).
 */

import { ImageOffIcon } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import { shouldReassignCanvasDimensions } from "./canvasDimensions.js";

export interface PageCanvasProps {
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly blobUrl?: string;
  readonly width: number;
  readonly height: number;
  /**
   * El render de esta página **falló** (`viewer.failedPages`). Distinto de
   * "todavía no llegó": sin esta distinción los dos casos son el mismo
   * rectángulo gris, y el usuario no tiene forma de saber si esperar.
   */
  readonly failed?: boolean;
}

/** Gris de skeleton (`--color-border` / `bg-tertiary`, `ui/Components.md` §10). */
const SKELETON_FILL = "#e5e7eb";

function PageCanvasImpl({ pageIndex, kind, blobUrl, width, height, failed }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    // Reasignar canvas.width/height borra el bitmap aunque el valor sea
    // idéntico (estándar HTML, ADR-056 §5): solo se reasigna cuando el
    // tamaño calculado realmente difiere del actual.
    if (
      shouldReassignCanvasDimensions(
        { width: canvas.width, height: canvas.height },
        { width: nextWidth, height: nextHeight },
      )
    ) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    if (blobUrl === undefined) {
      context.fillStyle = SKELETON_FILL;
      context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // `blobUrl` puede cambiar (nuevo `PREVIEW_UPDATED`, p. ej. tras el
    // re-render de zoom, ADR-037 §5) mientras la imagen anterior todavía está
    // cargando: `active` evita pintar una imagen obsoleta si el efecto ya se
    // limpió por un cambio más reciente.
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.onerror = () => {
      if (!active) return;
      context.fillStyle = SKELETON_FILL;
      context.fillRect(0, 0, canvas.width, canvas.height);
    };
    image.src = blobUrl;

    return () => {
      active = false;
    };
  }, [blobUrl, width, height]);

  const label = `Página ${pageIndex + 1}, ${kind === "original" ? "original" : "anonimizado"}`;

  // El aviso va **encima** del canvas y no en vez de él: el canvas conserva la
  // dimensión de la página, así que el scroll no salta cuando una página del
  // medio falla.
  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={failed === true ? `${label} — no se pudo mostrar` : label}
        className="block h-full w-full"
      />
      {failed === true && blobUrl === undefined ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <ImageOffIcon className="h-6 w-6 text-text-secondary" aria-hidden />
          <p className="text-sm font-medium text-text-primary">No se pudo mostrar esta página</p>
          <p className="max-w-xs text-sm text-text-secondary">
            El documento no cambió: es la vista previa la que falló. Podés seguir revisando y
            exportar igual.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export const PageCanvas = memo(PageCanvasImpl);
