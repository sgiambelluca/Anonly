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
  MinusIcon,
  PlusIcon,
  TypeIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";

import {
  charsKindOf,
  isExactly,
  OPTIONAL_INNER_MENU,
  pieceHeading,
  BUILDER_COPY,
  SEPARATOR_OPTIONS,
  stepExactly,
  stepMax,
  stepMin,
  toExactMode,
  toggleSeparator,
  toRangeMode,
  withCharsCase,
  withCharsKind,
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

/** Una fila del ajuste: la etiqueta a la izquierda y los controles a su derecha. */
function InspectorRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

/** Dos o tres opciones excluyentes en una tira (`role="group"` + `aria-pressed`). */
function Segmented({
  label,
  options,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly on: boolean;
    readonly onPick: () => void;
  }>;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 rounded-lg border border-border bg-bg-tertiary p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.on}
          onClick={option.onPick}
          className={`h-7 rounded-md px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            option.on
              ? "bg-bg-primary font-semibold text-text-primary shadow-sm"
              : "text-text-secondary hover:text-text-primary"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Un número con sus botones − y +. */
function Stepper({
  value,
  minusLabel,
  plusLabel,
  onMinus,
  onPlus,
}: {
  readonly value: number;
  readonly minusLabel: string;
  readonly plusLabel: string;
  readonly onMinus: () => void;
  readonly onPlus: () => void;
}) {
  const buttonClass =
    "flex h-8 w-8 items-center justify-center text-text-secondary hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  return (
    <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border">
      <button type="button" aria-label={minusLabel} onClick={onMinus} className={buttonClass}>
        <MinusIcon className="h-4 w-4" aria-hidden />
      </button>
      <span className="w-8 text-center text-sm font-semibold tabular-nums text-text-primary">
        {value}
      </span>
      <button type="button" aria-label={plusLabel} onClick={onPlus} className={buttonClass}>
        <PlusIcon className="h-4 w-4" aria-hidden />
      </button>
    </span>
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
    <div className="flex flex-col gap-1">
      <InspectorRow label="Qué va">
        <div role="radiogroup" aria-label="Qué va" className="grid flex-1 grid-cols-3 gap-2">
          {KIND_OPTIONS.map((option) => (
            <RadioCard
              key={option.kind}
              checked={kind === option.kind}
              onSelect={() => onChange(withCharsKind(piece, option.kind))}
            >
              <span className="text-text-secondary">{option.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-text-primary">
                  {option.label}
                </span>
                <span className="truncate text-xs text-text-secondary">{option.hint}</span>
              </span>
            </RadioCard>
          ))}
        </div>
      </InspectorRow>

      <InspectorRow label="Cuántos">
        <Segmented
          label="Cantidad"
          options={[
            {
              key: "exactly",
              label: "Exactamente",
              on: exactly,
              onPick: () => onChange(toExactMode(piece)),
            },
            {
              key: "range",
              label: "Entre",
              on: !exactly,
              onPick: () => onChange(toRangeMode(piece, FORMAT_MAX_REPEAT)),
            },
          ]}
        />
        {exactly ? (
          <Stepper
            value={piece.max}
            minusLabel="Uno menos"
            plusLabel="Uno más"
            onMinus={() => onChange(stepExactly(piece, -1, FORMAT_MAX_REPEAT))}
            onPlus={() => onChange(stepExactly(piece, 1, FORMAT_MAX_REPEAT))}
          />
        ) : (
          <>
            <Stepper
              value={piece.min}
              minusLabel="Mínimo, uno menos"
              plusLabel="Mínimo, uno más"
              onMinus={() => onChange(stepMin(piece, -1))}
              onPlus={() => onChange(stepMin(piece, 1))}
            />
            <span className="text-sm text-text-secondary">y</span>
            <Stepper
              value={piece.max}
              minusLabel="Máximo, uno menos"
              plusLabel="Máximo, uno más"
              onMinus={() => onChange(stepMax(piece, -1, FORMAT_MAX_REPEAT))}
              onPlus={() => onChange(stepMax(piece, 1, FORMAT_MAX_REPEAT))}
            />
          </>
        )}
      </InspectorRow>

      {kind === "letter" ? (
        <InspectorRow label="Escritas">
          <Segmented
            label="Mayúsculas o minúsculas"
            options={CASE_OPTIONS.map((option) => ({
              key: option.value,
              label: option.label,
              on: piece.charClass === option.value,
              onPick: () => onChange(withCharsCase(piece, option.value)),
            }))}
          />
        </InspectorRow>
      ) : null}
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
      className={`flex shrink-0 flex-col gap-3 rounded-lg border border-border p-3 ${
        // El alto fijo vale con una pieza elegida; sin pieza, el estado vacío es más bajo.
        piece === null || path === null ? "" : "h-[12.25rem] overflow-y-auto"
      }`}
    >
      {piece === null || path === null ? (
        <p className="text-sm text-text-secondary">{BUILDER_COPY.noPieceSelected}</p>
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
              <Button
                variant="ghost"
                size="sm"
                className="!text-error hover:!bg-error/10"
                onClick={onDelete}
              >
                Borrar pieza
              </Button>
            </div>
          </div>

          {piece.kind === "chars" ? <CharsEditor piece={piece} onChange={onChange} /> : null}

          {piece.kind === "separator" ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-secondary">Cuáles admite</span>
              <div role="group" aria-label="Cuáles admite" className="grid grid-cols-4 gap-2">
                {SEPARATOR_OPTIONS.map((option) => {
                  const on = piece.chars.includes(option.char);
                  return (
                    <button
                      key={option.char}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        onChange({ ...piece, chars: toggleSeparator(piece.chars, option.char) })
                      }
                      className={`flex h-10 items-center gap-2.5 rounded-lg border px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        on ? "border-accent bg-accent/10" : "border-border hover:bg-bg-secondary"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`w-4 text-center font-mono text-lg font-semibold ${
                          on ? "text-accent" : "text-text-secondary"
                        }`}
                      >
                        {option.char === " " ? "␣" : option.char}
                      </span>
                      <span className="truncate text-sm font-medium text-text-primary">
                        {option.label}
                      </span>
                    </button>
                  );
                })}
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
