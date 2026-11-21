/**
 * `NewTypeBand` — la banda punteada «Nuevo tipo» arriba de la lista de entidades
 * (`Components.md` §13b.6, ADR-229 §1).
 *
 * Tiene la forma de una banda de tipo —el rótulo a la izquierda y, a la derecha,
 * un rectángulo punteado con una flecha, alineado con los selectores de
 * reemplazo de las bandas de abajo— para que se vea qué se agrega. Abre
 * `UserTypeDialog` con `scope: "document"`, `mode: "create"`. Es de alto fijo y
 * no se mueve con la lista.
 */

import { ChevronRightIcon, PlusIcon } from "lucide-react";

import { NEW_TYPE_BAND_HINT, NEW_TYPE_BAND_LABEL } from "./documentTypeCopy.js";

export interface NewTypeBandProps {
  readonly onClick: () => void;
}

export function NewTypeBand({ onClick }: NewTypeBandProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={NEW_TYPE_BAND_LABEL}
      className="flex h-[42px] w-full shrink-0 items-center gap-2 border-y-[1.5px] border-border-strong bg-bg-tertiary pl-2 pr-2 text-left hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <PlusIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
      <span className="shrink-0 text-sm font-bold uppercase tracking-wide text-accent">
        {NEW_TYPE_BAND_LABEL}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
        {NEW_TYPE_BAND_HINT}
      </span>
      {/* Alineado con el selector de reemplazo de las bandas de abajo (mismo ancho y margen). */}
      <span
        aria-hidden
        className="mr-8 flex h-7 w-[6.75rem] shrink-0 items-center justify-end rounded border border-dashed border-border-strong px-2 text-text-secondary"
      >
        <ChevronRightIcon className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
