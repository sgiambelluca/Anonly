/**
 * `PieceInspector` — el ajuste de la pieza elegida (`Components.md` §13b.5,
 * ADR-228 §4). Vive en una caja de **alto fijo**: cambia el contenido, nunca
 * el alto (ADR-169 §1).
 *
 * Arriba dice qué pieza es y tiene «Mover», a izquierda y a derecha (la
 * alternativa por teclado al arrastre, `UX_Guidelines.md` §11b.6) y «Borrar
 * pieza».
 */

import { FORMAT_MAX_REPEAT, FORMAT_MAX_TEXT, type FormatPiece } from "@anonly/anonymization-core";
import {
  CaseSensitiveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HashIcon,
  TypeIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";

import {
  charsKindOf,
  isExactly,
  OPTIONAL_INNER_MENU,
  parseCount,
  pieceHeading,
  BUILDER_COPY,
  SEPARATOR_OPTIONS,
  toExactMode,
  toggleSeparator,
  toRangeMode,
  withCharsCase,
  withCharsKind,
  withExactly,
  withRange,
  type CharsKind,
  type CharsPiece,
  type PieceClassId,
  type PiecePath,
} from "./formatBuilderModel.js";

export const SAVED_TEXT_NOTICE = "Queda guardado en este equipo: no escribas datos de un caso.";

export interface PieceInspectorProps {
  /** La pieza elegida; `null` = ninguna. */
  readonly piece: FormatPiece | null;
  /** Dónde está la pieza elegida y cuántas piezas tiene su variante: para el título. */
  readonly path: PiecePath | null;
  readonly variantLength: number;
  readonly canMoveLeft: boolean;
  readonly canMoveRight: boolean;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onDelete: () => void;
  readonly onChange: (piece: FormatPiece) => void;
  /** Una parte opcional: suma una pieza adentro. */
  readonly onAddInside: (id: PieceClassId) => void;
  /** Con el tope de piezas, los botones de sumar están apagados. */
  readonly addDisabled: boolean;
}

const KIND_OPTIONS: ReadonlyArray<{
  readonly kind: CharsKind;
  readonly label: string;
  readonly hint: string;
  readonly icon: ReactNode;
}> = [
  {
    kind: "digit",
    label: "Dígitos",
    hint: "Solo números: 4821",
    icon: <HashIcon className="h-4 w-4" aria-hidden />,
  },
  {
    kind: "letter",
    label: "Letras",
    hint: "Solo letras: Gómez",
    icon: <TypeIcon className="h-4 w-4" aria-hidden />,
  },
  {
    kind: "alnum",
    label: "Letras o dígitos",
    hint: "Mezclados: A1B2C",
    icon: <CaseSensitiveIcon className="h-4 w-4" aria-hidden />,
  },
];

const CASE_OPTIONS: ReadonlyArray<{
  readonly value: "letter" | "upper" | "lower";
  readonly label: string;
}> = [
  { value: "letter", label: "Mayúsculas o minúsculas" },
  { value: "upper", label: "Solo MAYÚSCULAS" },
  { value: "lower", label: "Solo minúsculas" },
];

const INPUT_CLASS =
  "w-16 rounded-md border border-border bg-bg-primary px-2 py-1 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function RadioCard({
  checked,
  onSelect,
  children,
}: {
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        checked ? "border-accent bg-accent/10" : "border-border hover:bg-bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function CharsEditor({
  piece,
  onChange,
}: {
  readonly piece: CharsPiece;
  readonly onChange: (piece: FormatPiece) => void;
}) {
  const kind = charsKindOf(piece.charClass);
  const exactly = isExactly(piece);
  return (
    <div className="grid grid-cols-[1.6fr_1.2fr_1fr] gap-4">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-semibold text-text-secondary">Qué va</legend>
        <div role="radiogroup" aria-label="Qué va" className="flex flex-col gap-1">
          {KIND_OPTIONS.map((option) => (
            <RadioCard
              key={option.kind}
              checked={kind === option.kind}
              onSelect={() => onChange(withCharsKind(piece, option.kind))}
            >
              <span className="text-text-secondary">{option.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-text-primary">{option.label}</span>
                <span className="truncate text-xs text-text-secondary">{option.hint}</span>
              </span>
            </RadioCard>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-semibold text-text-secondary">Cuántos</legend>
        <div role="radiogroup" aria-label="Cuántos" className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="format-count-mode"
              checked={exactly}
              onChange={() => onChange(toExactMode(piece))}
            />
            Exactamente
            {exactly ? (
              <input
                type="number"
                min={1}
                max={FORMAT_MAX_REPEAT}
                aria-label="Cantidad exacta"
                value={piece.min}
                onChange={(event) => onChange(withExactly(piece, parseCount(event.target.value)))}
                className={INPUT_CLASS}
              />
            ) : null}
          </label>
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name="format-count-mode"
              checked={!exactly}
              onChange={() => onChange(toRangeMode(piece, FORMAT_MAX_REPEAT))}
            />
            Entre
          </label>
          {exactly ? null : (
            <div className="flex items-center gap-2 pl-6 text-sm text-text-secondary">
              <input
                type="number"
                min={1}
                max={FORMAT_MAX_REPEAT}
                aria-label="Mínimo"
                value={piece.min}
                onChange={(event) =>
                  onChange(withRange(piece, parseCount(event.target.value), piece.max))
                }
                className={INPUT_CLASS}
              />
              y
              <input
                type="number"
                min={1}
                max={FORMAT_MAX_REPEAT}
                aria-label="Máximo"
                value={piece.max}
                onChange={(event) =>
                  onChange(withRange(piece, piece.min, parseCount(event.target.value)))
                }
                className={INPUT_CLASS}
              />
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        {kind === "letter" ? (
          <>
            <legend className="mb-1 text-xs font-semibold text-text-secondary">Escritas</legend>
            <div role="radiogroup" aria-label="Escritas" className="flex flex-col gap-1">
              {CASE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-sm text-text-primary"
                >
                  <input
                    type="radio"
                    name="format-case"
                    checked={piece.charClass === option.value}
                    onChange={() => onChange(withCharsCase(piece, option.value))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </>
        ) : null}
      </fieldset>
    </div>
  );
}

export function PieceInspector({
  piece,
  path,
  variantLength,
  canMoveLeft,
  canMoveRight,
  onMove,
  onDelete,
  onChange,
  onAddInside,
  addDisabled,
}: PieceInspectorProps) {
  return (
    <section
      aria-label="Ajuste de la pieza"
      className="flex h-56 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-3"
    >
      {piece === null || path === null ? (
        <p className="m-auto text-sm text-text-secondary">{BUILDER_COPY.noPieceSelected}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-text-primary">
              {pieceHeading(path, variantLength, piece)}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-secondary">Mover</span>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Mover a la izquierda"
                disabled={!canMoveLeft}
                onClick={() => onMove(-1)}
              >
                <ChevronLeftIcon className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Mover a la derecha"
                disabled={!canMoveRight}
                onClick={() => onMove(1)}
              >
                <ChevronRightIcon className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete}>
                Borrar pieza
              </Button>
            </div>
          </div>

          {piece.kind === "chars" ? <CharsEditor piece={piece} onChange={onChange} /> : null}

          {piece.kind === "separator" ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-secondary">Cuáles admite</span>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {SEPARATOR_OPTIONS.map((option) => (
                  <Checkbox
                    key={option.char}
                    checked={piece.chars.includes(option.char)}
                    onCheckedChange={() =>
                      onChange({ ...piece, chars: toggleSeparator(piece.chars, option.char) })
                    }
                    label={option.label}
                  />
                ))}
              </div>
              <Checkbox
                checked={piece.optional}
                onCheckedChange={(optional) => onChange({ ...piece, optional })}
                label={BUILDER_COPY.separatorOptional(piece.chars[0] ?? "-")}
              />
            </div>
          ) : null}

          {piece.kind === "text" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-text-secondary">Texto</span>
              <input
                type="text"
                value={piece.value}
                maxLength={FORMAT_MAX_TEXT}
                onChange={(event) => onChange({ ...piece, value: event.target.value })}
                className="rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <span className="text-xs text-text-secondary">{SAVED_TEXT_NOTICE}</span>
            </label>
          ) : null}

          {piece.kind === "optional" ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-text-secondary">
                {piece.pieces.length === 1
                  ? "Tiene 1 pieza."
                  : `Tiene ${piece.pieces.length} piezas.`}{" "}
                Arrastrá piezas adentro de la caja, o sumale:
              </span>
              <div className="flex flex-wrap gap-2">
                {OPTIONAL_INNER_MENU.map((entry) => (
                  <Button
                    key={entry.id}
                    variant="secondary"
                    size="sm"
                    disabled={addDisabled}
                    onClick={() => onAddInside(entry.id)}
                  >
                    + {entry.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
