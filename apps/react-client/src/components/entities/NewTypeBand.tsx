/**
 * `NewTypeBand` — la banda punteada «Nuevo tipo» arriba de la lista de entidades
 * (`Components.md` §13b.6, ADR-229 §1; lienzo `NuevoTipoDocumento.dc.html`,
 * `.ghostband`).
 *
 * Es una banda fantasma —borde punteado de acento, «+ NUEVO TIPO» a la izquierda
 * y, a la derecha, el fantasma del selector de reemplazo de las bandas de abajo—
 * para que se vea qué se agrega. Abre `UserTypeDialog` con `scope: "document"`,
 * `mode: "create"`. Es de alto fijo y no se mueve con la lista.
 */

import { ChevronDownIcon, PlusIcon } from "lucide-react";

import { NEW_TYPE_BAND_HINT, NEW_TYPE_BAND_LABEL } from "./documentTypeCopy.js";

export interface NewTypeBandProps {
  readonly onClick: () => void;
}

export function NewTypeBand({ onClick }: NewTypeBandProps) {
  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={NEW_TYPE_BAND_LABEL}
        title={NEW_TYPE_BAND_HINT}
        className="flex h-[38px] w-full items-center gap-2 rounded-[9px] border-[1.5px] border-dashed border-accent/40 pl-3 pr-2 text-left text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <PlusIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} aria-hidden />
        <span className="shrink-0 text-sm font-bold uppercase tracking-wide">
          {NEW_TYPE_BAND_LABEL}
        </span>
        <span className="flex-1" />
        {/* El fantasma del selector de reemplazo de las bandas de abajo. */}
        <span
          aria-hidden
          className="mr-[30px] flex h-[26px] w-[92px] shrink-0 items-center justify-end rounded-[7px] border-[1.5px] border-dashed border-accent/40 px-1.5 text-text-secondary"
        >
          <ChevronDownIcon className="h-3 w-3" />
        </span>
      </button>
    </div>
  );
}
