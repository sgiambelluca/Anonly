/**
 * `PersonGenderSelect` (`ui/Components.md` §3.4b, ADR-060 §6, wire actualizado
 * por ADR-069 §4).
 *
 * Props: `groupId`, `currentGender` — el valor **almacenado** en el grupo
 * (`EntityGroup.personGender`, que sigue siendo `"f" | "m" | ausente"`;
 * ADR-069 §4 no le cambió la forma). Visibilidad ("solo sobre grupos
 * `Person`"): la decide quien monta este componente
 * (`isPersonGenderSelectVisible`, `personGenderVisibility.ts`), no una prop
 * de tipo acá — mismo patrón que `ReplacementModeSelect`, que tampoco recibe
 * el `type` del grupo.
 *
 * Emite `actions.updateGroup(groupId, { personGender: choice })` con
 * `choice: PersonGenderChoice`. "Sin determinar" viaja como el valor
 * explícito `"neutral"` (nunca ausencia de clave): `applyGroupUpdate`
 * resuelve el patch con `!== undefined`, así que sin ese valor el usuario no
 * podría deshacer su elección (ADR-069 §4).
 *
 * Preview del token resultante: "igual que §3.4" (`ui/Components.md` §3.4b)
 * — no hay nada que construir acá. `group.replacementValue` ya lo resuelve
 * el Grouping Engine y es lo que se ve en el visor anonimizado; duplicarlo
 * en el propio `Select` sería una segunda fuente de verdad, la misma razón
 * por la que `ReplacementModeSelect` tampoco lo hace.
 *
 * `open`/`onOpenChange` opcionales: no son parte del contrato de datos del
 * componente (no hay prop `type` ni `replacementMode` acá), pero
 * `EntityGroupItem` los necesita para que la marca de "género sin
 * determinar" (`PersonGenderUndeterminedBadge`, un hermano en el árbol —
 * `ui/Components.md` §3.3) pueda abrir este desplegable con su propio click
 * ("Click abre el selector", ADR-060 §5). Sin controlar el estado no hay
 * forma de que un componente hermano dispare la apertura de este.
 */

import type { PersonGender } from "@anonly/anonymization-core";

import { actions } from "../../core-adapter/actions.js";
import { Select } from "../common/Select.js";

import { PERSON_GENDER_OPTIONS, toPersonGenderChoice } from "./personGenderOptions.js";

export interface PersonGenderSelectProps {
  readonly groupId: string;
  readonly currentGender: PersonGender | undefined;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export function PersonGenderSelect({
  groupId,
  currentGender,
  open,
  onOpenChange,
}: PersonGenderSelectProps) {
  // `exactOptionalPropertyTypes`: no reenviar `undefined` explícito a props
  // opcionales de `Select` (mismo motivo que en `Select.tsx`).
  const controlledOpenProps = {
    ...(open !== undefined ? { open } : {}),
    ...(onOpenChange !== undefined ? { onOpenChange } : {}),
  };

  return (
    <Select
      value={toPersonGenderChoice(currentGender)}
      onChange={(choice) => actions.updateGroup(groupId, { personGender: choice })}
      options={PERSON_GENDER_OPTIONS}
      aria-label="Género"
      {...controlledOpenProps}
    />
  );
}
