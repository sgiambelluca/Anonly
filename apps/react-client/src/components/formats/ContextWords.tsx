/**
 * `ContextWords` — «Solo si antes dice…» (`Components.md` §13b.5, ADR-228 §5):
 * las palabras de contexto de un formato (`contextBefore`).
 *
 * Plegada en una sola fila si el formato no tiene ninguna; al apretarla se
 * abre. Abierta: las palabras (etiquetas rectas con subrayado punteado, no
 * pastillas), un campo, «Agregar» y el contador. Junto al campo va el aviso de
 * que lo escrito queda guardado (`UX_Guidelines.md` §11b.9).
 */

import { FORMAT_MAX_CONTEXT, FORMAT_MAX_TEXT } from "@anonly/anonymization-core";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../common/Button.js";

import { addContextWord, removeContextWord } from "./formatBuilderModel.js";

export const CONTEXT_COPY = {
  fold: "Detectarlo solo si antes dice una palabra (opcional)",
  title: "Solo si antes dice…",
  notice: "La palabra no se tapa. Queda guardada en este equipo: no escribas datos de un caso.",
  add: "Agregar",
  placeholder: "Una palabra, como «legajo»",
} as const;

export interface ContextWordsProps {
  readonly words: ReadonlyArray<string>;
  readonly onChange: (words: ReadonlyArray<string>) => void;
}

export function ContextWords({ words, onChange }: ContextWordsProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const open = expanded || words.length > 0;
  const full = words.length >= FORMAT_MAX_CONTEXT;

  function add(): void {
    const next = addContextWord(words, draft, FORMAT_MAX_CONTEXT);
    if (next !== words) onChange(next);
    setDraft("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm font-medium text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRightIcon className="h-4 w-4" aria-hidden />
        {CONTEXT_COPY.fold}
      </button>
    );
  }

  return (
    <section
      aria-label={CONTEXT_COPY.title}
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
          <ChevronDownIcon className="h-4 w-4" aria-hidden />
          {CONTEXT_COPY.title}
        </span>
        <span className="text-xs text-text-secondary">
          {words.length} de {FORMAT_MAX_CONTEXT}
        </span>
      </div>
      {words.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {words.map((word, index) => (
            <li
              key={`${word}-${index}`}
              className="flex items-center gap-1 text-sm text-text-primary"
            >
              <span className="border-b border-dotted border-text-secondary">{word}</span>
              <button
                type="button"
                aria-label={`Sacar «${word}»`}
                onClick={() => onChange(removeContextWord(words, index))}
                className="rounded-sm p-0.5 text-text-secondary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <XIcon className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          maxLength={FORMAT_MAX_TEXT}
          disabled={full}
          placeholder={CONTEXT_COPY.placeholder}
          aria-label="Palabra de contexto"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        />
        <Button variant="secondary" size="sm" disabled={full || draft.trim() === ""} onClick={add}>
          {CONTEXT_COPY.add}
        </Button>
      </div>
      <p className="text-xs text-text-secondary">{CONTEXT_COPY.notice}</p>
    </section>
  );
}
