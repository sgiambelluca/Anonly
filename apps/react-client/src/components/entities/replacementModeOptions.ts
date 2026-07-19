/**
 * `replacementModeOptions.ts` — opciones/etiquetas (es) de `ReplacementMode`
 * para los `Select` de `ReplacementModeSelect` (`ui/Components.md` §3.4) y
 * `ConflictDialog` (flujo "Personalizado", `ui/UX_Guidelines.md` §6).
 * Presentacional puro, mismo criterio que `entityTypeLabels.ts`.
 */

import { ReplacementMode } from "@anonly/anonymization-core";

import type { SelectOption } from "../common/Select.js";

export const REPLACEMENT_MODE_LABEL: Readonly<Record<ReplacementMode, string>> = {
  [ReplacementMode.Placeholder]: "Placeholder",
  [ReplacementMode.Mask]: "Máscara",
  [ReplacementMode.Synthetic]: "Sintético",
  [ReplacementMode.Redact]: "Redactar",
};

export const REPLACEMENT_MODE_OPTIONS: ReadonlyArray<SelectOption<ReplacementMode>> = [
  ReplacementMode.Placeholder,
  ReplacementMode.Mask,
  ReplacementMode.Synthetic,
  ReplacementMode.Redact,
].map((mode) => ({ value: mode, label: REPLACEMENT_MODE_LABEL[mode] }));
