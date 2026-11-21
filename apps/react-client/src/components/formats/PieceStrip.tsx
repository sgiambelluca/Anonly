/**
 * `PieceStrip` — la tira de piezas de una variante (`Components.md` §13b.5,
 * ADR-228 §3).
 *
 * Cada pieza es una ficha de tres renglones; una parte opcional es una caja
 * punteada con sus piezas adentro. Un clic elige la pieza. **Arrastre** con las
 * APIs del navegador (sin dependencia nueva): reordena, mete y saca de una parte
 * opcional, con una marca que muestra dónde va a quedar. La alternativa por
 * teclado son los botones «Mover» del `PieceInspector`.
 *
 * La lógica de a dónde cae cada cosa está en `formatBuilderModel.ts`
 * (`moveToSlot`); acá solo se traducen eventos del DOM a lugares.
 */

import type { FormatPiece } from "@anonly/anonymization-core";
import { CornerDownLeftIcon, CornerDownRightIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { observeMenuLayout, type MenuLayout } from "../entities/menuPlacement.js";

import {
  lineStarts,
  moveToSlot,
  pieceCard,
  PIECE_MENU,
  samePath,
  sameSlot,
  slotAfter,
  slotBefore,
  type PieceClassId,
  type PiecePath,
  type Pieces,
  type Slot,
} from "./formatBuilderModel.js";

export interface PieceStripProps {
  readonly variant: Pieces;
  readonly selected: PiecePath | null;
  /** Con el tope de piezas, «+ Pieza» está apagado. */
  readonly addDisabled: boolean;
  readonly onSelect: (path: PiecePath) => void;
  /** El arrastre dejó la variante así, con la pieza movida en `selected`. */
  readonly onMoved: (variant: Pieces, selected: PiecePath) => void;
  readonly onAdd: (id: PieceClassId) => void;
}

const DRAG_MIME = "text/plain";
const DRAG_PAYLOAD = "anonly-piece";

function activate(event: KeyboardEvent<HTMLElement>, action: () => void): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

/** ¿El puntero está en la mitad derecha del elemento? Decide si la pieza cae antes o después. */
function inRightHalf(event: DragEvent<HTMLElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2;
}

interface DropSlotProps {
  readonly active: boolean;
  /** Una parte opcional vacía muestra un lugar más ancho, con una pista. */
  readonly wide?: boolean;
  readonly onOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

function DropSlot({ active, wide = false, onOver, onDrop }: DropSlotProps) {
  return (
    <div
      onDragOver={onOver}
      onDrop={onDrop}
      className={`flex shrink-0 items-center justify-center self-stretch ${
        wide ? "min-w-24 px-2 text-xs text-text-secondary" : "w-3"
      }`}
    >
      <span
        className={`h-full min-h-12 w-0.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
      />
      {wide ? <span className="sr-only">Lugar para soltar una pieza</span> : null}
    </div>
  );
}

interface PieceChipProps {
  readonly piece: Exclude<FormatPiece, { readonly kind: "optional" }>;
  readonly selected: boolean;
  /** Dentro de una parte opcional: más baja, para que el grupo mida como una tarjeta suelta. */
  readonly compact?: boolean;
  readonly onSelect: () => void;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLElement>) => void;
}

function PieceChip({
  piece,
  selected,
  compact = false,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: PieceChipProps) {
  const card = pieceCard(piece);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-pressed={selected}
      aria-label={`${card.title}, ${card.detail}`}
      onClick={onSelect}
      onKeyDown={(event) => activate(event, onSelect)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative flex ${compact ? "h-16 py-1" : "h-[4.5rem] py-1.5"} min-w-[5.5rem] max-w-[11rem] shrink-0 cursor-grab flex-col justify-center gap-0.5 rounded-lg border bg-bg-primary pl-2.5 pr-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        selected ? "border-accent ring-2 ring-accent/40" : "border-border-strong"
      }`}
    >
      <GripVerticalIcon
        className="pointer-events-none absolute right-1 top-1.5 h-3 w-3 text-text-secondary"
        aria-hidden
      />
      <span className="truncate text-sm font-semibold text-text-primary">{card.title}</span>
      <span className="truncate text-xs text-text-secondary">{card.detail}</span>
      <span className="truncate font-mono text-xs text-text-primary" title={card.example}>
        {card.example === "" ? "—" : card.example}
      </span>
    </div>
  );
}

interface AddPieceMenuProps {
  readonly disabled: boolean;
  readonly onAdd: (id: PieceClassId) => void;
}

/**
 * El menú «+ Pieza»: las seis clases, cada una con su descripción. Mismo
 * disclosure hecho a mano que `ActionsMenu`, flotante y sin empujar nada.
 */
function AddPieceMenu({ disabled, onAdd }: AddPieceMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<MenuLayout>({ placement: "bottom", top: 0, maxHeight: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const menu = menuRef.current;
    if (container === null || menu === null) return;
    return observeMenuLayout(container, menu, (next) => {
      setLayout((previous) =>
        previous.placement === next.placement &&
        previous.top === next.top &&
        previous.maxHeight === next.maxHeight
          ? previous
          : next,
      );
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={containerRef} className="relative ml-1 shrink-0 self-center">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            // Cierra el menú y no el diálogo.
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className="flex h-[4.5rem] w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-sm font-medium text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PlusIcon className="h-4 w-4" aria-hidden />
        Pieza
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="group"
          aria-label="Clases de pieza"
          data-placement={layout.placement}
          style={{ top: `${layout.top}px`, maxHeight: `${layout.maxHeight}px` }}
          className="absolute left-0 z-50 w-80 overflow-y-auto overscroll-contain rounded-xl border border-border bg-bg-primary p-1.5 shadow-md"
        >
          {PIECE_MENU.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd(entry.id);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-tertiary font-mono text-xs font-semibold text-text-secondary"
              >
                {entry.glyph}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-text-primary">{entry.label}</span>
                <span className="text-xs text-text-secondary">{entry.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PieceStrip({
  variant,
  selected,
  addDisabled,
  onSelect,
  onMoved,
  onAdd,
}: PieceStripProps) {
  const [dragging, setDragging] = useState<PiecePath | null>(null);
  const [over, setOver] = useState<Slot | null>(null);
  const [starts, setStarts] = useState<ReadonlyArray<number>>([]);
  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Dónde empieza cada renglón, para las flechas de continuación (ADR-228 §3).
  const pieceCount = variant.length;
  const measureLines = useCallback((): void => {
    const tops = Array.from(
      { length: pieceCount },
      (_, index) => itemRefs.current[index]?.offsetTop ?? 0,
    );
    const next = lineStarts(tops);
    setStarts((previous) =>
      previous.length === next.length && previous.every((value, i) => value === next[i])
        ? previous
        : next,
    );
  }, [pieceCount]);

  useLayoutEffect(measureLines);

  useEffect(() => {
    const row = rowRef.current;
    if (row === null) return;
    const observer = new ResizeObserver(measureLines);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measureLines]);

  function hover(event: DragEvent<HTMLElement>, slot: Slot): void {
    if (dragging === null || moveToSlot(variant, dragging, slot) === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setOver((previous) => (sameSlot(previous, slot) ? previous : slot));
  }

  function drop(event: DragEvent<HTMLElement>, slot: Slot): void {
    event.preventDefault();
    event.stopPropagation();
    const from = dragging;
    setDragging(null);
    setOver(null);
    if (from === null) return;
    const result = moveToSlot(variant, from, slot);
    if (result !== null) onMoved(result.variant, result.path);
  }

  function startDrag(event: DragEvent<HTMLElement>, path: PiecePath): void {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, DRAG_PAYLOAD);
    setDragging(path);
    onSelect(path);
  }

  function endDrag(): void {
    setDragging(null);
    setOver(null);
  }

  /** Sobre una ficha: la pieza cae antes o después según la mitad. */
  function chipSlot(event: DragEvent<HTMLElement>, path: PiecePath): Slot {
    return inRightHalf(event) ? slotAfter(path) : slotBefore(path);
  }

  function renderChip(
    piece: Exclude<FormatPiece, { readonly kind: "optional" }>,
    path: PiecePath,
    compact = false,
  ) {
    return (
      <PieceChip
        piece={piece}
        compact={compact}
        selected={samePath(selected, path)}
        onSelect={() => onSelect(path)}
        onDragStart={(event) => startDrag(event, path)}
        onDragEnd={endDrag}
        onDragOver={(event) => hover(event, chipSlot(event, path))}
        onDrop={(event) => drop(event, chipSlot(event, path))}
      />
    );
  }

  function renderSlot(slot: Slot, wide = false) {
    return (
      <DropSlot
        active={over !== null && sameSlot(over, slot)}
        wide={wide}
        onOver={(event) => hover(event, slot)}
        onDrop={(event) => drop(event, slot)}
      />
    );
  }

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Piezas de la variante"
      className="flex min-h-[6.25rem] flex-wrap content-start items-center gap-y-4 rounded-lg border border-border bg-bg-secondary p-3"
    >
      {variant.map((piece, index) => {
        const path: PiecePath = [index];
        const startsLine = starts.includes(index);
        const endsLine = starts.includes(index + 1);
        return (
          <div key={index} className="flex items-center">
            {renderSlot({ parent: null, index })}
            <div
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              className="relative"
            >
              {startsLine ? (
                <CornerDownRightIcon
                  data-continuation="start"
                  className="pointer-events-none absolute -left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-text-secondary"
                  aria-hidden
                />
              ) : null}
              {piece.kind === "optional" ? (
                <div
                  className={`flex h-[4.5rem] items-stretch gap-1.5 rounded-xl border-[1.5px] border-dashed bg-bg-secondary px-1.5 py-[2px] ${
                    samePath(selected, path)
                      ? "border-accent ring-2 ring-accent/40"
                      : "border-border-strong"
                  }`}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    draggable
                    aria-pressed={samePath(selected, path)}
                    aria-label={`Parte opcional, ${piece.pieces.length} piezas`}
                    onClick={() => onSelect(path)}
                    onKeyDown={(event) => activate(event, () => onSelect(path))}
                    onDragStart={(event) => startDrag(event, path)}
                    onDragEnd={endDrag}
                    onDragOver={(event) => hover(event, chipSlot(event, path))}
                    onDrop={(event) => drop(event, chipSlot(event, path))}
                    className="flex shrink-0 rotate-180 cursor-grab items-center justify-center rounded-md text-[11px] font-[650] uppercase tracking-[0.06em] text-text-secondary [writing-mode:vertical-rl] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Opcional
                  </div>
                  <div
                    className="flex items-center"
                    onDragOver={(event) =>
                      hover(event, { parent: index, index: piece.pieces.length })
                    }
                    onDrop={(event) => drop(event, { parent: index, index: piece.pieces.length })}
                  >
                    {piece.pieces.length === 0
                      ? renderSlot({ parent: index, index: 0 }, true)
                      : null}
                    {piece.pieces.map((inner, innerIndex) => {
                      const innerPath: PiecePath = [index, innerIndex];
                      return (
                        <div key={innerIndex} className="flex items-center">
                          {renderSlot({ parent: index, index: innerIndex })}
                          {inner.kind === "optional" ? null : renderChip(inner, innerPath, true)}
                        </div>
                      );
                    })}
                    {piece.pieces.length > 0
                      ? renderSlot({ parent: index, index: piece.pieces.length })
                      : null}
                  </div>
                </div>
              ) : (
                renderChip(piece, path)
              )}
              {endsLine ? (
                <CornerDownLeftIcon
                  data-continuation="end"
                  className="pointer-events-none absolute -right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-text-secondary"
                  aria-hidden
                />
              ) : null}
            </div>
          </div>
        );
      })}
      {renderSlot({ parent: null, index: variant.length })}
      <AddPieceMenu disabled={addDisabled} onAdd={onAdd} />
    </div>
  );
}
