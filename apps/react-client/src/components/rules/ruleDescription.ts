/**
 * `ruleDescription.ts` — formateo puro de texto legible para una `Rule`
 * (`ui/Components.md` §4.2: "descripción legible ('DNI → mask', 'Juan Pérez →
 * redact')"; `ui/UX_Guidelines.md` §4 agrega el caso `global`: "Modo default:
 * placeholder").
 *
 * `describeRuleEffectPreview` cubre `ui/UX_Guidelines.md` §4.1: "Preview:
 * muestra un ejemplo del efecto de la regla sobre un grupo afectado" — texto
 * descriptivo, **no** el `replacementValue` real (eso depende de
 * `shared/synthesizer.ts`, lógica del Core que la UI no reimplementa).
 */

import type { ReplacementMode, Rule, RuleScope } from "@anonly/anonymization-core";

import { ENTITY_TYPE_LABEL } from "../entities/entityTypeLabels.js";
import { REPLACEMENT_MODE_LABEL } from "../entities/replacementModeOptions.js";

/**
 * Descripción de una regla ya creada, para `RuleItem`. `resolveGroupLabel`
 * busca el `canonicalValue` vigente del grupo (puede ya no existir si el
 * grupo fue eliminado/deshabilitado — `undefined` en ese caso).
 */
export function formatRuleDescription(
  rule: Rule,
  resolveGroupLabel: (groupId: string) => string | undefined,
): string {
  const modeLabel = REPLACEMENT_MODE_LABEL[rule.mode];
  if (rule.scope === "global") return `Modo default: ${modeLabel}`;
  if (rule.scope === "type") {
    const type = rule.target.entityType;
    const typeLabel = type !== undefined ? ENTITY_TYPE_LABEL[type] : "Tipo desconocido";
    return `${typeLabel} → ${modeLabel}`;
  }
  const groupId = rule.target.groupId;
  const groupLabel = groupId !== undefined ? resolveGroupLabel(groupId) : undefined;
  return `${groupLabel ?? "Grupo eliminado"} → ${modeLabel}`;
}

export interface RuleEffectPreviewLabels {
  readonly entityTypeLabel?: string;
  readonly groupLabel?: string;
}

/** Preview textual para el formulario de creación/edición (aún no es una `Rule`). */
export function describeRuleEffectPreview(
  form: { readonly scope: RuleScope; readonly mode: ReplacementMode },
  labels: RuleEffectPreviewLabels,
): string {
  const modeLabel = REPLACEMENT_MODE_LABEL[form.mode];
  if (form.scope === "global") {
    return `Se aplicará como modo default a todos los grupos sin una regla más específica (${modeLabel}).`;
  }
  if (form.scope === "type") {
    const typeLabel = labels.entityTypeLabel ?? "este tipo";
    return `Los grupos de tipo ${typeLabel} pasarán a modo ${modeLabel}.`;
  }
  const groupLabel = labels.groupLabel ?? "el grupo elegido";
  return `${groupLabel} pasará a modo ${modeLabel}.`;
}
