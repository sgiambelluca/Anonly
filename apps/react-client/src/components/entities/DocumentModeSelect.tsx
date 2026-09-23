/**
 * `DocumentModeSelect` (`ui/Components.md` §3.9, ADR-087 §3, nivel documento).
 *
 * Franja propia **arriba del árbol y fuera de él**. Esa ubicación es parte del
 * tratamiento visual (§3.1): es el control de mayor alcance, y no estando
 * entre las filas no puede confundirse con una.
 *
 * **Barre todo** al aplicarse: reglas de tipo y de grupo (§3.1b regla 3).
 * "Todo el documento" significa todo, y por eso lleva la fricción más alta de
 * los tres niveles — confirmación cuando hay algo que romper, y toast con
 * "Deshacer" siempre.
 *
 * **La franja avisa sin crecer** (ADR-169 §5, reemplaza la forma de §3.4d):
 * tiene **siempre dos líneas**. Sin ajustes propios, la segunda dice *"Se
 * aplica a todas las entidades."* en gris; con ajustes, la caja entera pasa a
 * ámbar y la línea dice cuántas entidades tienen modo propio. Antes era un
 * borde izquierdo más una línea que aparecía y empujaba el árbol hacia abajo
 * (UX-10). La lógica de cuándo se enciende, la confirmación y el toast no
 * cambian. Nunca se señala solo con color: ícono + texto además del acento, y
 * el texto en `warning-strong` (contraste AA), no en `warning`.
 */

import type { ReplacementMode } from "@anonly/anonymization-core";
import { ChevronDownIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { useEntitiesStore } from "../../store/entities.store.js";
import { useRulesStore } from "../../store/rules.store.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";

import { applyModeAtLevel } from "./applyMode.js";
import {
  countEntitiesWithOwnMode,
  countOverrides,
  describeDocumentBandNote,
  describeOverrides,
  needsConfirmation,
  planApplyDocumentMode,
  resolveDocumentMode,
} from "./modeLevels.js";
import { ModeSelectMenu } from "./ModeSelectMenu.js";
import { REPLACEMENT_MODE_LABEL } from "./replacementModeOptions.js";

/** Ejemplo genérico: en este nivel no hay un grupo concreto al que referirse. */
const SAMPLE = "Cada dato";

export function DocumentModeSelect() {
  const rules = useRulesStore((state) => state.rules);
  const groupsByType = useEntitiesStore((state) => state.groupsByType);
  const [pendingMode, setPendingMode] = useState<ReplacementMode | null>(null);

  const current = resolveDocumentMode(rules);
  const counts = countOverrides(rules);
  const atRisk = needsConfirmation(counts);
  const withOwnMode = countEntitiesWithOwnMode(rules, Array.from(groupsByType.values()).flat());
  // Con reglas que hoy no tocan a ninguna fila (un tipo que se quedó sin
  // entidades), la caja igual se enciende: el barrido las borra.
  const note =
    atRisk && withOwnMode === 0
      ? "Hay ajustes propios: cambiar este modo los pisa."
      : describeDocumentBandNote(withOwnMode);

  function apply(mode: ReplacementMode): void {
    applyModeAtLevel({
      plan: planApplyDocumentMode(rules),
      scope: "global",
      mode,
      toastText: `Todo el documento → ${REPLACEMENT_MODE_LABEL[mode]}`,
    });
  }

  function handleSelect(mode: ReplacementMode): void {
    if (atRisk) {
      setPendingMode(mode);
      return;
    }
    apply(mode);
  }

  return (
    <>
      <div
        className={`flex flex-col gap-1.5 rounded-lg border py-2 pl-3 pr-1.5 transition-colors ${
          atRisk ? "border-warning-strong bg-warning/15" : "border-border bg-bg-secondary"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-text-primary">Todo el documento</span>
          <ModeSelectMenu
            current={current}
            example={{ sample: SAMPLE }}
            onSelect={handleSelect}
            subject="todo el documento"
            align="right"
          >
            {({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label={`Modo de reemplazo de todo el documento: ${REPLACEMENT_MODE_LABEL[current]}`}
                className="flex h-8 w-[10.5rem] items-center justify-between gap-1.5 rounded-md border border-border bg-bg-primary px-2.5 text-sm text-text-primary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="truncate">{REPLACEMENT_MODE_LABEL[current]}</span>
                <ChevronDownIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
              </button>
            )}
          </ModeSelectMenu>
        </div>
        {/*
          Segunda línea fija (UX-10): cambia el texto y el color, nunca el
          alto. Reserva dos renglones — el del aviso ámbar, que es el estado
          más largo, puede partirse en una barra lateral angosta.
        */}
        <p
          aria-live="polite"
          className={`flex h-10 items-start gap-1.5 pr-1.5 text-sm leading-5 ${
            atRisk ? "font-medium text-warning-strong" : "text-text-secondary"
          }`}
        >
          {atRisk ? (
            <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span className="line-clamp-2">{note}</span>
        </p>
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title="¿Cambiar el modo de todo el documento?"
        message={`Vas a reemplazar los ajustes de ${describeOverrides(counts)} que modificaste a mano.`}
        confirmLabel="Cambiar todo"
        cancelLabel="Cancelar"
        variant="danger"
        onCancel={() => setPendingMode(null)}
        onConfirm={() => {
          const mode = pendingMode;
          setPendingMode(null);
          if (mode !== null) apply(mode);
        }}
      />
    </>
  );
}
