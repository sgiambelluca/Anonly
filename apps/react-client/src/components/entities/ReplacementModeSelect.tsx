/**
 * `ReplacementModeSelect` (`ui/Components.md` §3.4).
 *
 * Props: `groupId`, `currentMode`. Opciones: `placeholder` (default),
 * `mask`, `synthetic`, `redact`. Emite `actions.updateGroup(groupId, {
 * replacementMode })` (`GROUP_UPDATE_REQUESTED`, canal `ui`).
 *
 * Nota de alcance: el catálogo pide "preview del valor resultante" en el
 * propio selector — ese preview es `group.replacementValue`, ya resuelto por
 * el Grouping Engine (`core/Grouping_Engine.md` §"replacementValue por modo");
 * `EntityGroupItem` lo muestra aparte (no hace falta duplicarlo acá).
 */

import type { ReplacementMode } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { Select } from "../common/Select.js";

import { REPLACEMENT_MODE_OPTIONS } from "./replacementModeOptions.js";

export interface ReplacementModeSelectProps {
  readonly groupId: string;
  readonly currentMode: ReplacementMode;
  /**
   * ADR-078 §1. Cuando el valor lo escribió el usuario, la etiqueta del modo
   * vigente pasa a "Personalizado".
   *
   * **No es un `ReplacementMode` nuevo**: el modo sigue siendo el que está
   * (normalmente `placeholder`), y por eso las reglas y la leyenda del export
   * —que filtran por modo— siguen funcionando sin cambios. Lo único que cambia
   * es cómo se lee la fila: decir "Placeholder" cuando el token es `[PERITO]`
   * hace que el selector describa algo que no se parece a lo que se ve.
   */
  readonly customValue?: boolean;
}

export function ReplacementModeSelect({
  groupId,
  currentMode,
  customValue = false,
}: ReplacementModeSelectProps) {
  const options = customValue
    ? REPLACEMENT_MODE_OPTIONS.map((option) =>
        option.value === currentMode ? { ...option, label: "Personalizado" } : option,
      )
    : REPLACEMENT_MODE_OPTIONS;

  return (
    <Select
      value={currentMode}
      onChange={(mode) => actions.updateGroup(groupId, { replacementMode: mode })}
      options={options}
      aria-label="Modo de reemplazo"
    />
  );
}
