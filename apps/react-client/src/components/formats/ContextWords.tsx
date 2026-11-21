/**
 * `ContextWords` — «Solo si antes dice…» (`Components.md` §13b.5, ADR-228 §5):
 * las palabras de contexto de un formato (`contextBefore`).
 *
 * Arranca plegada en una sola fila si el formato no tiene ninguna, y abierta si
 * tiene. **El encabezado la pliega y la despliega siempre** (precisión del
 * 2026-11-21): plegada con palabras, la fila las nombra. Abierta: las palabras
 * como etiquetas con borde, en la misma fila que el campo y «Agregar», y debajo
 * el aviso de que lo escrito queda guardado (`UX_Guidelines.md` §11b.9). El
 * subrayado punteado quedó para el texto de prueba (`FormatTestPanel`).
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

/** La fila plegada con palabras: «Solo si antes dice «legajo» o «leg.»». Pura. */
export function foldedContextLine(words: ReadonlyArray<string>): string {
  if (words.length === 0) return CONTEXT_COPY.fold;
  const quoted = words.map((word) => `«${word}»`);
  const last = quoted[quoted.length - 1] ?? "";
  const list = quoted.length === 1 ? last : `${quoted.slice(0, -1).join(", ")} o ${last}`;
  return `Solo si antes dice ${list}`;
}

export interface ContextWordsProps {
  readonly words: ReadonlyArray<string>;
  readonly onChange: (words: ReadonlyArray<string>) => void;
}

export function ContextWords({ words, onChange }: ContextWordsProps) {
  const [expanded, setExpanded] = useState(() => words.length > 0);
  const [draft, setDraft] = useState("");
  const full = words.length >= FORMAT_MAX_CONTEXT;
  const counter = `${words.length} de ${FORMAT_MAX_CONTEXT}`;

  function add(): void {
    const next = addContextWord(words, draft, FORMAT_MAX_CONTEXT);
    if (next !== words) onChange(next);
    setDraft("");
  }

  if (!expanded) {
    const line = foldedContextLine(words);
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        title={line}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          words.length === 0
            ? "border-dashed border-border font-medium text-accent hover:bg-accent/10"
            : "border-border font-semibold text-text-primary hover:bg-bg-secondary"
        }`}
      >
        <ChevronRightIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{line}</span>
        {words.length > 0 ? (
          <span className="shrink-0 text-xs font-normal text-text-secondary">{counter}</span>
        ) : null}
      </button>
    );
  }

  return (
    <section
      aria-label={CONTEXT_COPY.title}
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded
          className="-mx-1 flex items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronDownIcon className="h-4 w-4" aria-hidden />
          {CONTEXT_COPY.title}
        </button>
        <span className="text-xs text-text-secondary">{counter}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {words.length > 0 ? (
          <ul className="contents">
            {words.map((word, index) => (
              <li
                key={`${word}-${index}`}
                className="flex h-8 items-center gap-1 rounded-md border border-border-strong/40 bg-bg-tertiary pl-2.5 pr-1 text-sm font-medium text-text-primary"
              >
                <span className="max-w-[12rem] truncate" title={word}>
                  {word}
                </span>
                <button
                  type="button"
                  aria-label={`Sacar «${word}»`}
                  onClick={() => onChange(removeContextWord(words, index))}
                  className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-bg-primary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <XIcon className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
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
          className="h-8 min-w-[12rem] flex-1 rounded-lg border border-border bg-bg-primary px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        />
        <Button variant="secondary" size="sm" disabled={full || draft.trim() === ""} onClick={add}>
          {CONTEXT_COPY.add}
        </Button>
      </div>
      <p className="text-xs text-text-secondary">{CONTEXT_COPY.notice}</p>
    </section>
  );
}
