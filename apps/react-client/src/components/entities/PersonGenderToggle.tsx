/**
 * `PersonGenderToggle` (`ui/Components.md` §3.4b, ADR-071 §1-§4, wire de
 * ADR-069 §4).
 *
 * Reemplaza a `PersonGenderSelect`, que era un `Select` montado en **toda**
 * fila `Person` sin mirar el modo, con el mismo peso visual que el selector
 * de reemplazo. Un documento con veinte personas mostraba veinte campos que
 * la mayoría de los usuarios no toca nunca (ADR-071, Contexto §1).
 *
 * Botón del ancho de un icono que muestra el estado actual y **cicla** al
 * siguiente con un click: `neutral → f → m → neutral`. El estado mostrado
 * sale siempre de `group.personGender`, venga de una inferencia o del
 * usuario, así que un grupo con género inferido aparece con su símbolo sin
 * ninguna interacción previa. El control no tiene estado propio.
 *
 * **El estado neutro ES la marca de "género sin determinar"** (ADR-071 §4,
 * supersede ADR-060 §5): trazo atenuado en vez de un badge aparte. Por eso
 * ya no existe `PersonGenderUndeterminedBadge` ni la apertura controlada que
 * `Select` había ganado para que ese badge abriera el desplegable de un
 * componente hermano.
 *
 * Visibilidad (`placeholder`/`synthetic` sobre `Person`): la decide quien
 * monta este componente vía `isPersonGenderToggleVisible`, no una prop de
 * acá — mismo patrón que `ReplacementModeSelect`.
 */

import type { PersonGender } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { Tooltip } from "../common/Tooltip.js";

import {
  nextPersonGenderChoice,
  PERSON_GENDER_LABEL,
  toPersonGenderChoice,
} from "./personGenderOptions.js";
import { PERSON_GENDER_SYMBOL } from "./personGenderSymbols.js";

export interface PersonGenderToggleProps {
  readonly groupId: string;
  readonly currentGender: PersonGender | undefined;
}

export function PersonGenderToggle({ groupId, currentGender }: PersonGenderToggleProps) {
  const current = toPersonGenderChoice(currentGender);
  const next = nextPersonGenderChoice(current);
  const Symbol = PERSON_GENDER_SYMBOL[current];

  return (
    <Tooltip content={`Género: ${PERSON_GENDER_LABEL[current]}`}>
      <button
        type="button"
        // `UX_Guidelines.md` §9 pide aria-label en iconos. Nombra el estado
        // actual Y el siguiente, porque en un control que cicla el destino
        // del click no es deducible del símbolo que se ve.
        aria-label={`Género: ${PERSON_GENDER_LABEL[current].toLowerCase()}. Cambiar a ${PERSON_GENDER_LABEL[
          next
        ].toLowerCase()}.`}
        onClick={() => actions.updateGroup(groupId, { personGender: next })}
        className={`rounded-md p-0.5 hover:bg-bg-tertiary ${
          // El neutro va atenuado: es el estado "sin fijar", y ese contraste
          // es lo que lo hace legible como marca de dato faltante.
          current === "neutral" ? "text-text-secondary" : "text-text-primary"
        }`}
      >
        <Symbol />
      </button>
    </Tooltip>
  );
}
