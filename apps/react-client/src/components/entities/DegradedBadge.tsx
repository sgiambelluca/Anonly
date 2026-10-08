/**
 * `DegradedBadge` (`ui/Components.md` §3.3 y §3.3b, ADR-058 §7 + ADR-062,
 * diálogo por ADR-215 §1).
 *
 * Avisa que el texto de reemplazo de este grupo **no entró** en alguna de sus
 * apariciones y hubo que achicarlo tanto que quedó difícil de leer.
 *
 * Es la mitad "después" del aviso de longitud: `EditReplacementDialog` avisa
 * **antes** de guardar ("puede no entrar"), y esto avisa **después**, cuando
 * el render ya midió de verdad. Sin esto, el texto se achica en silencio y el
 * usuario se entera mirando el PDF exportado página por página — que es
 * justamente lo que ADR-062 llama "una palanca que existía y era invisible".
 *
 * **El diálogo muestra el resultado antes de aplicar** (ADR-215 §1): la frase
 * de la aparición más apretada con "Hoy" y con lo que quedaría con la opción
 * elegida, y recién el botón primario aplica. Las tres salidas son las de
 * siempre: un texto más corto (`EditReplacementDialog`), un bloque negro
 * (`redact`, que nunca tiene problema de espacio) o dejar el dato a la vista
 * (deshabilitar, con el mismo toast que la casilla de la fila). La lógica —qué
 * opciones, qué rótulo, qué aclaración, qué botón— vive en
 * `tightSpaceDialog.ts`, con tests.
 *
 * **El texto no usa jerga.** El usuario no sabe qué es un token, ni un
 * placeholder, ni un bbox, ni le importa el cociente contra
 * `DEGRADED_FONT_RATIO`.
 *
 * **Diseño estable** (UX-10): elegir una opción cambia el segundo renglón, la
 * aclaración y el texto del botón; ningún bloque cambia de tamaño ni de lugar.
 */

import { ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { EyeIcon, PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { selectDegradedPages, useDegradedStore } from "../../store/degraded.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Tooltip } from "../common/Tooltip.js";

import { applyGroupMode, applyLeaveVisible } from "./applyEdits.js";
import { ContextPreview } from "./ContextPreview.js";
import { pagesLabel } from "./degradedMessage.js";
import { EntityLine } from "./EntityLine.js";
import { WARNING_TOOLTIP } from "./needsReviewBadgeCopy.js";
import { todayPhrase } from "./phraseContent.js";
import { replacementSuggestions, tightestMember } from "./replacementFit.js";
import {
  resolveTightChoice,
  tightApplyLabel,
  tightClarification,
  tightOptions,
  tightResultContent,
  tightResultLabel,
  type TightChoice,
} from "./tightSpaceDialog.js";
import { TIGHT_SPACE_BADGE_CLASS, TightSpaceSymbol, WarningTooltipText } from "./warningSymbols.js";

export interface DegradedBadgeProps {
  readonly group: EntityGroup;
  /** Abre el editor de texto de reemplazo — la primera de las tres salidas. */
  readonly onEditReplacement: () => void;
}

/** El ícono de cada opción, en su caja de 32 px. */
const OPTION_ICON: Readonly<Record<TightChoice, ReactNode>> = {
  shorter: <PencilIcon className="h-4 w-4" aria-hidden />,
  redact: <span className="h-2 w-[18px] rounded-sm bg-text-primary" />,
  visible: <EyeIcon className="h-4 w-4" aria-hidden />,
};

export function DegradedBadge({ group, onEditReplacement }: DegradedBadgeProps) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<TightChoice | null>(null);

  // El selector devuelve un STRING, no el array: `selectDegradedPages`
  // construye un array nuevo por llamada y zustand compara el snapshot con
  // `Object.is` -> cambio en cada render -> loop infinito -> UI en blanco. Es
  // el mismo pozo en el que ya caímos con `setSearchQuery`. Un primitivo es
  // estable y se re-expande acá, del lado del componente.
  const pagesKey = useDegradedStore((state) => selectDegradedPages(state, group.id).join(","));

  if (pagesKey === "") return null;

  const where = pagesLabel(pagesKey.split(",").map(Number));
  const options = tightOptions(group.replacementMode);
  const choice = resolveTightChoice(chosen, options);
  const suggestions = replacementSuggestions(
    group.replacementPreviews.placeholderLadder,
    group.replacementValue,
    "",
  );
  const tightest = tightestMember(group.members);
  const clarification = tightClarification(choice);

  function handleApply(): void {
    setOpen(false);
    if (choice === "shorter") onEditReplacement();
    else if (choice === "redact") applyGroupMode(group, ReplacementMode.Redact);
    else applyLeaveVisible(group);
  }

  return (
    <>
      <Tooltip content={<WarningTooltipText {...WARNING_TOOLTIP.tightSpace} />}>
        <button
          type="button"
          aria-label={`El reemplazo de ${group.canonicalValue} puede no leerse`}
          onClick={() => {
            setChosen(null);
            setOpen(true);
          }}
          className={TIGHT_SPACE_BADGE_CLASS}
        >
          <TightSpaceSymbol />
        </button>
      </Tooltip>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="El reemplazo puede no leerse"
        description="No entraba en el lugar del original y hubo que achicarlo."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button variant="primary" className="min-w-[8rem]" onClick={handleApply}>
              {tightApplyLabel(choice)}
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
              <span className={`${TIGHT_SPACE_BADGE_CLASS} ml-auto px-1`} title="Espacio justo">
                <TightSpaceSymbol />
              </span>
            }
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="shrink-0 font-semibold text-text-secondary">
                Así queda en el documento
              </span>
              {/* Una línea, truncada como red de seguridad: no puede desbordar el diálogo. */}
              <span className="min-w-0 truncate text-text-secondary" title={where}>
                {where}
              </span>
            </div>
            {/*
              Alto mínimo = el de la caja con una aparición (dos renglones de frase,
              sus rótulos y la aclaración): sin aparición conserva su alto (UX-10).
            */}
            <div className="flex min-h-[10.375rem] flex-col gap-1.5 rounded-lg border border-border bg-bg-secondary px-3.5 py-3">
              {tightest !== null ? (
                <>
                  <span className="text-text-secondary">Hoy</span>
                  <ContextPreview
                    before={tightest.member.context?.before ?? ""}
                    original={tightest.member.value}
                    after={tightest.member.context?.after ?? ""}
                    content={todayPhrase(group)}
                  />
                  <span className="text-text-secondary">
                    {tightResultLabel(choice, suggestions.length > 0)}
                  </span>
                  <ContextPreview
                    before={tightest.member.context?.before ?? ""}
                    original={tightest.member.value}
                    after={tightest.member.context?.after ?? ""}
                    content={tightResultContent(choice, suggestions)}
                  />
                </>
              ) : (
                <span className="flex flex-1 items-center text-text-secondary">
                  No hay una aparición para mostrar.
                </span>
              )}
              {/* Una ranura de un renglón para la aclaración (UX-10). */}
              <p
                className={`h-5 truncate leading-5 ${
                  clarification.warning ? "text-warning-strong" : "text-text-secondary"
                }`}
              >
                {clarification.text}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span id={`tight-question-${group.id}`} className="font-semibold text-text-secondary">
              ¿Qué querés hacer?
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`tight-question-${group.id}`}
              className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg-secondary p-1.5"
            >
              {options.map((option) => {
                const checked = option.id === choice;
                return (
                  <label
                    key={option.id}
                    className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-2.5 py-2 text-text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                      checked
                        ? "border-accent bg-bg-primary ring-2 ring-accent/15"
                        : "border-transparent hover:border-border hover:bg-bg-primary"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`tight-choice-${group.id}`}
                      value={option.id}
                      checked={checked}
                      onChange={() => setChosen(option.id)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-primary text-text-primary"
                    >
                      {OPTION_ICON[option.id]}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={checked ? "font-semibold" : ""}>{option.title}</span>
                      <span className="text-text-secondary">{option.description}</span>
                    </span>
                    <span
                      aria-hidden
                      className={`h-3.5 w-3.5 shrink-0 rounded-full ${
                        checked
                          ? "border-4 border-accent"
                          : "border-[1.5px] border-text-secondary/60"
                      }`}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
