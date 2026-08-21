/**
 * `modeLevels.ts` — el modo de reemplazo en tres niveles (ADR-087 §3,
 * `ui/UX_Guidelines.md` §3.4).
 *
 * El Core ya resuelve el modo por precedencia **group > type > global**
 * (`core/Grouping_Engine.md` §13 caso 14). Este módulo es la mitad de la UI:
 * lee qué `Rule` existen para saber qué mostrar en cada nivel, y **planifica**
 * qué reglas hay que borrar y cuál crear/actualizar al aplicar un nivel.
 *
 * **El modelo es temporal, no estructural**: gana el último nivel que el
 * usuario tocó. Aplicar en un nivel **barre los de abajo** (§planApply*). Sin
 * ese barrido, una regla de grupo creada antes le ganaría para siempre a la
 * de tipo creada después, y el usuario no podría uniformar un tipo sin
 * repasar fila por fila.
 *
 * **Por qué la fila escribe una `Rule` de scope `group` y no
 * `GROUP_UPDATE_REQUESTED`**: `resolveMode` chequea las reglas **antes** que
 * `group.replacementMode`, y `grouping.engine.ts` lo hace literal —asigna lo
 * que el usuario eligió y una línea después lo pisa con `resolveMode`—, así
 * que con una regla de tipo vigente el selector de la fila **es inerte**. Ver
 * ADR-087 §3.1a.
 *
 * Módulo puro: los tests de `apps/react-client` corren en Node sin jsdom.
 */

import { ReplacementMode, type EntityType, type Rule } from "@anonly/anonymization-core";

/**
 * Default del motor cuando no hay ninguna regla
 * (`Grouping_Engine.md`, último `return` de `resolveMode`).
 */
export const ENGINE_DEFAULT_MODE = ReplacementMode.Placeholder;

/** Prioridad de las reglas creadas desde el árbol. `priority` no se expone en la UI (ADR-087 §3). */
export const UI_RULE_PRIORITY = 100;

function enabledRules(rules: ReadonlyArray<Rule>): ReadonlyArray<Rule> {
  return rules.filter((rule) => rule.enabled);
}

/** La `Rule` de scope `global` vigente, o `undefined`. */
export function findDocumentRule(rules: ReadonlyArray<Rule>): Rule | undefined {
  return enabledRules(rules).find((rule) => rule.scope === "global");
}

/** La `Rule` de scope `type` vigente para ese `EntityType`, o `undefined`. */
export function findTypeRule(rules: ReadonlyArray<Rule>, type: EntityType): Rule | undefined {
  return enabledRules(rules).find(
    (rule) => rule.scope === "type" && rule.target.entityType === type,
  );
}

/** La `Rule` de scope `group` vigente para ese grupo, o `undefined`. */
export function findGroupRule(rules: ReadonlyArray<Rule>, groupId: string): Rule | undefined {
  return enabledRules(rules).find(
    (rule) => rule.scope === "group" && rule.target.groupId === groupId,
  );
}

/**
 * Una fila "tiene decisión propia" ⟺ existe una `Rule` de scope `group` para
 * ella. Es lo que el borde del selector de fila señala (ADR-087 §3.1), y es
 * derivable **sin** un `replacementModeUserSet` en `EntityGroup` —que no
 * existe— precisamente porque la fila ahora escribe una regla.
 */
export function hasOwnDecision(rules: ReadonlyArray<Rule>, groupId: string): boolean {
  return findGroupRule(rules, groupId) !== undefined;
}

/** Modo que muestra el selector de nivel documento. */
export function resolveDocumentMode(rules: ReadonlyArray<Rule>): ReplacementMode {
  return findDocumentRule(rules)?.mode ?? ENGINE_DEFAULT_MODE;
}

/**
 * Lo que muestra la cabecera de un tipo.
 *
 * `"mixed"` cuando sus grupos **no comparten** `replacementMode`: la cabecera
 * no puede mostrar un modo concreto sin mentir sobre las filas que no lo
 * tienen, así que muestra "Varios" (ADR-087 §3.2).
 *
 * Se compara el `replacementMode` **efectivo de los grupos**, no las reglas:
 * es el dato que el usuario ve en las filas, y no exige resolver precedencia.
 */
export type TypeHeaderState =
  | { readonly kind: "uniform"; readonly mode: ReplacementMode }
  | { readonly kind: "mixed" };

export function resolveTypeHeaderState(
  rules: ReadonlyArray<Rule>,
  type: EntityType,
  groupModes: ReadonlyArray<ReplacementMode>,
): TypeHeaderState {
  if (groupModes.length > 0) {
    const [first, ...rest] = groupModes;
    if (first !== undefined && rest.every((mode) => mode === first)) {
      return { kind: "uniform", mode: first };
    }
    return { kind: "mixed" };
  }
  // Tipo sin grupos: no hay nada que comparar, así que la cabecera muestra lo
  // que le correspondería por regla. No es un caso muerto — el árbol puede
  // filtrarse por búsqueda y dejar un tipo sin filas visibles.
  return { kind: "uniform", mode: findTypeRule(rules, type)?.mode ?? resolveDocumentMode(rules) };
}

/**
 * Qué hace falta emitir para aplicar un modo en un nivel, y qué hace falta
 * para deshacerlo.
 *
 * **Las dos mitades del undo son distintas y no se pueden mezclar**: las
 * reglas barridas se **borraron** (se deshacen recreándolas), mientras que la
 * regla del propio nivel, si ya existía, se **actualizó** (se deshace
 * devolviéndole su modo anterior). Un `restore` único que juntara las dos
 * llevaría a recrear una regla vigente, y `rules.store.addRule` agrega sin
 * deduplicar por id: quedaría duplicada.
 */
export interface ApplyModePlan {
  /** Ids de las reglas de niveles **de abajo** que el barrido retira. */
  readonly deleteRuleIds: ReadonlyArray<string>;
  /** Las mismas, completas, para recrearlas en el undo. */
  readonly sweptRules: ReadonlyArray<Rule>;
  /** `undefined` ⇒ crear una regla nueva; si viene, actualizar ésa. */
  readonly updateRuleId: string | undefined;
  /** Modo que tenía la regla del nivel antes de aplicarse; `undefined` si no había regla. */
  readonly previousMode: ReplacementMode | undefined;
}

function buildPlan(swept: ReadonlyArray<Rule>, existing: Rule | undefined): ApplyModePlan {
  return {
    deleteRuleIds: swept.map((rule) => rule.id),
    sweptRules: swept,
    updateRuleId: existing?.id,
    previousMode: existing?.mode,
  };
}

/**
 * Nivel documento (ADR-087 §3.1b regla 3): barre **todo** — las reglas de tipo
 * y las de grupo — y deja la global. "Todo el documento" significa todo.
 */
export function planApplyDocumentMode(rules: ReadonlyArray<Rule>): ApplyModePlan {
  const swept = rules.filter((rule) => rule.scope === "type" || rule.scope === "group");
  return buildPlan(swept, findDocumentRule(rules));
}

/**
 * Nivel tipo (ADR-087 §3.1b regla 2): barre las reglas de grupo **de los
 * grupos de ese tipo**, y deja la de tipo. No toca las de otros tipos ni la
 * global.
 */
export function planApplyTypeMode(
  rules: ReadonlyArray<Rule>,
  type: EntityType,
  groupIdsOfType: ReadonlySet<string>,
): ApplyModePlan {
  const swept = rules.filter(
    (rule) =>
      rule.scope === "group" &&
      rule.target.groupId !== undefined &&
      groupIdsOfType.has(rule.target.groupId),
  );
  return buildPlan(swept, findTypeRule(rules, type));
}

/**
 * Nivel fila: no barre nada —es el nivel más específico, no tiene niveles
 * debajo— y solo crea o actualiza su propia regla.
 */
export function planApplyGroupMode(rules: ReadonlyArray<Rule>, groupId: string): ApplyModePlan {
  return buildPlan([], findGroupRule(rules, groupId));
}

/**
 * Cuánto hay en juego, para la fricción escalada (ADR-087 §3.3): el conteo que
 * el diálogo nombra y el que enciende el acento de precaución del nivel
 * documento (§3.3a).
 */
export interface OverrideCounts {
  readonly types: number;
  readonly groups: number;
}

export function countOverrides(rules: ReadonlyArray<Rule>): OverrideCounts {
  const active = enabledRules(rules);
  return {
    types: active.filter((rule) => rule.scope === "type").length,
    groups: active.filter((rule) => rule.scope === "group").length,
  };
}

/** `true` si aplicar en ese nivel destruiría algo — o sea, si hay que confirmar. */
export function needsConfirmation(counts: OverrideCounts): boolean {
  return counts.types > 0 || counts.groups > 0;
}

/**
 * Frase del diálogo y del acento de precaución. Nombra **lo que se va a
 * romper** en vez de advertir en abstracto: "vas a reemplazar los ajustes de
 * N categorías y M entidades" es accionable; "esta acción es destructiva" no.
 */
export function describeOverrides(counts: OverrideCounts): string {
  const parts: string[] = [];
  if (counts.types > 0) {
    parts.push(`${counts.types} ${counts.types === 1 ? "categoría" : "categorías"}`);
  }
  if (counts.groups > 0) {
    parts.push(`${counts.groups} ${counts.groups === 1 ? "entidad" : "entidades"}`);
  }
  return parts.join(" y ");
}
