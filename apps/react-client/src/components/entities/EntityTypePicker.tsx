/**
 * `EntityTypePicker` — el selector de `EntityType` único de la app
 * (ADR-169 §7, `Components.md` §8.10).
 *
 * Reemplaza al `Select` de tipo y a los chips sueltos en cuatro lugares: la
 * selección sobre el original, la lupa, "Agregar entidad" y "Cambiar tipo".
 * Los **13 tipos** en una grilla dentro de una caja gris, cada uno con su punto
 * de color (`Components.md` §9), su nombre y un botón de opción.
 *
 * `role="radiogroup"` + `role="radio"` con `aria-checked`. Las flechas mueven
 * la elección dentro del grupo (patrón WAI-ARIA de radio group): un solo tab
 * stop, el del elegido.
 */

import type { EntityType } from "@anonly/anonymization-core";
import { useRef, type KeyboardEvent } from "react";

import { ENTITY_TYPE_COLOR } from "./entityTypeColors.js";
import { ENTITY_TYPE_ORDER, ENTITY_TYPE_SINGULAR } from "./entityTypeLabels.js";

export interface EntityTypePickerProps {
  readonly value: EntityType;
  readonly onChange: (type: EntityType) => void;
  /** Tipo vigente: se muestra marcado "Actual" y no se puede elegir (`ChangeTypeDialog`). */
  readonly current?: EntityType;
  /** Dos columnas en globos, tres en diálogos (`Components.md` §8.10). */
  readonly columns?: 2 | 3;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
}

const COLUMNS_CLASS: Readonly<Record<2 | 3, string>> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
};

export function EntityTypePicker({
  value,
  onChange,
  current,
  columns = 2,
  ...aria
}: EntityTypePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectable = ENTITY_TYPE_ORDER.filter((type) => type !== current);
  // Un solo tab stop: el elegido, o el primero elegible si todavía no hay uno.
  const focusType = selectable.includes(value) ? value : selectable[0];

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = selectable.indexOf(value);
    const next = selectable[(index + step + selectable.length) % selectable.length];
    if (next === undefined) return;
    onChange(next);
    containerRef.current?.querySelector<HTMLButtonElement>(`[data-entity-type="${next}"]`)?.focus();
  }

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      {...(aria["aria-label"] !== undefined ? { "aria-label": aria["aria-label"] } : {})}
      {...(aria["aria-labelledby"] !== undefined
        ? { "aria-labelledby": aria["aria-labelledby"] }
        : {})}
      onKeyDown={handleKeyDown}
      className={`grid gap-0.5 rounded-lg border border-border bg-bg-tertiary p-1.5 ${COLUMNS_CLASS[columns]}`}
    >
      {ENTITY_TYPE_ORDER.map((type) => {
        const isCurrent = type === current;
        const checked = type === value && !isCurrent;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={isCurrent}
            disabled={isCurrent}
            data-entity-type={type}
            tabIndex={type === focusType ? 0 : -1}
            onClick={() => {
              if (!isCurrent) onChange(type);
            }}
            className={`flex h-8 min-w-0 items-center gap-2 rounded-md border px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              checked
                ? "border-accent bg-bg-primary font-semibold text-text-primary ring-2 ring-accent/15"
                : isCurrent
                  ? "cursor-default border-transparent text-text-secondary"
                  : "border-transparent text-text-primary hover:border-border hover:bg-bg-primary"
            }`}
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: ENTITY_TYPE_COLOR[type] }}
            />
            <span className="min-w-0 flex-1 truncate">{ENTITY_TYPE_SINGULAR[type]}</span>
            {isCurrent ? (
              <span className="shrink-0 text-sm text-text-secondary">Actual</span>
            ) : (
              <span
                aria-hidden
                className={`h-3.5 w-3.5 shrink-0 rounded-full ${
                  checked ? "border-4 border-accent" : "border-[1.5px] border-border"
                }`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
