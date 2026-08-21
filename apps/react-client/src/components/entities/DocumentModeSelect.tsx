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
 * **Estado de precaución** (§3.3a): neutro por defecto, con acento ámbar y un
 * resumen cuando existe alguna regla de tipo o de grupo. El color aparece
 * cuando significa algo — un control permanentemente en alarma estaría
 * gritando el 90 % de las veces en que la acción es inofensiva, y
 * `UX_Guidelines.md` §3.3 ya dice qué pasa con eso: "una señal que aparece
 * siempre no es una señal".
 */

import type { ReplacementMode } from "@anonly/anonymization-core";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { useRulesStore } from "../../store/rules.store.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";

import { applyModeAtLevel } from "./applyMode.js";
import {
  countOverrides,
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
  const [pendingMode, setPendingMode] = useState<ReplacementMode | null>(null);

  const current = resolveDocumentMode(rules);
  const counts = countOverrides(rules);
  const atRisk = needsConfirmation(counts);

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
        className={`flex flex-col gap-1 border-b px-3 py-2 ${
          atRisk
            ? "border-l-2 border-l-warning-strong border-b-border bg-bg-secondary"
            : "border-border bg-bg-secondary"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary">Todo el documento</span>
          <ModeSelectMenu
            current={current}
            example={{ sample: SAMPLE }}
            onSelect={handleSelect}
            align="right"
          >
            {({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label={`Modo de reemplazo de todo el documento: ${REPLACEMENT_MODE_LABEL[current]}`}
                className="flex items-center gap-1.5 rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {REPLACEMENT_MODE_LABEL[current]}
                <ChevronDownIcon className="h-4 w-4 text-text-secondary" aria-hidden />
              </button>
            )}
          </ModeSelectMenu>
        </div>
        {atRisk ? (
          // El resumen entera del riesgo ANTES de abrir el menú, no recién en
          // el diálogo. Ícono + texto además del acento: no se señala solo con
          // color (WCAG 1.4.1).
          <p className="flex items-center gap-1.5 text-sm text-warning-strong">
            <TriangleAlertIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {describeOverrides(counts)} con ajustes propios
          </p>
        ) : null}
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
