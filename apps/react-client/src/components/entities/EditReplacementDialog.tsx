/**
 * `EditReplacementDialog` — "Editar reemplazo" (`ui/Components.md` §3.4e,
 * ADR-076/ADR-078; rediseñado por ADR-169 §10 con ADR-170).
 *
 * - La entidad arriba, con el aviso de espacio justo si lo tiene.
 * - El campo *"Texto de reemplazo"* con un **medidor de ancho fijo** —Entra
 *   bien / Queda justo / No entra— (`estimateReplacementFit`, sobre
 *   `estimateTokenWidth` de `@anonly/shared`).
 * - **Sugerencias más cortas**: los niveles de la escalera de ADR-057 que
 *   calcula el Core (`replacementPreviews.placeholderLadder`), sin repetir el
 *   valor vigente.
 * - *"Así queda en el documento"*: la frase de la aparición más apretada,
 *   original arriba y con el cambio abajo, con el reemplazo dibujado dentro
 *   del ancho del original (se achica si no entra). El texto que explica el
 *   medidor ocupa **dos renglones reservados** (UX-10).
 * - Pie: "Volver al calculado" a la izquierda (habilitado solo si el valor
 *   está escrito a mano; despacha el mismo modo, ADR-078 §3), "Cancelar" y
 *   "Guardar".
 *
 * Es **por entidad**: todas sus apariciones comparten el valor (ADR-012). No
 * se ofrece en `redact` (`GroupContextMenu` no muestra la entrada).
 */

import type { EntityGroup } from "@anonly/anonymization-core";
import { InfoIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { selectDegradedPages, useDegradedStore } from "../../store/degraded.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import { applyReplacementValue, restoreComputedValue } from "./applyEdits.js";
import { ContextPreview } from "./ContextPreview.js";
import { EntityLine } from "./EntityLine.js";
import {
  estimateReplacementFit,
  FIT_EXPLANATION,
  FIT_LABEL,
  replacementSuggestions,
  tightestMember,
  type ReplacementFit,
} from "./replacementFit.js";
import { TIGHT_SPACE_BADGE_CLASS, TightSpaceSymbol } from "./warningSymbols.js";

export interface EditReplacementDialogProps {
  readonly group: EntityGroup;
  readonly open: boolean;
  readonly onClose: () => void;
}

const FIT_CLASS: Readonly<Record<ReplacementFit, string>> = {
  fits: "bg-success/15 text-text-primary",
  tight: "bg-warning/15 text-warning-strong",
  overflows: "bg-error/10 text-error",
  unknown: "bg-bg-tertiary text-text-secondary",
};

export function EditReplacementDialog({ group, open, onClose }: EditReplacementDialogProps) {
  const [value, setValue] = useState(group.replacementValue);
  const degraded = useDegradedStore((state) => selectDegradedPages(state, group.id).length > 0);

  useEffect(() => {
    if (open) setValue(group.replacementValue);
  }, [open, group.replacementValue]);

  const fit = estimateReplacementFit(value, group.members);
  const suggestions = replacementSuggestions(
    group.replacementPreviews.placeholderLadder,
    group.replacementValue,
    value,
  );
  const tightest = tightestMember(group.members);

  function handleApply(): void {
    applyReplacementValue({ group, value });
    onClose();
  }

  function handleRestore(): void {
    // ADR-078 §3: re-aplicar el MISMO modo recalcula el valor y apaga el flag.
    restoreComputedValue(group);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Editar reemplazo"
      description="Escribí el texto exacto que va en lugar del dato."
      size="lg"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={!group.replacementValueUserSet} onClick={handleRestore}>
            Volver al calculado
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="min-w-[6rem]"
            disabled={value.trim().length === 0}
            onClick={handleApply}
          >
            Guardar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <EntityLine
          group={{
            type: group.type,
            canonicalValue: group.canonicalValue,
            indexInType: group.indexInType,
            memberCount: group.members.length,
          }}
          aside={
            degraded ? (
              <span className={`${TIGHT_SPACE_BADGE_CLASS} ml-auto px-1`} title="Espacio justo">
                <TightSpaceSymbol />
              </span>
            ) : null
          }
        />

        <div className="flex flex-col gap-2">
          <label htmlFor={`replacement-${group.id}`} className="font-semibold text-text-secondary">
            Texto de reemplazo
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`replacement-${group.id}`}
              type="text"
              value={value}
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-3 font-mono text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {/* Medidor de ancho fijo (UX-10). */}
            <span
              role="status"
              className={`flex h-8 w-[6.5rem] shrink-0 items-center justify-center rounded-md text-sm font-semibold ${FIT_CLASS[fit]}`}
            >
              {FIT_LABEL[fit]}
            </span>
          </div>
          <div className="flex min-h-8 flex-wrap items-center gap-1.5">
            <span className="text-text-secondary">Más cortos:</span>
            {suggestions.length === 0 ? (
              <span className="text-text-secondary">—</span>
            ) : (
              suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setValue(suggestion)}
                  className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 font-mono text-sm text-text-primary hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {suggestion}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-semibold text-text-secondary">Así queda en el documento</span>
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg-secondary px-3.5 py-3">
            {tightest !== null ? (
              <>
                <span className="text-text-secondary">Original</span>
                <ContextPreview
                  before={tightest.member.context?.before ?? ""}
                  original={tightest.member.value}
                  after={tightest.member.context?.after ?? ""}
                  content={{ kind: "original" }}
                />
                <span className="text-text-secondary">Con el cambio</span>
                <ContextPreview
                  before={tightest.member.context?.before ?? ""}
                  original={tightest.member.value}
                  after={tightest.member.context?.after ?? ""}
                  content={{ kind: "text", text: value }}
                />
              </>
            ) : (
              <span className="text-text-secondary">No hay una aparición para mostrar.</span>
            )}
            {/* Dos renglones reservados para la explicación (UX-10). */}
            <p className="line-clamp-2 h-10 leading-5 text-text-secondary">
              {FIT_EXPLANATION[fit]}
            </p>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-text-secondary">
          <InfoIcon className="h-4 w-4 shrink-0" aria-hidden />
          Si después cambiás el modo de reemplazo, este texto vuelve al calculado.
        </p>
      </div>
    </Dialog>
  );
}
