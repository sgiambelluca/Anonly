/**
 * `ReplacementModeSelect` (`ui/Components.md` §3.4, ADR-087 §3.1a).
 *
 * Nivel fila de los tres de §3.4. **Presentación ghost**: sin fondo hasta el
 * hover, mostrando en gris el modo vigente. Cuando la fila **tiene decisión
 * propia** —o sea, cuando existe una `Rule` de scope `group` para ese grupo—
 * gana un punto y peso de texto: no va a seguir a la cabecera de su tipo.
 *
 * **La marca no es un borde**, aunque el ADR lo escribiera así: verificado en
 * el browser, un borde fino acá era indistinguible del chip del tipo, que es
 * justo la confusión de alcance que los tres tratamientos existen para evitar.
 * Lo que separa los niveles es el **relleno** —blanco con borde el documento,
 * gris el tipo, transparente la fila—, y la decisión propia se marca dentro de
 * ese relleno.
 *
 * **Escribe una `Rule` de scope `group`, no `GROUP_UPDATE_REQUESTED`**, y ese
 * es el cambio de comportamiento de ADR-087 §3.1a. Motivo, verificado en
 * `grouping.engine.ts`:
 *
 * ```js
 * group.replacementMode = replacementMode;                    // lo elegido
 * group.replacementMode = resolveMode(group, session.rules);  // y se lo pisa
 * ```
 *
 * `resolveMode` chequea las reglas **antes** que `group.replacementMode`, así
 * que con una regla de tipo vigente el selector de la fila era **inerte**.
 * Hasta este rediseño casi no se notaba porque nadie usaba el panel de Reglas;
 * con §3.9/§3.10 creando reglas de rutina, habría pasado a ser el
 * comportamiento normal.
 *
 * **Sin toast**, salvo un caso (§3.3): es la acción más frecuente de la app y
 * es autoevidente y autorreversible con el mismo control, así que un toast por
 * cada una sería ruido que arrastra la credibilidad de los toasts de los otros
 * dos niveles. La excepción es el grupo con el valor escrito a mano, donde
 * cambiar el modo **destruye ese texto sin vuelta**.
 */

import type { EntityGroup, ReplacementMode } from "@anonly/anonymization-core";
import { ChevronDownIcon } from "lucide-react";

import { useRulesStore } from "../../store/rules.store.js";
import { showToast } from "../common/toast.js";

import { applyModeAtLevel } from "./applyMode.js";
import { hasOwnDecision, planApplyGroupMode } from "./modeLevels.js";
import { ModeSelectMenu } from "./ModeSelectMenu.js";
import { REPLACEMENT_MODE_LABEL, REPLACEMENT_MODE_SHORT_LABEL } from "./replacementModeOptions.js";

export interface ReplacementModeSelectProps {
  readonly group: EntityGroup;
}

export function ReplacementModeSelect({ group }: ReplacementModeSelectProps) {
  const rules = useRulesStore((state) => state.rules);
  const ownDecision = hasOwnDecision(rules, group.id);
  const current = group.replacementMode;

  function handleSelect(mode: ReplacementMode): void {
    if (mode === current) return;

    applyModeAtLevel({
      plan: planApplyGroupMode(rules, group.id),
      scope: "group",
      mode,
      groupId: group.id,
      toastText: `${group.canonicalValue} → ${REPLACEMENT_MODE_LABEL[mode]}`,
    });

    // ADR-087 §3.3: el único caso del nivel fila donde se pierde algo de
    // verdad. `grouping.engine.ts` recalcula `replacementValue` y apaga
    // `replacementValueUserSet` al cambiar el modo, y el texto que el usuario
    // tipeó no queda guardado en ningún lado — la vía documentada para
    // "volver" (cambiar el modo y volver al anterior) devuelve el valor
    // automático, no lo escrito.
    if (!group.replacementValueUserSet) return;
    showToast(`Se descartó el texto que habías escrito para ${group.canonicalValue}.`);
  }

  return (
    <ModeSelectMenu
      current={current}
      example={{
        sample: group.canonicalValue,
        currentMode: current,
        currentValue: group.replacementValue,
      }}
      onSelect={handleSelect}
      align="right"
      // `min-w` y no solo `flex-1`: repartir proporcionalmente dejaba el
      // selector en 48 px —"Etiquetar" cortado y el caret sin lugar—. Con un
      // piso, el nombre se queda con todo el resto y el modo sigue legible;
      // por debajo de eso encoge el nombre, que al menos tiene `title`.
      className="min-w-[6.5rem] flex-1"
    >
      {({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`Modo de reemplazo de ${group.canonicalValue}: ${REPLACEMENT_MODE_LABEL[current]}${
            ownDecision ? " (propio, no sigue a su categoría)" : ""
          }`}
          // Siempre transparente: es el relleno lo que separa los tres niveles
          // (ADR-087 §3.1), y el de la fila es "ninguno". La decisión propia se
          // marca con un punto y con peso de texto, no con un borde — un borde
          // fino acá se confundía con el chip del tipo, que es exactamente el
          // error de alcance que estos tratamientos existen para evitar.
          className={`flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-sm hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            ownDecision ? "font-medium text-text-primary" : "text-text-secondary"
          }`}
        >
          {ownDecision ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              aria-hidden
              title="Esta entidad tiene su propio modo y no sigue a su categoría"
            />
          ) : null}
          <span className="truncate">{REPLACEMENT_MODE_SHORT_LABEL[current]}</span>
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden />
        </button>
      )}
    </ModeSelectMenu>
  );
}
