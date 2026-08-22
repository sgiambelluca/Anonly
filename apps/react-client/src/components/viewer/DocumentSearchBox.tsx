/**
 * `DocumentSearchBox` (`ui/Components.md` §5.4c, ADR-061 §8).
 *
 * Junto al encabezado "PDF ORIGINAL" (`PdfViewer.tsx`, solo `kind === "original"`).
 * `findText` es sincrónica y recorre todo el documento en el main thread
 * (`Regex_Engine.md` §12) — el debounce de la búsqueda es responsabilidad de
 * este componente (`searchDebounce.ts`), no del Core.
 *
 * Contador + anterior/siguiente mueven `activeIndex` sobre el array que ya
 * viene en orden documental (§6 del motor) y avisan al padre vía
 * `onActiveMatchChange` para que scrollee a la página y resalte el match
 * (mismo overlay que el hit-test, `WordSelectionOverlay`).
 *
 * Tercera vía de agregado: cada resultado tiene su propio "Agregar como…",
 * y agrega **todas** las apariciones del valor (`addManualEntity` recorre el
 * documento entero), no solo la clickeada — mismo criterio que ADR-061 §8
 * errata punto 7.
 */

import { EntityType, type ManualEntityRequest, type TextMatch } from "@anonly/anonymization-core";
import { ChevronDownIcon, ChevronUpIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useViewerStore } from "../../store/viewer.store.js";
import { Button } from "../common/Button.js";
import { Select } from "../common/Select.js";
import { ENTITY_TYPE_OPTIONS } from "../entities/entityTypeLabels.js";

import { createSearchDebouncer } from "./searchDebounce.js";

export interface DocumentSearchBoxProps {
  /** Avisa al padre (`PdfViewer`) para que scrollee a la página y resalte el bbox — `null` cuando no hay match activo. */
  readonly onActiveMatchChange: (match: TextMatch | null) => void;
}

export function DocumentSearchBox({ onActiveMatchChange }: DocumentSearchBoxProps) {
  // ADR-084 §1: la consulta vive en `viewer.store` para que "Ver ocurrencias"
  // del panel de entidades pueda escribirla. El resto del estado de este
  // componente (matches, activeIndex, tipo del "Agregar como…") sigue local:
  // es trabajo interno suyo, que nadie más necesita.
  const query = useViewerStore((state) => state.searchQuery);
  const [matches, setMatches] = useState<ReadonlyArray<TextMatch>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);
  const debouncerRef = useRef(createSearchDebouncer());

  // `PdfViewer` declara `handleActiveMatchChange` en el cuerpo del componente,
  // o sea una referencia nueva por render. En el array de dependencias del
  // efecto de abajo re-dispararía la búsqueda en cada render, así que se lee
  // por ref.
  const onActiveMatchChangeRef = useRef(onActiveMatchChange);
  useEffect(() => {
    onActiveMatchChangeRef.current = onActiveMatchChange;
  });

  // La búsqueda se dispara desde la CONSULTA, no desde el `onChange` del
  // input. Es lo que hace que "Ver ocurrencias" (ADR-084 §2) funcione: escribe
  // `viewer.store.searchQuery` desde el panel de entidades, y el input nunca
  // emite un `change`. Con la búsqueda colgada del `onChange`, el texto
  // aparecía en la caja y no pasaba nada hasta que el usuario tipeaba una
  // letra.
  useEffect(() => {
    const debouncer = debouncerRef.current;
    if (query.trim().length === 0) {
      debouncer.cancel();
      setMatches([]);
      setActiveIndex(0);
      onActiveMatchChangeRef.current(null);
      return;
    }
    debouncer.schedule(() => {
      const found = actions.findText(query);
      setMatches(found);
      setActiveIndex(0);
      onActiveMatchChangeRef.current(found[0] ?? null);
    });
    return () => {
      debouncer.cancel();
    };
  }, [query]);

  function handleQueryChange(next: string): void {
    // `getState()` dentro del handler y NO un selector que devuelva el setter:
    // un selector que construye su valor (p. ej. envolver el método en una
    // arrow) devuelve una referencia nueva en cada llamada, y como zustand
    // compara el snapshot con `Object.is`, `useSyncExternalStore` interpreta
    // que el store cambió en cada render -> loop infinito -> React tira y la
    // UI queda en blanco. Mismo idioma que `ZoomControls`/`PdfViewer`.
    useViewerStore.getState().setSearchQuery(next);
    setAddingIndex(null);
  }

  function goTo(index: number): void {
    if (matches.length === 0) return;
    const wrapped = ((index % matches.length) + matches.length) % matches.length;
    setActiveIndex(wrapped);
    onActiveMatchChange(matches[wrapped] ?? null);
  }

  function handleAddConfirm(match: TextMatch): void {
    const request: ManualEntityRequest = { value: match.text, entityType };
    void actions.addManualEntity(request);
    setAddingIndex(null);
  }

  const showResults = query.trim().length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder="Buscar en el documento…"
          aria-label="Buscar en el documento"
          className="w-56 rounded-md border border-border bg-bg-primary py-1 pl-7 pr-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      {showResults ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-bg-primary shadow-md">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5 text-sm text-text-secondary">
            {matches.length === 0 ? (
              <span>Sin resultados</span>
            ) : (
              <span>
                {activeIndex + 1} de {matches.length}
              </span>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Resultado anterior"
                disabled={matches.length === 0}
                onClick={() => goTo(activeIndex - 1)}
                className="rounded p-0.5 text-text-secondary hover:bg-bg-tertiary disabled:opacity-40"
              >
                <ChevronUpIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Resultado siguiente"
                disabled={matches.length === 0}
                onClick={() => goTo(activeIndex + 1)}
                className="rounded p-0.5 text-text-secondary hover:bg-bg-tertiary disabled:opacity-40"
              >
                <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
          {matches.length > 0 ? (
            <ul className="max-h-56 overflow-y-auto">
              {matches.map((match, index) => (
                <li
                  key={`${match.pageIndex}-${match.bbox.x}-${match.bbox.y}`}
                  className="border-b border-border last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => goTo(index)}
                    className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-bg-tertiary ${
                      index === activeIndex ? "bg-bg-tertiary" : ""
                    }`}
                  >
                    <span className="truncate text-text-primary">{match.text}</span>
                    <span className="shrink-0 text-text-secondary">pág. {match.pageIndex + 1}</span>
                  </button>
                  {addingIndex === index ? (
                    <div className="flex items-center gap-1.5 px-2 pb-1.5">
                      <Select
                        value={entityType}
                        onChange={setEntityType}
                        options={ENTITY_TYPE_OPTIONS}
                        aria-label="Tipo de entidad"
                      />
                      <Button variant="primary" size="sm" onClick={() => handleAddConfirm(match)}>
                        Agregar
                      </Button>
                    </div>
                  ) : (
                    <div className="px-2 pb-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEntityType(EntityType.Person);
                          setAddingIndex(index);
                        }}
                        className="text-sm text-accent hover:underline"
                      >
                        Agregar como…
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
