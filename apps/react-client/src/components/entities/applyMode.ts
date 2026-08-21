/**
 * `applyMode.ts` — ejecuta un `ApplyModePlan` (ADR-087 §3.1b) y arma su undo.
 *
 * `modeLevels.ts` decide **qué** hay que borrar y crear; esto lo **hace**,
 * emitiendo las acciones de reglas que ya existían (`createRule`,
 * `updateRule`, `deleteRule`). No hay API nueva del Core: los tres niveles del
 * árbol escriben las mismas `Rule` de siempre.
 *
 * El undo recrea las reglas barridas **con su id original**. Eso importa: si
 * se recrearan con ids nuevos, un segundo undo (o un `restore` guardado por
 * otro toast) apuntaría a reglas que ya no existen. `createRule` acepta la
 * `Rule` completa, así que conservar el id es gratis.
 */

import {
  type EntityType,
  type ReplacementMode,
  type Rule,
  type RuleScope,
} from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { showToast } from "../common/toast.js";

import { UI_RULE_PRIORITY, type ApplyModePlan } from "./modeLevels.js";

export interface ApplyModeInput {
  readonly plan: ApplyModePlan;
  readonly scope: RuleScope;
  readonly mode: ReplacementMode;
  /** Presente en `scope: "type"`. */
  readonly entityType?: EntityType;
  /** Presente en `scope: "group"`. */
  readonly groupId?: string;
  /** Texto del toast, ya en lenguaje del usuario ("Todo el documento → Etiquetar"). */
  readonly toastText: string;
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
 * Aplica el plan y muestra el toast con "Deshacer".
 *
 * Orden: **primero el barrido, después la regla del nivel**. Al revés, existe
 * una ventana en la que conviven la regla nueva y las que va a reemplazar, y
 * `resolveMode` resolvería con las viejas ganando por especificidad — el
 * usuario vería el modo anterior parpadear antes del nuevo.
 */
export function applyModeAtLevel(input: ApplyModeInput): void {
  const { plan } = input;

  for (const ruleId of plan.deleteRuleIds) {
    actions.deleteRule(ruleId);
  }

  let createdRuleId: string | undefined;
  if (plan.updateRuleId === undefined) {
    const rule = buildRule(input);
    actions.createRule(rule);
    createdRuleId = rule.id;
  } else {
    actions.updateRule(plan.updateRuleId, { mode: input.mode, updatedAt: Date.now() });
  }

  showToast(input.toastText, {
    label: "Deshacer",
    run: () => undoApply(plan, createdRuleId),
  });
}

/**
 * Deshacer (ADR-087 §3.3). Las dos mitades se deshacen distinto, y por eso el
 * plan las separa:
 *
 * - Las reglas **barridas** se borraron ⇒ se recrean, **con su id original**.
 *   Si se recrearan con ids nuevos, el snapshot de otro toast quedaría
 *   apuntando a reglas inexistentes.
 * - La regla **del propio nivel**, si ya existía, se actualizó ⇒ se le
 *   devuelve su `previousMode`. Recrearla sería un error: `rules.store.addRule`
 *   agrega sin deduplicar por id y quedaría duplicada.
 *
 * Un undo que solo borrara la regla nueva dejaría al usuario sin los ajustes
 * por tipo y por fila que tenía antes: el barrido es la parte destructiva.
 */
function undoApply(plan: ApplyModePlan, createdRuleId: string | undefined): void {
  if (createdRuleId !== undefined) {
    actions.deleteRule(createdRuleId);
  } else if (plan.updateRuleId !== undefined && plan.previousMode !== undefined) {
    actions.updateRule(plan.updateRuleId, { mode: plan.previousMode, updatedAt: Date.now() });
  }

  for (const rule of plan.sweptRules) {
    actions.createRule(rule);
  }
}
