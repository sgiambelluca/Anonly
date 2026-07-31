/**
 * `PageCanvas` (`ui/Components.md` §5.4, alcance reducido a lo que pide el
 * PR7 del Hito 10: "recibe pageIndex, kind, blobUrl?, dibuja la imagen o un
 * skeleton si no hay blobUrl todavía"). `annotations`/`highlights` (bordes por
 * tipo, hover con tooltip, click para seleccionar grupo) dependen del panel de
 * Entidades (PR8/PR9, fuera de alcance de este PR) — se agregan cuando ese
 * panel exista.
 *
 * `width`/`height` no están en la lista de props del catálogo, pero son
 * necesarias para poder dibujar "con dimensión correcta" (spec) incluso antes
 * de tener una imagen real: las computa `PdfViewer`/`PageVirtualizer` a partir
 * de `pageLayout.ts` (no hay dimensiones de página reales expuestas por el
 * Core al cliente, ver esa nota en `pageLayout.ts`).
 */

import { memo, useEffect, useRef } from "react";

export interface PageCanvasProps {
  readonly pageIndex: number;
  readonly kind: "original" | "anonymized";
  readonly blobUrl?: string;
  readonly width: number;
  readonly height: number;
}

/** Gris de skeleton (`--color-border` / `bg-tertiary`, `ui/Components.md` §10). */
const SKELETON_FILL = "#e5e7eb";

function PageCanvasImpl({ pageIndex, kind, blobUrl, width, height }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));

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

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Página ${pageIndex + 1}, ${kind === "original" ? "original" : "anonimizado"}`}
      className="block h-full w-full"
    />
  );
}

export const PageCanvas = memo(PageCanvasImpl);
