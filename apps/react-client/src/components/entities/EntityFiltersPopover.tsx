/**
 * `EntityFiltersPopover` — el botón «Filtros» del panel y su panel flotante
 * (`Components.md` §13b.6, ADR-229 §5, `React_Client.md` §3.10).
 *
 * El botón va junto al buscador de la lista y abre un panel **flotante**: no
 * agrega una fila de fichas ni mueve la lista (`UX_Guidelines.md` §11b.7). Tres
 * secciones de casillas:
 *
 * - **«Tus formatos»**: los formatos del usuario que detectaron algo en el
 *   documento. **Si no hay ninguno, la sección no se muestra** (ADR-226 §3).
 * - **«Modo de reemplazo»**: cada modo con una muestra de cómo queda y su cantidad.
 * - **«Para revisar»**: desactivadas, con conflicto, y agregadas o editadas a
 *   mano, cada una con una línea que dice qué es.
 *
 * Pie con «Quitar filtros» y «Listo». Los filtros son de la interfaz: no emiten
 * nada y no entran a la pila de deshacer (`useEntitiesStore.filters`).
 */

import { ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { FilterIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useDetectionStore } from "../../store/detection.store.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";

import {
  activeFilterCount,
  formatFilterOptions,
  hasActiveFilters,
  MODE_FILTER_ORDER,
  MODE_FILTER_SAMPLE,
  modeCounts,
  REVIEW_FILTER_OPTIONS,
  toggleInSet,
  userFormatNameOf,
} from "./entityFilters.js";
import { REPLACEMENT_MODE_LABEL } from "./replacementModeOptions.js";

export interface EntityFiltersPopoverProps {
  /** Todos los grupos del documento, sin filtrar: de ahí salen las opciones y las cantidades. */
  readonly groups: ReadonlyArray<EntityGroup>;
}

export function EntityFiltersPopover({ groups }: EntityFiltersPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const filters = useEntitiesStore((state) => state.filters);
  const detection = useDetectionStore((state) => state.saved);
  const count = activeFilterCount(filters);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      // En un evento de mouse del documento `target` es siempre un `Node`
      // (narrowing seguro, mismo criterio que `GroupContextMenu`).
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [open]);

  const formatOptions = formatFilterOptions(groups, userFormatNameOf(detection));
  const counts = modeCounts(groups);
  // `getState()` dentro de los handlers: el valor vigente al hacer clic, no el del render.
  const store = useEntitiesStore.getState;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={count > 0 ? `Filtros (${count})` : "Filtros"}
        onClick={() => setOpen(!open)}
        className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          count > 0
            ? "border-accent bg-accent/10 font-semibold text-text-primary"
            : "border-border text-text-secondary hover:bg-bg-tertiary"
        }`}
      >
        <FilterIcon className="h-3.5 w-3.5" aria-hidden />
        Filtros
        {count > 0 ? (
          <span className="rounded-full bg-accent px-1.5 text-sm font-semibold leading-5 text-accent-foreground">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="group"
          aria-label="Filtros de la lista"
          className="absolute left-0 top-full z-50 mt-1 flex max-h-[min(70vh,30rem)] w-[20rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-bg-primary text-sm shadow-md"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {formatOptions.length > 0 ? (
              <Section title="Tus formatos">
                {formatOptions.map((option) => (
                  <Checkbox
                    key={option.formatId}
                    checked={filters.formatIds.has(option.formatId)}
                    onCheckedChange={() =>
                      store().setFilters({
                        ...store().filters,
                        formatIds: toggleInSet(store().filters.formatIds, option.formatId),
                      })
                    }
                    label={
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        <span className="shrink-0 tabular-nums text-text-secondary">
                          {option.count}
                        </span>
                      </span>
                    }
                  />
                ))}
              </Section>
            ) : null}
            <Section title="Modo de reemplazo">
              {MODE_FILTER_ORDER.map((mode) => (
                <Checkbox
                  key={mode}
                  checked={filters.modes.has(mode)}
                  onCheckedChange={() =>
                    store().setFilters({
                      ...store().filters,
                      modes: toggleInSet(store().filters.modes, mode),
                    })
                  }
                  label={
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {REPLACEMENT_MODE_LABEL[mode]}
                      </span>
                      <ModeSample mode={mode} />
                      <span className="w-6 shrink-0 text-right tabular-nums text-text-secondary">
                        {counts[mode]}
                      </span>
                    </span>
                  }
                />
              ))}
            </Section>
            <Section title="Para revisar">
              {REVIEW_FILTER_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  checked={filters.review.has(option.value)}
                  onCheckedChange={() =>
                    store().setFilters({
                      ...store().filters,
                      review: toggleInSet(store().filters.review, option.value),
                    })
                  }
                  label={
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span>{option.label}</span>
                      <span className="text-text-secondary">{option.description}</span>
                    </span>
                  }
                />
              ))}
            </Section>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
            <Button
              variant="secondary"
              disabled={!hasActiveFilters(filters)}
              onClick={() => store().clearFilters()}
            >
              Quitar filtros
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Listo
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">{title}</h3>
      {children}
    </section>
  );
}

/** La muestra de cómo queda un modo: texto en una caja de ancho fijo; el bloque negro se dibuja. */
function ModeSample({ mode }: { readonly mode: ReplacementMode }) {
  return (
    <span className="flex h-5 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-bg-tertiary px-1 font-mono text-text-primary">
      {mode === ReplacementMode.Redact ? (
        <span aria-hidden className="h-3 w-full rounded-sm bg-text-primary" />
      ) : (
        <span className="truncate">{MODE_FILTER_SAMPLE[mode]}</span>
      )}
    </span>
  );
}
