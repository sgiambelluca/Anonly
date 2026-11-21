/**
 * `FormatTestPanel` — «Probar con un texto» (`Components.md` §13b.5, ADR-228 §6).
 *
 * Panel flotante: arranca cerrado, no empuja nada y se mueve arrastrándolo de su
 * encabezado (con teclado, con las flechas). Se abre a la derecha del diálogo si
 * hay lugar; si no, encima de su borde derecho. Adentro: el texto de prueba,
 * cuántas coincidencias hay y el texto con lo que se detectaría resaltado
 * (`testFormat`).
 *
 * Se dibuja adentro del contenido del diálogo, anclado con `absolute`: un portal
 * fuera de él chocaría con la trampa de foco y el «clic afuera» de Radix. El
 * texto de prueba lo guarda quien lo monta, en estado local: nunca va a
 * `anonly:detection` ni a un log.
 */

import type { FormatDefinition } from "@anonly/anonymization-core";
import { XIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import {
  clampPanelOffset,
  initialPanelOffset,
  runFormatTest,
  TEST_PANEL_SIZE,
  type BoxRect,
  type PanelPoint,
  type SegmentKind,
} from "./formatBuilderStatus.js";

export const TEST_PANEL_COPY = {
  title: "Probar con un texto",
  label: "Texto de prueba",
  placeholder: "Pegá o escribí un texto para ver qué detectaría este formato.",
  notice: "Este texto no se guarda.",
  count: (count: number) =>
    count === 0 ? "Sin coincidencias" : count === 1 ? "1 coincidencia" : `${count} coincidencias`,
} as const;

const KEY_STEP = 16;
const SAMPLE_MAX = 5000;

const SEGMENT_CLASS: Readonly<Record<SegmentKind, string>> = {
  plain: "",
  hit: "rounded-sm bg-accent/25 text-text-primary",
  context: "border-b border-dotted border-text-secondary",
};

const KEY_DELTAS: Readonly<Record<string, PanelPoint>> = {
  ArrowLeft: { x: -KEY_STEP, y: 0 },
  ArrowRight: { x: KEY_STEP, y: 0 },
  ArrowUp: { x: 0, y: -KEY_STEP },
  ArrowDown: { x: 0, y: KEY_STEP },
};

export interface FormatTestPanelProps {
  readonly definition: FormatDefinition;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly onClose: () => void;
}

function rectOf(element: HTMLElement): BoxRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function FormatTestPanel({ definition, text, onTextChange, onClose }: FormatTestPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<PanelPoint | null>(null);
  const drag = useRef<{ x: number; y: number; origin: PanelPoint } | null>(null);
  const outcome = useMemo(() => runFormatTest(definition, text), [definition, text]);

  function dialogRect(): BoxRect | null {
    const parent = panelRef.current?.offsetParent;
    return parent instanceof HTMLElement ? rectOf(parent) : null;
  }

  function viewport(): { readonly width: number; readonly height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  useLayoutEffect(() => {
    const rect = dialogRect();
    if (rect !== null) setOffset(initialPanelOffset(rect, viewport()));
  }, []);

  function moveTo(next: PanelPoint): void {
    const rect = dialogRect();
    if (rect !== null) setOffset(clampPanelOffset(next, rect, viewport()));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || offset === null) return;
    if (event.target instanceof HTMLElement && event.target.closest("button") !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, origin: offset };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const start = drag.current;
    if (start === null) return;
    moveTo({
      x: start.origin.x + event.clientX - start.x,
      y: start.origin.y + event.clientY - start.y,
    });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (drag.current === null) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={TEST_PANEL_COPY.title}
      data-format-test-panel
      style={{
        left: offset?.x ?? 0,
        top: offset?.y ?? 0,
        width: TEST_PANEL_SIZE.width,
        height: TEST_PANEL_SIZE.height,
      }}
      className={`absolute z-[60] flex flex-col rounded-xl border border-border bg-bg-primary shadow-md ${
        offset === null ? "invisible" : ""
      }`}
    >
      <div
        tabIndex={0}
        role="group"
        aria-label="Mover el panel: arrastrá del encabezado o usá las flechas del teclado"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          const delta = KEY_DELTAS[event.key];
          if (delta === undefined || offset === null) return;
          event.preventDefault();
          moveTo({ x: offset.x + delta.x, y: offset.y + delta.y });
        }}
        className="flex shrink-0 cursor-move items-center justify-between rounded-t-xl border-b border-border bg-bg-secondary px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-sm font-semibold text-text-primary">{TEST_PANEL_COPY.title}</span>
        <button
          type="button"
          aria-label="Cerrar la prueba"
          onClick={onClose}
          className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <XIcon className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-text-secondary">
          {TEST_PANEL_COPY.label}
          <textarea
            value={text}
            maxLength={SAMPLE_MAX}
            rows={4}
            placeholder={TEST_PANEL_COPY.placeholder}
            onChange={(event) => onTextChange(event.target.value)}
            className="h-24 resize-none rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-sm font-normal text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <span className="text-sm font-medium text-text-primary" aria-live="polite">
          {TEST_PANEL_COPY.count(outcome.count)}
        </span>
        <div
          aria-label="Resultado de la prueba"
          className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-sm text-text-primary"
        >
          {outcome.segments.map((segment, index) => (
            <span key={index} className={SEGMENT_CLASS[segment.kind]}>
              {segment.text}
            </span>
          ))}
        </div>
        <p className="shrink-0 text-xs text-text-secondary">{TEST_PANEL_COPY.notice}</p>
      </div>
    </div>
  );
}
