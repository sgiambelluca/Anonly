/**
 * `FormatTypeBand` — la banda de un tipo en «Formatos de detección»
 * (`Components.md` §13b.2): plegar, punto del tipo (hueco si es propio),
 * nombre, resumen («3 formatos · 1 apagado»), **«Nuevo formato»** si el tipo
 * admite formatos, y el menú ⋯ si es del usuario.
 *
 * «Nuevo formato» lleva borde y texto de acento: pesa más que «Editar»
 * (`UX_Guidelines.md` §11b.3). Las filas del tipo van debajo y se pliegan con
 * la banda.
 */

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { TypeDot } from "../entities/TypeDot.js";

import { ActionsMenu, type ActionsMenuItem } from "./ActionsMenu.js";
import type { TypeBandModel } from "./formatsTree.js";

export interface FormatTypeBandProps {
  readonly band: TypeBandModel;
  readonly folded: boolean;
  readonly onToggleFold: () => void;
  readonly onNewFormat: () => void;
  /** Las acciones del tipo: solo un tipo propio las tiene. */
  readonly menuItems: ReadonlyArray<ActionsMenuItem>;
  /** Las filas del tipo, ya armadas. */
  readonly children: ReactNode;
}

export function FormatTypeBand({
  band,
  folded,
  onToggleFold,
  onNewFormat,
  menuItems,
  children,
}: FormatTypeBandProps) {
  return (
    <section
      aria-label={band.name}
      className="overflow-hidden rounded-xl border border-border bg-bg-primary"
    >
      <div className="flex items-center gap-2 bg-bg-secondary px-3 py-2">
        <button
          type="button"
          onClick={onToggleFold}
          aria-expanded={!folded}
          aria-label={`${folded ? "Desplegar" : "Plegar"} ${band.name}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {folded ? (
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          ) : (
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          )}
          {/* Punto hueco para un tipo propio (`Components.md` §9). */}
          <TypeDot type={band.entityType} />
          <span className="truncate text-sm font-semibold text-text-primary">{band.name}</span>
          <span className="shrink-0 text-sm text-text-secondary">{band.summary}</span>
        </button>
        {band.admitsFormats ? (
          <button
            type="button"
            onClick={onNewFormat}
            aria-label={`Nuevo formato en ${band.name}`}
            className="shrink-0 rounded-md border border-accent px-2.5 py-1 text-sm font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Nuevo formato
          </button>
        ) : null}
        <div className="w-7 shrink-0">
          {menuItems.length > 0 ? (
            <ActionsMenu label={`Acciones del tipo ${band.name}`} items={menuItems} />
          ) : null}
        </div>
      </div>
      {folded ? null : <div className="divide-y divide-border">{children}</div>}
    </section>
  );
}
