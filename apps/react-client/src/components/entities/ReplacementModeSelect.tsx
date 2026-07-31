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
}

export function ReplacementModeSelect({ groupId, currentMode }: ReplacementModeSelectProps) {
  return (
    <Select
      value={currentMode}
      onChange={(mode) => actions.updateGroup(groupId, { replacementMode: mode })}
      options={REPLACEMENT_MODE_OPTIONS}
      aria-label="Modo de reemplazo"
    />
  );
}
