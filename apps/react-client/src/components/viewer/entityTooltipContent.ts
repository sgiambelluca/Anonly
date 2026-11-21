/**
 * `entityTooltipContent.ts` — lo que dice el tooltip del visor (`Components.md`
 * §13b.8, ADR-224 §4, ADR-226 §4, `Tooltips.dc.html`).
 *
 * Tipo y número, valor original, reemplazo, apariciones y —**solo si el formato
 * es del usuario**— «Formato». Una entidad desactivada dice en «Reemplazo»:
 * «Desactivada: queda a la vista».
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import {
  ReplacementMode,
  type EntityGroup,
  type UserEntityTypeDefinition,
} from "@anonly/anonymization-core";

import type { DetectionState } from "../../store/detectionState.js";
import { FORMAT_ORIGIN_LABEL } from "../conflicts/formatConflict.js";
import { formatIndexInType, typeSingular } from "../entities/entityTypeLabels.js";
import { referenceFormat } from "../entities/formatNames.js";
import { REPLACEMENT_MODE_LABEL } from "../entities/replacementModeOptions.js";
import { NO_USER_TYPES } from "../entities/userTypes.js";

export const TOOLTIP_DISABLED_REPLACEMENT = "Desactivada: queda a la vista";

export const TOOLTIP_ROW_LABEL = {
  replacement: "Reemplazo",
  appearances: "Apariciones",
  format: "Formato",
} as const;

export interface EntityTooltipContent {
  /** «Teléfono», «Historia clínica»: el nombre del tipo. */
  readonly typeName: string;
  /** «N.º 01». */
  readonly number: string;
  /** El valor original, tal como figura en el documento. */
  readonly value: string;
  readonly replacement: string;
  readonly appearances: number;
  /** «CBU · tuyo»; `null` si el grupo no salió de un formato o el formato no es del usuario. */
  readonly format: string | null;
}

/** «Etiquetar · [TELEFONO 01]»; «Tapar con negro» no tiene texto que agregar. */
export function replacementText(group: EntityGroup): string {
  if (!group.enabled) return TOOLTIP_DISABLED_REPLACEMENT;
  const label = REPLACEMENT_MODE_LABEL[group.replacementMode];
  if (group.replacementMode === ReplacementMode.Redact || group.replacementValue === "") {
    return label;
  }
  return `${label} · ${group.replacementValue}`;
}

export function buildEntityTooltip(
  group: EntityGroup,
  userTypes: ReadonlyArray<UserEntityTypeDefinition> = NO_USER_TYPES,
  detection?: DetectionState,
): EntityTooltipContent {
  let format: string | null = null;
  if (group.formatId !== undefined && detection !== undefined) {
    const reference = referenceFormat(detection, group.formatId);
    if (reference.origin === "user") {
      format = `${reference.name} · ${FORMAT_ORIGIN_LABEL.user}`;
    }
  }
  return {
    typeName: typeSingular(group.type, userTypes),
    number: `N.º ${formatIndexInType(group.indexInType)}`,
    value: group.canonicalValue,
    replacement: replacementText(group),
    appearances: group.members.length,
    format,
  };
}
