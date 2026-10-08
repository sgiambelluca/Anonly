/**
 * `ContextPreview` — la frase de una aparición, con el lugar del dato
 * dibujado como lo dibuja el documento (`ui/Components.md` §3.3b, §3.4e y
 * §3.5b, ADR-215 §3).
 *
 * Antes era una función interna de `EditReplacementDialog`; la usan ahora los
 * tres diálogos que muestran una frase: el de espacio justo
 * (`DegradedBadge`), el de edición y `RemoveEntityDialog`.
 *
 * Dibuja **un renglón**; los rótulos ("Original", "Hoy", "Si la eliminás") los
 * pone quien lo usa. Lo que va en el lugar del dato es un `PhraseContent`
 * (`phraseContent.ts`): un texto, el bloque negro, el original resaltado o el
 * lugar vacío. Salvo el original, todo se dibuja **dentro del ancho del
 * original** —que es lo que hace el render (ADR-058)—, y un texto que no entra
 * se achica con `scaleX`.
 *
 * El ancho del original se mide con un `span` oculto que lleva el mismo texto
 * en la misma tipografía: así un renglón no depende de que haya otro con el
 * original al lado.
 *
 * Los colores de la "página" (fondo blanco, texto oscuro, resaltados) son fijos
 * a propósito: pintan una hoja de papel, que es blanca en los dos temas.
 */

import { useLayoutEffect, useRef, useState } from "react";

import type { PhraseContent } from "./phraseContent.js";

export interface ContextPreviewProps {
  /** Lo que hay antes del dato (`OccurrenceRef.context.before`). */
  readonly before: string;
  /** El dato tal como aparece en el documento (`OccurrenceRef.value`). */
  readonly original: string;
  /** Lo que hay después del dato (`OccurrenceRef.context.after`). */
  readonly after: string;
  /** Qué va en el lugar del dato. */
  readonly content: PhraseContent;
  /**
   * Color del resaltado del original. `danger` es el de «Si la eliminás»
   * (`RemoveEntityDialog`); `amber` el de siempre.
   */
  readonly highlight?: "amber" | "danger";
}

const PAGE_CLASS =
  "relative block truncate rounded bg-white px-2 py-1 font-serif text-sm text-[#1f2937]";

const HIGHLIGHT_CLASS = {
  amber: "rounded-sm bg-[#fde68a] px-px",
  danger: "rounded-sm bg-[#fee2e2] px-px shadow-[inset_0_-2px_0_#dc2626]",
} as const;

export function ContextPreview({
  before,
  original,
  after,
  content,
  highlight = "amber",
}: ContextPreviewProps) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [slotWidth, setSlotWidth] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const text = content.kind === "text" ? content.text : "";

  useLayoutEffect(() => {
    const originalWidth = measureRef.current?.offsetWidth ?? null;
    const naturalWidth = textRef.current?.scrollWidth ?? 0;
    setSlotWidth(originalWidth);
    setScale(
      originalWidth !== null && naturalWidth > originalWidth && naturalWidth > 0
        ? originalWidth / naturalWidth
        : 1,
    );
  }, [original, text, content.kind]);

  const slotStyle = slotWidth !== null ? { width: slotWidth } : undefined;

  return (
    <span className={PAGE_CLASS}>
      …{before}
      {content.kind === "original" ? (
        <span className={HIGHLIGHT_CLASS[highlight]}>{original}</span>
      ) : (
        <>
          {/* Mide el original sin mostrarlo: el lugar del dato tiene su ancho. */}
          <span
            ref={measureRef}
            aria-hidden
            className="invisible absolute left-0 top-0 whitespace-nowrap px-px"
          >
            {original}
          </span>
          {content.kind === "text" ? (
            <span
              className="inline-block overflow-hidden whitespace-nowrap rounded-sm bg-[#eef0f3] align-bottom"
              style={slotStyle}
            >
              <span
                ref={textRef}
                className="inline-block origin-left whitespace-nowrap"
                style={{ transform: `scaleX(${scale})` }}
              >
                {content.text}
              </span>
            </span>
          ) : content.kind === "block" ? (
            <span
              className="inline-block h-[15px] rounded-sm bg-[#030712] align-[-2px]"
              style={slotStyle}
            />
          ) : (
            <span
              className="inline-block h-[15px] rounded-sm bg-[#eef0f3] align-[-2px]"
              style={slotStyle}
            />
          )}
        </>
      )}
      {after}…
    </span>
  );
}
