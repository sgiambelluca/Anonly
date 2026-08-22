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
 *
 * **Teclado del árbol** (`UX_Guidelines.md` §9): este componente es el dueño
 * del nodo activo (roving tabindex: exactamente un `treeitem` con
 * `tabIndex=0`, el resto `-1`, de modo que `Tab` entra y sale del árbol de una
 * y las flechas navegan adentro). Qué hace cada tecla lo decide
 * `treeNavigation.ts`; acá solo se ejecuta el comando. El foco se aplica por
 * `data-tree-node-id` en vez de con un `ref` por fila: la lista es virtual en
 * la práctica (cientos de filas) y mantener un mapa de refs vivo sería más
 * estado para el mismo resultado.
 */

import type { EntityGroup, EntityType } from "@anonly/anonymization-core";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";

import { AddEntityDialog } from "./AddEntityDialog.js";
import { applyEnabled } from "./applyEdits.js";
import { DocumentModeSelect } from "./DocumentModeSelect.js";
import { filterGroups, visibleTypeEntries } from "./entityTree.js";
import { EntityTypeGroup } from "./EntityTypeGroup.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";
import { groupNodeId, resolveTreeKey, typeNodeId, type TreeNode } from "./treeNavigation.js";

export function EntitiesPanel() {
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
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
  // Se toma el atajo del navegador a propósito — dentro del documento buscar
  // es esto, y el buscador nativo del navegador sobre un visor de canvas no
  // encuentra nada.
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
   * ningún nodo sería tabulable y `Tab` saltearía el árbol entero en vez de
   * entrar en él.
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
    // Adentro de un input o de un menú abierto las mismas teclas significan
    // otra cosa (escribir, elegir opción); el árbol no se las roba.
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [role='menu'], [role='dialog']") !== null) return;

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
        // Mismo camino que los checkboxes del árbol, incluido el "Deshacer":
        // `Space` sobre una cabecera apaga decenas de grupos sin siquiera un
        // diálogo de por medio, así que es el caso que MÁS lo necesita.
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
        // Cabecera de tipo: mismo criterio que su checkbox cascade — si hay
        // alguno habilitado, apaga todos; si no, prende todos.
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
        // El menú lo monta `EntityGroupItem`; abrirlo desde acá sería mover su
        // estado al panel. Se le da un click a su disparador, que es lo mismo
        // que hace el mouse.
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
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        {/*
          Título y acciones en dos filas, no en una. Con la escala tipográfica
          en 14 px mínimo (`UX_Guidelines.md` §9) los tres links no entraban al
          lado del título en la barra lateral y se partían en dos líneas cada
          uno — "Agregar / entidad", "Expandir / todo". Apilarlos es más
          barato que abreviar las etiquetas hasta que dejen de decir qué hacen.
        */}
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Entidades
        </h2>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
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
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar entidades…"
            aria-label="Buscar entidades"
            className="w-full rounded-md border border-border py-1 pl-7 pr-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>
      {/*
        Nivel documento (ADR-087 §3.9): fuera del árbol y arriba de él. Estar
        entre las filas es exactamente lo que el tratamiento visual tiene que
        evitar — es el control de mayor alcance de los tres.
      */}
      <DocumentModeSelect />
      <div
        ref={treeRef}
        role="tree"
        aria-label="Entidades detectadas"
        onKeyDown={handleTreeKeyDown}
        className="flex-1 overflow-y-auto"
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
              onNodeFocus={setActiveId}
            />
          ))
        )}
      </div>
      <AddEntityDialog open={addEntityOpen} onClose={() => setAddEntityOpen(false)} />
    </div>
  );
}
