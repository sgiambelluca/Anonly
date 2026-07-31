/**
 * `ruleValidation.ts` — validación pura + construcción de `RuleTarget` para
 * `RuleCreatorDialog`/`RuleEditorDialog` (`ui/UX_Guidelines.md` §4.1: "Scope:
 * radio (Global/Por tipo/Por grupo)... Prioridad: input numérico 0-1000").
 *
 * Invariantes de `03_Data_Model.md` §13:
 * - `priority ∈ [0, 1000]`.
 * - `scope === "group"` ⇒ `target.groupId` obligatorio, `target.entityType`
 *   indefinido.
 * - `scope === "type"` ⇒ `target.entityType` obligatorio, `target.groupId`
 *   indefinido.
 * - `scope === "global"` ⇒ ambos indefinidos.
 *
 * Separado de los componentes: `apps/react-client` corre sus tests en Node
 * (sin jsdom), mismo criterio que `entities/mergeValidation.ts`.
 */

import type {
  EntityType,
  ReplacementMode,
  RuleScope,
  RuleTarget,
} from "@anonly/anonymization-core";

export interface RuleFormState {
  readonly scope: RuleScope;
  /** Solo relevante (y requerido) cuando `scope === "type"`. */
  readonly entityType: EntityType | null;
  /** Solo relevante (y requerido) cuando `scope === "group"`. */
  readonly groupId: string | null;
  readonly mode: ReplacementMode;
  readonly priority: number;
}

export interface RuleValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

export const MIN_RULE_PRIORITY = 0;
export const MAX_RULE_PRIORITY = 1000;

export function validateRuleForm(form: RuleFormState): RuleValidationResult {
  if (
    !Number.isFinite(form.priority) ||
    form.priority < MIN_RULE_PRIORITY ||
    form.priority > MAX_RULE_PRIORITY
  ) {
    return {
      valid: false,
      reason: `La prioridad debe estar entre ${MIN_RULE_PRIORITY} y ${MAX_RULE_PRIORITY}.`,
    };
  }
  if (form.scope === "type" && form.entityType === null) {
    return { valid: false, reason: "Elegí un tipo de entidad." };
  }
  if (form.scope === "group" && form.groupId === null) {
    return { valid: false, reason: "Elegí un grupo." };
  }
  return { valid: true };
}

/**
 * Construye el `RuleTarget` consistente con las invariantes de §13.
 * `null` si `form` no pasa `validateRuleForm` (el llamador debe chequear la
 * validación para mostrar el motivo; esta función solo devuelve el resultado).
 */
export function buildRuleTarget(form: RuleFormState): RuleTarget | null {
  if (!validateRuleForm(form).valid) return null;
  if (form.scope === "global") return { kind: "global" };
  if (form.scope === "type") {
    if (form.entityType === null) return null;
    return { kind: "type", entityType: form.entityType };
  }
  if (form.groupId === null) return null;
  return { kind: "group", groupId: form.groupId };
}
