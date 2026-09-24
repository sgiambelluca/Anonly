/**
 * `AddEntityDialog` (`ui/Components.md` §3.4c, ADR-061 §3 ruta A; rehecho en
 * dos pasos por ADR-169 §7).
 *
 * 1. *¿Qué texto querés ocultar?* — mientras se escribe (con debounce), una
 *    caja de **alto fijo** muestra dónde aparece: `findText` → por cada
 *    resultado, la página y la frase alrededor con el texto resaltado. Sin
 *    coincidencias, la misma caja dice *"No aparece en el documento"* **antes**
 *    de confirmar — antes lo decía recién al confirmar. Vacío (< 2
 *    caracteres), un texto neutro. La caja nunca cambia de tamaño (UX-10).
 * 2. *¿Qué es?* — `EntityTypePicker` con los 13 tipos, en su caja gris.
 *
 * Debajo, en una caja azul distinta, la advertencia de alcance: la búsqueda es
 * exacta (sin mayúsculas ni tildes), así que si el dato aparece escrito de
 * otra forma hay que agregarlo también (ADR-061 §2). El botón dice cuántas
 * apariciones va a ocultar, con ancho mínimo fijo.
 *
 * El resultado de `addManualEntity` manda (ADR-061 §6 errata): `0` no cierra y
 * dice "no se encontró" (la lupa acepta un prefijo en la última palabra y el
 * agregado no, ADR-089 §2); `> 0` cierra y muestra el toast de ADR-169 §7;
 * `null` (sin documento) es no-op.
 */

import { EntityType, type TextMatch, type Word } from "@anonly/anonymization-core";
import {
  CheckIcon,
  InfoIcon,
  MousePointerClickIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { createSearchDebouncer } from "../viewer/searchDebounce.js";
import { matchContext } from "../viewer/searchResults.js";

import { addManualEntityWithFeedback } from "./addManualEntity.js";
import { EntityTypePicker } from "./EntityTypePicker.js";

export interface AddEntityDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Por debajo de esto no se busca: dos letras cualesquiera aparecen en todo documento. */
const MIN_QUERY_LENGTH = 2;

export function AddEntityDialog({ open, onClose }: AddEntityDialogProps) {
  const [entityType, setEntityType] = useState<EntityType>(EntityType.Person);
  const [value, setValue] = useState("");
  const [matches, setMatches] = useState<ReadonlyArray<TextMatch>>([]);
  const [searched, setSearched] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const debouncerRef = useRef(createSearchDebouncer());

  // Re-sincroniza el formulario cada vez que se abre.
  useEffect(() => {
    if (!open) return;
    setEntityType(EntityType.Person);
    setValue("");
    setMatches([]);
    setSearched("");
    setSubmitting(false);
    setNotFound(false);
  }, [open]);

  const trimmed = value.trim();

  // Búsqueda en vivo (`findText` es sincrónica y recorre el documento: con
  // debounce, igual que la lupa).
  useEffect(() => {
    const debouncer = debouncerRef.current;
    setNotFound(false);
    if (trimmed.length < MIN_QUERY_LENGTH) {
      debouncer.cancel();
      setMatches([]);
      setSearched("");
      return;
    }
    debouncer.schedule(() => {
      setMatches(actions.findText(trimmed));
      setSearched(trimmed);
    });
    return () => debouncer.cancel();
  }, [trimmed]);

  const hits = useMemo(() => {
    const wordsByPage = new Map<number, ReadonlyArray<Word>>();
    return matches.map((match) => {
      let words = wordsByPage.get(match.pageIndex);
      if (words === undefined) {
        words = actions.getPageWords(match.pageIndex);
        wordsByPage.set(match.pageIndex, words);
      }
      return { match, context: matchContext(words, match) };
    });
  }, [matches]);

  const pending = trimmed.length >= MIN_QUERY_LENGTH && searched !== trimmed;
  const count = pending ? 0 : matches.length;

  async function handleConfirm(): Promise<void> {
    if (count === 0) return;
    setSubmitting(true);
    setNotFound(false);
    const feedback = await addManualEntityWithFeedback({ value: trimmed, entityType });
    setSubmitting(false);
    // ADR-174 §4: "held" cierra este diálogo igual que "added" — lo que
    // sigue es `ManualOverlapDialog`, abierto por `manualOverlapController.ts`.
    if (feedback === "added" || feedback === "held") onClose();
    else if (feedback === "not-found") setNotFound(true);
  }

  const addLabel =
    count === 0 ? "Agregar" : count === 1 ? "Agregar 1 aparición" : `Agregar ${count} apariciones`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Agregar entidad"
      description="Marcá un dato que el análisis no encontró. Se oculta en todas sus apariciones."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex flex-1 items-center gap-2 text-sm text-text-secondary">
            <MousePointerClickIcon className="h-4 w-4 shrink-0" aria-hidden />
            También podés seleccionarlo en el PDF original.
          </span>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          {/* Ancho mínimo fijo: el texto cambia con el conteo (UX-10). */}
          <Button
            variant="primary"
            className="min-w-[12rem]"
            disabled={count === 0 || submitting}
            loading={submitting}
            onClick={() => void handleConfirm()}
          >
            {addLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2.5">
          <label
            htmlFor="add-entity-value"
            className="flex items-center gap-2 text-sm font-semibold text-text-primary"
          >
            <StepNumber>1</StepNumber>
            ¿Qué texto querés ocultar?
          </label>
          <div className="flex h-11 items-center gap-2.5 rounded-lg border border-border bg-bg-primary px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
            <SearchIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
            <input
              id="add-entity-value"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={submitting}
              autoComplete="off"
              placeholder="Escribilo como aparece en el documento"
              className="min-w-0 flex-1 border-0 bg-transparent text-base text-text-primary outline-none placeholder:text-text-secondary disabled:opacity-50"
            />
          </div>
          {/* Caja de alto fijo (UX-10): los tres estados miden lo mismo. */}
          <div
            aria-live="polite"
            className="flex h-40 flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary"
          >
            {trimmed.length < MIN_QUERY_LENGTH ? (
              <p className="p-3.5 text-sm text-text-secondary">
                Mientras escribís, acá aparecen los lugares del documento donde está ese texto.
              </p>
            ) : pending ? (
              <p className="p-3.5 text-sm text-text-secondary">Buscando…</p>
            ) : notFound || matches.length === 0 ? (
              <div className="flex gap-2.5 p-3.5 text-sm">
                <TriangleAlertIcon
                  className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong"
                  aria-hidden
                />
                <span>
                  <b className="font-semibold text-text-primary">No aparece en el documento.</b>{" "}
                  <span className="text-text-secondary">
                    Revisá cómo está escrito: tiene que coincidir letra por letra (no importan
                    mayúsculas ni tildes).
                  </span>
                </span>
              </div>
            ) : (
              <>
                <p className="flex items-center gap-2 border-b border-border px-3.5 py-2.5 text-sm font-semibold text-text-primary">
                  <CheckIcon className="h-4 w-4 text-success" aria-hidden />
                  {matches.length === 1
                    ? "Aparece 1 vez en el documento"
                    : `Aparece ${matches.length} veces en el documento`}
                </p>
                <ul className="min-h-0 flex-1 overflow-y-auto py-1">
                  {hits.map(({ match, context }) => (
                    <li
                      key={`${match.pageIndex}-${match.wordSpan.startIndex}`}
                      className="flex gap-3 px-3.5 py-2 text-sm leading-snug"
                    >
                      <span className="w-12 shrink-0 font-semibold tabular-nums text-text-secondary">
                        Pág. {match.pageIndex + 1}
                      </span>
                      <span className="text-text-secondary">
                        …{context.before}
                        <mark className="rounded-sm bg-warning/30 px-0.5 text-text-primary">
                          {context.match}
                        </mark>
                        {context.after}…
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span
            id="add-entity-type"
            className="flex items-center gap-2 text-sm font-semibold text-text-primary"
          >
            <StepNumber>2</StepNumber>
            ¿Qué es?
          </span>
          <EntityTypePicker
            value={entityType}
            onChange={setEntityType}
            columns={3}
            aria-labelledby="add-entity-type"
          />
        </div>

        <div className="flex gap-2.5 rounded-lg border border-accent/35 bg-accent/10 px-3 py-2.5 text-sm leading-snug text-text-primary">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>
            Si el mismo dato aparece escrito de otra forma (por ejemplo «J. Pérez» y «José Pérez»),
            agregalo también: cada forma se busca por separado.
          </span>
        </div>
      </div>
    </Dialog>
  );
}

function StepNumber({ children }: { readonly children: string }) {
  return (
    <b className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-accent/10 text-sm font-bold text-accent">
      {children}
    </b>
  );
}
