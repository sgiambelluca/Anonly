/**
 * `TypeModeSelect` (`ui/Components.md` §3.10, ADR-087 §3, nivel tipo).
 *
 * Chip relleno en la cabecera del tipo, con el color de categoría como acento
 * (§3.1): se lee como parte del encabezado, no de las filas que agrupa. Es el
 * tratamiento intermedio de los tres — más liviano que la franja del documento,
 * más presente que el ghost de la fila.
 *
 * **Barre las reglas de grupo de sus grupos** al aplicarse (§3.1b regla 2). Sin
 * ese barrido, una fila puesta a mano antes le ganaría para siempre a la
 * cabecera, y uniformar un tipo obligaría a repasar fila por fila.
 *
 * **Estado mixto** (§3.2): cuando los grupos no comparten modo muestra
 * `Varios`, porque no puede mostrar un modo concreto sin mentir sobre las filas
 * que no lo tienen. El menú es el normal — con el barrido, cualquier opción
 * uniforma el tipo, así que no hace falta un ítem especial de "aplicar a
 * todos".
 */

import type { EntityGroup, EntityType, ReplacementMode } from "@anonly/anonymization-core";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { useRulesStore } from "../../store/rules.store.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";

import { applyModeAtLevel } from "./applyMode.js";
import { ENTITY_TYPE_COLOR } from "./entityTypeColors.js";
import { ENTITY_TYPE_LABEL } from "./entityTypeLabels.js";
import { hasOwnDecision, planApplyTypeMode, resolveTypeHeaderState } from "./modeLevels.js";
import { ModeSelectMenu } from "./ModeSelectMenu.js";
import { REPLACEMENT_MODE_LABEL, REPLACEMENT_MODE_SHORT_LABEL } from "./replacementModeOptions.js";

export interface TypeModeSelectProps {
  readonly type: EntityType;
  readonly groups: ReadonlyArray<EntityGroup>;
}

export function TypeModeSelect({ type, groups }: TypeModeSelectProps) {
  const rules = useRulesStore((state) => state.rules);
  const [pendingMode, setPendingMode] = useState<ReplacementMode | null>(null);

  const state = resolveTypeHeaderState(
    rules,
    type,
    groups.map((group) => group.replacementMode),
  );
  const label = state.kind === "mixed" ? "Varios" : REPLACEMENT_MODE_SHORT_LABEL[state.mode];
  const current = state.kind === "mixed" ? null : state.mode;

  const ownDecisionCount = groups.filter((group) => hasOwnDecision(rules, group.id)).length;
  // El primer grupo del tipo como muestra (ADR-087 §4): en este nivel no hay
  // un grupo único, pero un ejemplo con un dato real del propio documento se
  // lee mucho mejor que uno inventado.
  const sampleGroup = groups[0];

  function apply(mode: ReplacementMode): void {
    applyModeAtLevel({
      plan: planApplyTypeMode(rules, type, new Set(groups.map((group) => group.id))),
      scope: "type",
      mode,
      entityType: type,
      toastText: `${ENTITY_TYPE_LABEL[type]} → ${REPLACEMENT_MODE_LABEL[mode]}`,
    });
  }

  function handleSelect(mode: ReplacementMode): void {
    // Solo se confirma si el barrido va a destruir algo: sin filas con
    // decisión propia, aplicar un modo de tipo no rompe nada (§3.3).
    if (ownDecisionCount > 0) {
      setPendingMode(mode);
      return;
    }
    apply(mode);
  }

  return (
    <>
      <ModeSelectMenu
        current={current}
        example={{
          sample: sampleGroup?.canonicalValue ?? ENTITY_TYPE_LABEL[type],
          ...(sampleGroup !== undefined
            ? {
                currentMode: sampleGroup.replacementMode,
                currentValue: sampleGroup.replacementValue,
              }
            : {}),
        }}
        onSelect={handleSelect}
        align="right"
      >
        {({ open, toggle }) => (
          <button
            type="button"
            onClick={(event) => {
              // La cabecera entera expande/colapsa el tipo: sin esto, abrir el
              // menú también colapsaría el grupo debajo.
              event.stopPropagation();
              toggle();
            }}
            aria-expanded={open}
            aria-label={`Modo de reemplazo de ${ENTITY_TYPE_LABEL[type]}: ${
              state.kind === "mixed" ? "Varios" : REPLACEMENT_MODE_LABEL[state.mode]
            }`}
            // Relleno gris + barra de acento de la categoría. **El relleno es
            // lo que lo separa de los otros dos niveles** (ADR-087 §3.1): el
            // documento va sobre blanco con borde completo, la fila va
            // transparente. Tres rellenos distintos se distinguen de un
            // vistazo; tres bordes finos, no — que es el error que este
            // tratamiento existe para evitar.
            style={{ borderLeftColor: ENTITY_TYPE_COLOR[type] }}
            className="flex items-center gap-1 rounded border-l-[3px] bg-bg-tertiary px-2 py-1 text-sm font-medium text-text-primary hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="truncate">{label}</span>
            <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden />
          </button>
        )}
      </ModeSelectMenu>

      <ConfirmDialog
        open={pendingMode !== null}
        title={`¿Cambiar el modo de ${ENTITY_TYPE_LABEL[type]}?`}
        message={`Vas a reemplazar los ajustes de ${ownDecisionCount} ${
          ownDecisionCount === 1 ? "entidad que modificaste" : "entidades que modificaste"
        } a mano.`}
        confirmLabel="Cambiar todas"
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
