/**
 * `DocumentSearchBox` — la lupa del visor (`ui/Components.md` §5.4c,
 * ADR-061 §8; rediseñada por ADR-169 §7).
 *
 * **Siempre visible y habilitada, en Original y en Anonimizado**: vive a la
 * izquierda de la barra del visor (`App.tsx`), que no cambia al conmutar.
 * Antes aparecía y desaparecía con la vista.
 *
 * - Campo *"Buscar un texto en el documento…"*, un contador en **ranura de
 *   ancho fijo** y un botón **"+ Agregar"** aparte, habilitado cuando hay
 *   resultados. Nada de eso cambia el ancho del campo. Enter / Shift+Enter
 *   recorren los resultados.
 * - **Lista de resultados** flotante: por cada uno, la página, la frase
 *   alrededor (`getPageWords` + `wordSpan`) con la coincidencia resaltada y su
 *   estado — **oculto como Persona N.º 02** o **Sin ocultar** con "Agregar
 *   como…" en un globo flotante (`searchResults.ts`). El encabezado resume
 *   "N ocultos · M sin ocultar", los dos siempre presentes.
 *
 * La consulta vive en `viewer.store.searchQuery` (ADR-084 §1): "Ver
 * apariciones" del menú ⋯ la escribe desde el otro extremo del árbol y la lupa
 * reacciona sola. `findText` es sincrónica y recorre todo el documento, así
 * que el debounce es de este componente (`searchDebounce.ts`).
 *
 * **Agregar agrega todas las apariciones del valor**, no solo el resultado
 * clickeado (`addManualEntity` recorre el documento entero, ADR-061 §8 errata
 * punto 7), y es literal: la lupa acepta que el último sub-token sea un
 * prefijo y el agregado no (ADR-089 §2). Por eso "Agregar como…" usa las
 * palabras enteras del documento que cubre el resultado, no lo tipeado.
 */

import { EntityType, type TextMatch, type Word } from "@anonly/anonymization-core";
import { CheckIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { useEntitiesStore } from "../../store/entities.store.js";
import { useViewerStore } from "../../store/viewer.store.js";
import { Button } from "../common/Button.js";
import { addManualEntityWithFeedback } from "../entities/addManualEntity.js";
import { ENTITY_TYPE_COLOR } from "../entities/entityTypeColors.js";
import { describeEntityNumber } from "../entities/entityTypeLabels.js";
import { EntityTypePicker } from "../entities/EntityTypePicker.js";

import { createSearchDebouncer } from "./searchDebounce.js";
import {
  matchContext,
  resolveMatchStatus,
  summarizeMatchStatuses,
  type MatchContext,
  type MatchStatus,
} from "./searchResults.js";

export interface DocumentSearchBoxProps {
  /** Avisa al padre para que el visor scrollee a la página y resalte el bbox — `null` sin resultado activo. */
  readonly onActiveMatchChange: (match: TextMatch | null) => void;
}

interface ResultRow {
  readonly match: TextMatch;
  readonly context: MatchContext;
  readonly status: MatchStatus;
}

/** A quién se agrega: la consulta entera ("+ Agregar") o un resultado. */
type AddTarget = { readonly kind: "query" } | { readonly kind: "result"; readonly index: number };

export function DocumentSearchBox({ onActiveMatchChange }: DocumentSearchBoxProps) {
  const query = useViewerStore((state) => state.searchQuery);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const [matches, setMatches] = useState<ReadonlyArray<TextMatch>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  const debouncerRef = useRef(createSearchDebouncer());
  const containerRef = useRef<HTMLDivElement>(null);

  const onActiveMatchChangeRef = useRef(onActiveMatchChange);
  useEffect(() => {
    onActiveMatchChangeRef.current = onActiveMatchChange;
  });

  // La búsqueda se dispara desde la CONSULTA, no desde el `onChange` del
  // input: es lo que hace que "Ver apariciones" (ADR-084 §2) funcione.
  useEffect(() => {
    const debouncer = debouncerRef.current;
    setAddTarget(null);
    if (query.trim().length === 0) {
      debouncer.cancel();
      setMatches([]);
      setActiveIndex(0);
      setPanelOpen(false);
      onActiveMatchChangeRef.current(null);
      return;
    }
    setPanelOpen(true);
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

  // Cierra la lista (sin borrar la búsqueda) con click afuera o Escape. Los
  // globos de "Agregar como…" viven adentro del contenedor.
  useEffect(() => {
    if (!panelOpen) return;
    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setPanelOpen(false);
        setAddTarget(null);
      }
    }
    function handleKeydown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setPanelOpen(false);
      setAddTarget(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [panelOpen]);

  // Contexto y estado de cada resultado. Las palabras se piden una vez por
  // página, no por resultado.
  const rows: ReadonlyArray<ResultRow> = useMemo(() => {
    const wordsByPage = new Map<number, ReadonlyArray<Word>>();
    return matches.map((match) => {
      let words = wordsByPage.get(match.pageIndex);
      if (words === undefined) {
        words = actions.getPageWords(match.pageIndex);
        wordsByPage.set(match.pageIndex, words);
      }
      return {
        match,
        context: matchContext(words, match),
        status: resolveMatchStatus(match, groupsByType),
      };
    });
  }, [matches, groupsByType]);

  const summary = summarizeMatchStatuses(rows.map((row) => row.status));
  const hasQuery = query.trim().length > 0;

  function handleQueryChange(next: string): void {
    // `getState()` dentro del handler y NO un selector que devuelva el setter
    // envuelto: una referencia nueva por render deja la UI en un loop.
    useViewerStore.getState().setSearchQuery(next);
  }

  function goTo(index: number): void {
    if (matches.length === 0) return;
    const wrapped = ((index % matches.length) + matches.length) % matches.length;
    setActiveIndex(wrapped);
    setPanelOpen(true);
    onActiveMatchChange(matches[wrapped] ?? null);
  }

  const counter =
    !hasQuery || matches.length === 0
      ? hasQuery
        ? "0 resultados"
        : ""
      : `${activeIndex + 1} de ${matches.length}`;

  return (
    <div ref={containerRef} className="relative w-full max-w-[27.5rem]">
      <div className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-bg-primary pl-2.5 pr-1 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
        <SearchIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => {
            if (hasQuery) setPanelOpen(true);
          }}
          onKeyDown={(event) => {
            // Enter / Shift+Enter recorren los resultados.
            if (event.key !== "Enter") return;
            event.preventDefault();
            goTo(event.shiftKey ? activeIndex - 1 : activeIndex + 1);
          }}
          placeholder="Buscar un texto en el documento…"
          aria-label="Buscar en el documento"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-secondary"
        />
        {/* Ranura de ancho fijo (UX-10): el contador no empuja el campo. */}
        <span
          aria-live="polite"
          className="w-[4.75rem] shrink-0 text-right text-sm tabular-nums text-text-secondary"
        >
          {counter}
        </span>
        <button
          type="button"
          disabled={matches.length === 0}
          onClick={() => {
            setPanelOpen(true);
            setAddTarget({ kind: "query" });
          }}
          title="Agregar lo que buscaste como entidad"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:bg-bg-tertiary disabled:text-text-secondary disabled:opacity-100"
        >
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Agregar
        </button>
      </div>

      {addTarget?.kind === "query" ? (
        <AddPopover
          value={query.trim()}
          count={matches.length}
          className="left-0 top-full mt-2"
          onClose={() => setAddTarget(null)}
        />
      ) : null}

      {panelOpen && hasQuery && addTarget?.kind !== "query" ? (
        <div
          role="region"
          aria-label="Resultados de la búsqueda"
          className="absolute left-0 top-full z-30 mt-2 flex w-[29rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-bg-primary shadow-md"
        >
          <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
            <b className="text-sm font-semibold text-text-primary">
              {matches.length === 1 ? "1 resultado" : `${matches.length} resultados`}
            </b>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-sm font-medium text-text-primary">
              <CheckIcon className="h-3.5 w-3.5" aria-hidden />
              {summary.hidden} {summary.hidden === 1 ? "oculto" : "ocultos"}
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-sm font-medium ${
                summary.unhidden > 0
                  ? "bg-warning/15 text-warning-strong"
                  : "bg-bg-tertiary text-text-secondary"
              }`}
            >
              {summary.unhidden} sin ocultar
            </span>
            <button
              type="button"
              aria-label="Cerrar resultados"
              onClick={() => setPanelOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary"
            >
              <XIcon className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-text-secondary">
              No aparece en el documento. La búsqueda no distingue mayúsculas ni tildes, pero tiene
              que coincidir letra por letra.
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-b-xl bg-bg-tertiary p-1.5">
              {rows.map((row, index) => (
                <ResultItem
                  key={`${row.match.pageIndex}-${row.match.wordSpan.startIndex}`}
                  row={row}
                  active={index === activeIndex}
                  onGo={() => goTo(index)}
                  onStartAdd={() => {
                    goTo(index);
                    setAddTarget({ kind: "result", index });
                  }}
                />
              ))}
            </ul>
          )}
          {/*
            El globo "Agregar como…" de un resultado flota debajo de la lista
            y no adentro de su fila: la lista scrollea, y adentro quedaba
            recortado (UX-10: flotante, no expande nada).
          */}
          {addTarget?.kind === "result" && rows[addTarget.index] !== undefined ? (
            <AddPopover
              key={addTarget.index}
              value={rows[addTarget.index]?.context.match ?? ""}
              count={null}
              className="right-2 top-full mt-2"
              onClose={() => setAddTarget(null)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultItem({
  row,
  active,
  onGo,
  onStartAdd,
}: {
  readonly row: ResultRow;
  readonly active: boolean;
  readonly onGo: () => void;
  readonly onStartAdd: () => void;
}) {
  const { match, context, status } = row;
  const hidden = status.kind === "hidden";
  return (
    <li
      className={`relative flex flex-col gap-2 rounded-lg border bg-bg-primary px-3 py-2.5 ${
        active ? "border-accent" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={onGo}
        aria-current={active}
        className="flex flex-col gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex w-full items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-text-secondary">
            Pág. {match.pageIndex + 1}
          </span>
          <span className="flex-1" />
          {status.kind === "hidden" ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2 py-0.5 text-sm font-medium text-text-primary">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: ENTITY_TYPE_COLOR[status.type] }}
              />
              Oculto como {describeEntityNumber(status.type, status.indexInType)}
            </span>
          ) : (
            <span className="rounded-md bg-warning/15 px-2 py-0.5 text-sm font-medium text-warning-strong">
              Sin ocultar
            </span>
          )}
        </span>
        <span className="text-sm leading-snug text-text-secondary">
          …{context.before}
          <mark className="rounded-sm bg-warning/30 px-0.5 text-text-primary">{context.match}</mark>
          {context.after}…
        </span>
      </button>
      {hidden ? null : (
        <span className="flex justify-end">
          <button
            type="button"
            onClick={onStartAdd}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90"
          >
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Agregar como…
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * El globo "Agregar «X» como…": `EntityTypePicker` y la aclaración de que se
 * ocultan todas las apariciones. Flotante (UX-10). El "no se encontró" ocupa
 * la misma ranura que la aclaración.
 */
function AddPopover({
  value,
  count,
  className,
  onClose,
}: {
  readonly value: string;
  /** Resultados de la lupa, si se sabe; `null` lo calcula (el valor exacto puede diferir). */
  readonly count: number | null;
  readonly className: string;
  readonly onClose: () => void;
}) {
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [estimated] = useState(() => count ?? actions.findText(value).length);

  async function handleAdd(): Promise<void> {
    setSubmitting(true);
    const feedback = await addManualEntityWithFeedback({ value, entityType });
    setSubmitting(false);
    if (feedback === "not-found") {
      setNotFound(true);
      return;
    }
    // ADR-174 §4 / ADR-175 §3: "held" cierra este globo igual que "added" —
    // lo que sigue es `ManualOverlapDialog`. "error" también cierra: el
    // toast de error ya lo dice.
    if (feedback === "added" || feedback === "held" || feedback === "error") onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Agregar la búsqueda como entidad"
      className={`absolute z-40 flex w-[22.5rem] max-w-[calc(100vw-2rem)] flex-col gap-2.5 rounded-xl border border-border bg-bg-primary p-3.5 text-sm text-text-primary shadow-md ${className}`}
    >
      <p className="truncate">
        Agregar <b className="font-semibold">«{value}»</b> como…
      </p>
      <EntityTypePicker value={entityType} onChange={setEntityType} aria-label="Tipo de entidad" />
      <p
        aria-live="polite"
        className={`h-5 truncate ${notFound ? "text-error" : "text-text-secondary"}`}
      >
        {notFound
          ? "No se encontró ese texto exacto en el documento."
          : estimated === 1
            ? "Se va a ocultar su única aparición en el documento."
            : `Se van a ocultar sus ${estimated} apariciones en el documento.`}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button variant="primary" loading={submitting} onClick={() => void handleAdd()}>
          Agregar
        </Button>
      </div>
    </div>
  );
}
