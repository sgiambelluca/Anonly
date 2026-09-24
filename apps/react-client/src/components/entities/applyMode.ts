/**
 * `applyMode.ts` — ejecuta un `ApplyModePlan` (ADR-087 §3.1b) como una sola
 * entrada de la pila de deshacer (ADR-172).
 *
 * `modeLevels.ts` decide **qué** hay que borrar y crear; esto lo **hace**,
 * emitiendo las acciones de reglas que ya existían (`createRule`,
 * `updateRule`, `deleteRule`). No hay API nueva del Core: los tres niveles del
 * árbol escriben las mismas `Rule` de siempre.
 */

import {
  type EntityType,
  type ReplacementMode,
  type Rule,
  type RuleScope,
} from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { showToast } from "../common/toast.js";

import { editToast, recordEdit } from "./editHistory.js";
import { UI_RULE_PRIORITY, type ApplyModePlan } from "./modeLevels.js";

export interface ApplyModeInput {
  readonly plan: ApplyModePlan;
  readonly scope: RuleScope;
  readonly mode: ReplacementMode;
  /** Presente en `scope: "type"`. */
  readonly entityType?: EntityType;
  /** Presente en `scope: "group"`. */
  readonly groupId?: string;
  /** Qué se hizo, para la pila de deshacer (ADR-172 §2). */
  readonly historyLabel: string;
  /**
   * Texto del toast, ya en lenguaje del usuario ("Todo el documento →
   * Etiquetar"). `null` = sin toast: el cambio de modo de una fila no lo
   * lleva (`Components.md` §3.4d), pero igual entra a la pila y se deshace
   * con `Ctrl+Z` (ADR-172 §3).
   */
  readonly toastText: string | null;
}

function buildRule(input: ApplyModeInput): Rule {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    scope: input.scope,
    target: {
      kind: input.scope,
      ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
      ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    },
    mode: input.mode,
    priority: UI_RULE_PRIORITY,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Aplica el plan y, si corresponde, muestra el toast con "Deshacer".
 *
 * Antes de emitir nada toma el punto de restauración (ADR-172 §2): un
 * barrido borra reglas y crea la nueva, y todo eso es **una** entrada de la
 * pila. Deshacer vuelve al punto —reglas incluidas— en vez de recrear a mano
 * las barridas, como hacía el snapshot de reglas que llevaba el toast
 * (`Components.md` §3.11, retirado por ADR-172 §4).
 *
 * Orden: **primero el barrido, después la regla del nivel**. Al revés, existe
 * una ventana en la que conviven la regla nueva y las que va a reemplazar, y
 * `resolveMode` resolvería con las viejas ganando por especificidad — el
 * usuario vería el modo anterior parpadear antes del nuevo.
 */
export function applyModeAtLevel(input: ApplyModeInput): void {
  const { plan } = input;
  const recorded = recordEdit(input.historyLabel);

  for (const ruleId of plan.deleteRuleIds) {
    actions.deleteRule(ruleId);
  }

  if (plan.updateRuleId === undefined) {
    actions.createRule(buildRule(input));
  } else {
    actions.updateRule(plan.updateRuleId, { mode: input.mode, updatedAt: Date.now() });
  }

  if (input.toastText === null) return;
  showToast(editToast({ title: input.toastText }, recorded));
}
