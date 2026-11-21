/**
 * `FormatSubgroup` — el subnivel con el nombre de un formato del usuario dentro
 * de un tipo (`Components.md` §13b.6, ADR-226 §2).
 *
 * Solo lo montan los formatos **del usuario**, y solo cuando separa algo
 * (`entityTree.splitByFormat` lo decide). Es un grupo etiquetado y **no un nodo
 * del árbol**: las flechas del teclado siguen recorriendo tipos y filas
 * (`treeNavigation.ts`), y el encabezado es de alto fijo.
 */

import type { ReactNode } from "react";

export interface FormatSubgroupProps {
  readonly name: string;
  readonly count: number;
  readonly children: ReactNode;
}

export function FormatSubgroup({ name, count, children }: FormatSubgroupProps) {
  return (
    <div role="group" aria-label={`Formato ${name}`}>
      <div className="flex h-7 items-center gap-2 border-b border-border bg-bg-secondary pl-9 pr-3 text-sm text-text-secondary">
        <span className="min-w-0 flex-1 truncate">
          Formato: <b className="font-semibold text-text-primary">{name}</b>
        </span>
        <span className="shrink-0 tabular-nums">{count}</span>
      </div>
      {children}
    </div>
  );
}
