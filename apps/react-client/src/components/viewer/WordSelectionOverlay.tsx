/**
 * `WordSelectionOverlay` (`ui/Components.md` §5.4b, ADR-061 §3/§4 ruta B).
 *
 * Capa transparente sobre el `PageCanvas` del panel `original` — nunca se
 * monta sobre `anonymized` (`PdfViewer.tsx`): ahí lo visible puede ser un
 * reemplazo, y señalarlo no significaría nada.
 *
 * Click o arrastre → `pointerSelectionToPageRect` traduce a coordenadas de
 * página → `wordsInRect` (`@anonly/shared`) hit-test contra `Page.words` →
 * si hay coincidencias, "Agregar entidad como…" con el selector de tipo →
 * `addManualEntity`. Sin capa de texto de pdf.js (ADR-061 Contexto §3): el
 * hit-test no distingue el origen de la palabra, así que funciona igual en
 * PDFs digitales y escaneados.
 */

import { EntityType, wordsInRect, type Word } from "@anonly/anonymization-core";
import { useEffect, useState, type PointerEvent } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { Select } from "../common/Select.js";
import { ENTITY_TYPE_OPTIONS } from "../entities/entityTypeLabels.js";

import { pointerSelectionToPageRect } from "./wordSelectionRect.js";

export interface WordSelectionOverlayProps {
  readonly pageIndex: number;
  /** Tamaño en pantalla (CSS px) del `PageCanvas` que esta capa cubre. */
  readonly displayWidth: number;
  readonly displayHeight: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PendingSelection {
  readonly anchor: Point;
  readonly words: ReadonlyArray<Word>;
}

export function WordSelectionOverlay({
  pageIndex,
  displayWidth,
  displayHeight,
}: WordSelectionOverlayProps) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);

  // Cierra el popover con Escape. Sin cierre por "click afuera": el
  // dropdown de `Select` se renderiza por Portal de Radix a `document.body`,
  // fuera del subárbol de `popoverRef` — un click ahí (elegir un tipo) se
  // vería como "afuera" y cerraría el popover antes de que la selección
  // aplicara. El botón "Cancelar" cubre el mismo caso de uso.
  useEffect(() => {
    if (!pending) return;

    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") setPending(null);
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [pending]);

  function pointFromEvent(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    setPending(null);
    const point = pointFromEvent(event);
    setDragStart(point);
    setDragCurrent(point);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragStart) return;
    setDragCurrent(pointFromEvent(event));
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (!dragStart) return;
    const end = pointFromEvent(event);
    setDragStart(null);
    setDragCurrent(null);

    const pageSize = actions.getPageSize(pageIndex);
    if (pageSize === null) return;

    const rect = pointerSelectionToPageRect({
      startX: dragStart.x,
      startY: dragStart.y,
      endX: end.x,
      endY: end.y,
      displayWidth,
      displayHeight,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    });

    const words = wordsInRect(actions.getPageWords(pageIndex), rect);
    if (words.length === 0) return;

    setEntityType(EntityType.Person);
    setPending({ anchor: end, words });
  }

  function handleConfirm(): void {
    if (!pending) return;
    const value = pending.words.map((word) => word.text).join(" ");
    void actions.addManualEntity({ value, entityType });
    setPending(null);
  }

  const selectionRect =
    dragStart && dragCurrent
      ? {
          left: Math.min(dragStart.x, dragCurrent.x),
          top: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  return (
    <div
      className="absolute inset-0 cursor-crosshair select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {selectionRect ? (
        <div
          className="pointer-events-none absolute border border-accent bg-accent/20"
          style={selectionRect}
        />
      ) : null}
      {pending ? (
        <div
          role="dialog"
          aria-label="Agregar entidad"
          className="absolute z-10 flex w-48 flex-col gap-2 rounded-md border border-border bg-bg-primary p-2 text-xs shadow-md"
          style={{ left: pending.anchor.x, top: pending.anchor.y }}
          // El popover vive dentro del div que arma la selección (onPointerDown
          // más abajo, `handlePointerDown`): sin esto, cualquier click adentro
          // —el propio selector de tipo— burbujea al div padre y arranca un
          // drag nuevo que limpia `pending` antes de que el click llegue al
          // botón.
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="font-medium text-text-primary">Agregar entidad como…</span>
          <Select
            value={entityType}
            onChange={setEntityType}
            options={ENTITY_TYPE_OPTIONS}
            aria-label="Tipo de entidad"
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirm}>
              Agregar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
