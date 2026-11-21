/**
 * `FormatRow` — una fila de formato de «Formatos de detección»
 * (`Components.md` §13b.2, ADR-227 §2).
 *
 * `Checkbox` para prender y apagar —**no** un interruptor, `UX_Guidelines.md`
 * §11b.4—, nombre y clase, el ejemplo, la etiqueta («Tuyo», «Editado», «Del
 * catálogo», «Con control»), «Editar» si se puede y el menú ⋯ si es del usuario.
 * Una fila apagada se atenúa. Cada columna tiene un ancho reservado: prender,
 * apagar o ganar un menú no mueve nada (UX-10).
 */

import { Checkbox } from "../common/Checkbox.js";

import { ActionsMenu, type ActionsMenuItem } from "./ActionsMenu.js";
import type { FormatRowModel, FormatTag } from "./formatsTree.js";

export interface FormatRowProps {
  readonly row: FormatRowModel;
  readonly onToggle: (enabled: boolean) => void;
  readonly onEdit: () => void;
  /** Vacío = sin menú (los formatos del catálogo no lo tienen). */
  readonly menuItems: ReadonlyArray<ActionsMenuItem>;
}

const TAG_CLASS: Readonly<Record<FormatTag, string>> = {
  Tuyo: "border-accent/40 bg-accent/10 text-accent",
  Editado: "border-accent/40 bg-accent/10 text-accent",
  "Del catálogo": "border-border bg-bg-tertiary text-text-secondary",
  "Con control": "border-border bg-bg-tertiary text-text-secondary",
};

export function FormatRow({ row, onToggle, onEdit, menuItems }: FormatRowProps) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 ${row.enabled ? "" : "opacity-60"}`}
      data-format-row={row.id}
    >
      <div className="min-w-0 flex-1">
        <Checkbox
          id={`format-${row.id}`}
          checked={row.enabled}
          onCheckedChange={onToggle}
          label={
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-text-primary">{row.name}</span>
              <span className="truncate text-xs text-text-secondary">{row.classLabel}</span>
            </span>
          }
        />
      </div>
      <span
        className="hidden w-44 shrink-0 truncate font-mono text-xs text-text-secondary md:block"
        title={row.example}
      >
        {row.example}
      </span>
      <span
        className={`w-24 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-medium ${TAG_CLASS[row.tag]}`}
      >
        {row.tag}
      </span>
      <div className="w-16 shrink-0">
        {row.canEdit ? (
          // «Editar» va sin borde: «Nuevo formato» pesa más (`UX_Guidelines.md` §11b.3).
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Editar ${row.name}`}
            className="rounded-md px-2 py-1 text-sm font-medium text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Editar
          </button>
        ) : null}
      </div>
      <div className="w-7 shrink-0">
        {menuItems.length > 0 ? (
          <ActionsMenu label={`Acciones del formato ${row.name}`} items={menuItems} />
        ) : null}
      </div>
    </div>
  );
}
