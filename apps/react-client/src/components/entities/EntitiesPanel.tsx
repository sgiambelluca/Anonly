/**
 * `EntitiesPanel` (`ui/Components.md` §3.1).
 *
 * Lista `groupsByType` ordenada por `EntityType` (orden fijo de
 * `entities.store.ts`/`ui/Components.md` §3.1, ya preservado por
 * `visibleTypeEntries`). Header: "Entidades" + input de búsqueda + "Colapsar
 * todo"/"Expandir todo" (`ui/UX_Guidelines.md` §3.2).
 *
 * `App.tsx` solo monta este componente cuando `groupsByType` tiene contenido
 * (`hasAnyGroup`); el estado vacío "sin documento"/"sin entidades" vive ahí
 * (`ui/UX_Guidelines.md` §11).
 *
 * Expansión por tipo: se trackea el conjunto de tipos **colapsados** (no los
 * expandidos) para que un tipo nuevo que recién aparece (`ENTITY_GROUP_CREATED`
 * incremental, UX-6) arranque expandido por default sin lógica adicional.
 */

import type { EntityType } from "@anonly/anonymization-core";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";

import { AddEntityDialog } from "./AddEntityDialog.js";
import { filterGroups, visibleTypeEntries } from "./entityTree.js";
import { EntityTypeGroup } from "./EntityTypeGroup.js";

export function EntitiesPanel() {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const [query, setQuery] = useState("");
  const [collapsedTypes, setCollapsedTypes] = useState<ReadonlySet<EntityType>>(new Set());
  const [addEntityOpen, setAddEntityOpen] = useState(false);

  const entries = visibleTypeEntries(groupsByType);
  const filteredEntries = entries
    .map(([type, groups]) => [type, filterGroups(groups, query)] as const)
    .filter(([, groups]) => groups.length > 0);
  const noSearchResults = query.trim() !== "" && filteredEntries.length === 0;

  function toggleType(type: EntityType): void {
    setCollapsedTypes((previous) => {
      const next = new Set(previous);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function expandAll(): void {
    setCollapsedTypes(new Set());
  }

  function collapseAll(): void {
    setCollapsedTypes(new Set(entries.map(([type]) => type)));
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Entidades
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setAddEntityOpen(true)}
              className="flex items-center gap-1 font-medium text-accent hover:underline"
            >
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              Agregar entidad
            </button>
            <span className="text-text-secondary">·</span>
            <button type="button" onClick={expandAll} className="text-accent hover:underline">
              Expandir todo
            </button>
            <span className="text-text-secondary">·</span>
            <button type="button" onClick={collapseAll} className="text-accent hover:underline">
              Colapsar todo
            </button>
          </div>
        </div>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar entidades…"
            aria-label="Buscar entidades"
            className="w-full rounded-md border border-border py-1 pl-7 pr-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>
      <div role="tree" aria-label="Entidades detectadas" className="flex-1 overflow-y-auto">
        {noSearchResults ? (
          <p className="p-4 text-center text-xs text-text-secondary">
            No se encontraron entidades para &quot;{query}&quot;.
          </p>
        ) : (
          filteredEntries.map(([type, groups]) => (
            <EntityTypeGroup
              key={type}
              type={type}
              groups={groups}
              expanded={!collapsedTypes.has(type)}
              onToggleExpanded={() => toggleType(type)}
            />
          ))
        )}
      </div>
      <AddEntityDialog open={addEntityOpen} onClose={() => setAddEntityOpen(false)} />
    </div>
  );
}
