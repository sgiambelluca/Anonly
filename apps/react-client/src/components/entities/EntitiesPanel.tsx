/**
 * `EntitiesPanel` (`ui/Components.md` §3.1, rediseñado por ADR-169 §2/§7).
 *
 * **Cabecera**: "Entidades" con el resumen ("N entidades en M tipos"), el
 * botón **primario** "Agregar entidad" (antes un enlace de texto casi
 * invisible), el filtro, el orden **Aparición | A–Z** (`entities.store.
 * sortOrder`, solo presentación) y la franja "Todo el documento"
 * (`DocumentModeSelect`). Debajo, el **encabezado de columnas** fijo —N.º ·
 * Entidad · Avisos · Apar. · Reemplazo—, que existe para que el N.º no se
 * confunda con el contador de apariciones.
 *
 * **Nota al pie** "¿Falta algo?…" con su X (`settings.store.dismissedHints`,
 * persistido): el descubrimiento de que se puede seleccionar texto en el
 * original o buscarlo con la lupa (ADR-169 §7).
 *
 * `App.tsx` solo monta este componente cuando `groupsByType` tiene contenido
 * (`hasAnyGroup`); el estado vacío vive ahí (`UX_Guidelines.md` §11).
 *
 * Expansión por tipo: se trackea el conjunto de tipos **colapsados** para que
 * un tipo nuevo (`ENTITY_GROUP_CREATED` incremental, UX-6) arranque expandido.
 *
 * **Teclado del árbol** (`UX_Guidelines.md` §9): este componente es el dueño
 * del nodo activo; qué hace cada tecla lo decide `treeNavigation.ts`. El
 * roving tabindex es sobre los `treeitem`, no sobre toda la fila: cada fila
 * tiene además su casilla, su selector de modo, su género y su menú, con tab
 * stop propio — desvío conocido del patrón WAI-ARIA de tree, anotado en
 * `roadmap/Post_Hito10.8_Pendientes.md` §22 con `treegrid` como destino.
 *
 * Dos reglas que arreglan bugs medidos:
 *
 * 1. **El foco se escucha en el contenedor del árbol** y el nodo se deduce con
 *    `closest`: el `onFocus` de React burbujea, y con un listener por nodo
 *    enfocar una fila disparaba también el de su cabecera de tipo.
 * 2. **El árbol solo atiende teclas cuando el foco está en el `treeitem`
 *    mismo.** Con el foco en un control de adentro, `Space` burbujeaba hasta
 *    acá, cancelaba la activación nativa del botón y cambiaba otra fila.
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  MousePointerClickIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEntitiesStore, type EntitySortOrder } from "../../store/entities.store.js";
import { dismissHint, useSettingsStore } from "../../store/settings.store.js";

import { AddEntityDialog } from "./AddEntityDialog.js";
import { applyEnabled } from "./applyEdits.js";
import { DocumentModeSelect } from "./DocumentModeSelect.js";
import { ENTITY_ROW_GRID, ENTITY_ROW_PADDING } from "./entityRowLayout.js";
import {
  filterGroups,
  findGroupById,
  summarizeEntities,
  visibleTypeEntries,
} from "./entityTree.js";
import { EntityTypeGroup } from "./EntityTypeGroup.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";
import { groupNodeId, resolveTreeKey, typeNodeId, type TreeNode } from "./treeNavigation.js";

const SORT_OPTIONS: ReadonlyArray<{ readonly value: EntitySortOrder; readonly label: string }> = [
  { value: "appearance", label: "Aparición" },
  { value: "alpha", label: "A–Z" },
];

export function EntitiesPanel() {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const sortOrder = useEntitiesStore((state) => state.sortOrder);
  const flashGroupId = useEntitiesStore((state) => state.flashGroupId);
  const footerHintDismissed = useSettingsStore((state) =>
    state.dismissedHints.includes("panel-footer-hint"),
  );
  const [query, setQuery] = useState("");
  const [collapsedTypes, setCollapsedTypes] = useState<ReadonlySet<EntityType>>(new Set());
  const [addEntityOpen, setAddEntityOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Solo se mueve el foco cuando el movimiento lo pidió el teclado. Sin esto,
   * un re-render cualquiera (llega un grupo nuevo, cambia un filtro) le
   * robaría el foco a donde esté el usuario.
   */
  const focusPending = useRef(false);

  // `Cmd/Ctrl+F`: la tabla de atajos de `UX_Guidelines.md` §9 ya lo prometía.
  useEffect(() => {
    function onKeydown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  // "Ver en la lista" (ADR-169 §7): la fila tiene que estar a la vista, así
  // que se expande su tipo y, si el filtro la esconde, se limpia el filtro.
  useEffect(() => {
    if (flashGroupId === null) return;
    const group = findGroupById(groupsByType, flashGroupId);
    if (group === undefined) return;
    setCollapsedTypes((previous) => {
      if (!previous.has(group.type)) return previous;
      const next = new Set(previous);
      next.delete(group.type);
      return next;
    });
    setQuery((previous) => (filterGroups([group], previous).length === 0 ? "" : previous));
  }, [flashGroupId]);

  const entries = visibleTypeEntries(groupsByType, sortOrder);
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

  // Lista plana de lo que se VE: los hijos de un tipo colapsado no están, así
  // que las flechas recorren exactamente lo que hay en pantalla.
  const nodes: ReadonlyArray<TreeNode> = filteredEntries.flatMap(([type, groups]) => {
    const expanded = !collapsedTypes.has(type);
    const typeNode: TreeNode = { kind: "type", id: typeNodeId(type), expanded };
    if (!expanded) return [typeNode];
    return [
      typeNode,
      ...groups.map(
        (group): TreeNode => ({
          kind: "group",
          id: groupNodeId(group.id),
          parentId: typeNodeId(type),
        }),
      ),
    ];
  });

  /**
   * Sin nodo activo todavía, el `tabIndex=0` lo lleva el primero: si no,
   * ningún nodo sería tabulable y `Tab` saltearía el árbol entero.
   */
  const effectiveActiveId = activeId ?? nodes[0]?.id ?? null;

  // El nodo activo puede desaparecer bajo los pies (un filtro que deja de
  // matchear, un grupo que se fusiona). Sin esto el árbol se quedaría sin
  // ningún `tabIndex=0` y `Tab` lo saltearía entero.
  useEffect(() => {
    if (activeId !== null && !nodes.some((node) => node.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, nodes]);

  useEffect(() => {
    if (activeId === null || !focusPending.current) return;
    focusPending.current = false;
    const element = treeRef.current?.querySelector<HTMLElement>(
      `[data-tree-node-id="${CSS.escape(activeId)}"]`,
    );
    element?.focus();
  }, [activeId]);

  function handleTreeFocus(event: React.FocusEvent<HTMLDivElement>): void {
    const node = event.target.closest<HTMLElement>("[data-tree-node-id]");
    const nodeId = node?.dataset["treeNodeId"];
    if (nodeId !== undefined) setActiveId(nodeId);
  }

  function groupById(nodeId: string): EntityGroup | undefined {
    return filteredEntries
      .flatMap(([, groups]) => groups)
      .find((group) => groupNodeId(group.id) === nodeId);
  }

  function typeEntryById(
    nodeId: string,
  ): readonly [EntityType, ReadonlyArray<EntityGroup>] | undefined {
    return filteredEntries.find(([type]) => typeNodeId(type) === nodeId);
  }

  function handleTreeKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // Regla 2 de la cabecera: el árbol atiende una tecla solo si el foco está
    // en el contenedor `treeitem`.
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute("data-tree-node-id")) return;

    const command = resolveTreeKey(nodes, activeId, event.key);
    if (command === null) return;
    event.preventDefault();

    switch (command.kind) {
      case "focus":
        focusPending.current = true;
        setActiveId(command.nodeId);
        return;
      case "expand":
      case "collapse": {
        const entry = typeEntryById(command.nodeId);
        if (entry !== undefined) toggleType(entry[0]);
        return;
      }
      case "toggleEnabled": {
        // Mismo camino que los checkboxes del árbol, incluido el "Deshacer".
        const group = groupById(command.nodeId);
        if (group !== undefined) {
          applyEnabled({
            groups: [group],
            next: !group.enabled,
            label: group.canonicalValue,
            isType: false,
          });
          return;
        }
        const entry = typeEntryById(command.nodeId);
        if (entry === undefined) return;
        applyEnabled({
          groups: entry[1],
          next: !entry[1].some((group) => group.enabled),
          label: ENTITY_TYPE_LABEL[entry[0]],
          isType: true,
        });
        return;
      }
      case "openMenu": {
        // El menú lo monta `EntityGroupItem`: se le da un click a su
        // disparador, que es lo mismo que hace el mouse.
        treeRef.current
          ?.querySelector<HTMLElement>(
            `[data-tree-node-id="${CSS.escape(command.nodeId)}"] [data-tree-menu-trigger]`,
          )
          ?.click();
        return;
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-base font-semibold text-text-primary">Entidades</h2>
            <span className="truncate text-sm text-text-secondary">
              {summarizeEntities(entries)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setAddEntityOpen(true)}
            className="anonly-button-primary h-9 shrink-0 px-3.5"
          >
            <PlusIcon className="h-4 w-4" aria-hidden />
            Agregar entidad
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filtrar la lista…"
              aria-label="Buscar entidades"
              // `bg-bg-primary` explícito: un input que declara color de texto
              // tiene que declarar su fondo (`dark-mode-contrast.spec.ts`).
              className="h-8 w-full rounded-md border border-border bg-bg-primary pl-8 pr-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div
            role="group"
            aria-label="Ordenar entidades"
            className="flex shrink-0 rounded-md bg-bg-tertiary p-0.5"
          >
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={sortOrder === option.value}
                onClick={() => useEntitiesStore.getState().setSortOrder(option.value)}
                className={`h-7 rounded px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  sortOrder === option.value
                    ? "bg-bg-primary font-semibold text-text-primary shadow-sm"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={expandAll}
            aria-label="Expandir todo"
            title="Expandir todo"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronsUpDownIcon className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={collapseAll}
            aria-label="Colapsar todo"
            title="Colapsar todo"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronsDownUpIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {/*
          Nivel documento (ADR-087 §3.9): fuera del árbol y arriba de él.
          Estar entre las filas es exactamente lo que el tratamiento visual
          tiene que evitar — es el control de mayor alcance de los tres.
        */}
        <DocumentModeSelect />
      </div>

      {/* Encabezado de columnas (ADR-169 §2): misma grilla que las filas. */}
      <div
        aria-hidden
        className={`h-[30px] shrink-0 border-y border-border bg-bg-secondary text-sm font-semibold uppercase tracking-wide text-text-secondary ${ENTITY_ROW_GRID} ${ENTITY_ROW_PADDING}`}
      >
        <span />
        <span>N.º</span>
        <span>Entidad{sortOrder === "alpha" ? " ↓" : ""}</span>
        <span>Avisos</span>
        <span className="text-right" title="Apariciones en el documento">
          Apar.
        </span>
        <span />
        <span>Reemplazo</span>
        <span />
      </div>

      <div
        ref={treeRef}
        role="tree"
        aria-label="Entidades detectadas"
        onKeyDown={handleTreeKeyDown}
        // Regla 1 de la cabecera: un solo listener acá.
        onFocus={handleTreeFocus}
        className="min-h-0 flex-1 overflow-y-auto pb-3"
      >
        {noSearchResults ? (
          <p className="p-4 text-center text-sm text-text-secondary">
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
              nodeId={typeNodeId(type)}
              activeNodeId={effectiveActiveId}
            />
          ))
        )}
      </div>

      {footerHintDismissed ? null : (
        // ADR-169 §7: la nota al pie con su X. Cerrada una vez, no vuelve.
        <div
          role="note"
          className="mx-3 mb-3 flex shrink-0 items-start gap-2.5 rounded-lg border border-dashed border-accent/40 bg-accent/10 py-2.5 pl-3 pr-1.5"
        >
          <MousePointerClickIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <p className="flex-1 text-sm leading-snug text-text-primary">
            <b className="font-semibold">¿Falta algo?</b> Seleccioná el texto con clic y arrastre en
            el PDF original, o buscalo con la lupa de arriba del documento.
          </p>
          <button
            type="button"
            aria-label="Cerrar sugerencia"
            onClick={() => dismissHint("panel-footer-hint")}
            className="-mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <XIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      <AddEntityDialog open={addEntityOpen} onClose={() => setAddEntityOpen(false)} />
    </div>
  );
}
