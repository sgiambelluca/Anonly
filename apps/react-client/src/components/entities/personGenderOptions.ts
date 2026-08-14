/**
 * `personGenderOptions.ts` — opciones/etiquetas (es) de `PersonGenderChoice`
 * para el `Select` de `PersonGenderSelect` (`ui/Components.md` §3.4b), y el
 * mapeo del valor almacenado en `EntityGroup.personGender` al valor de tres
 * estados que necesita el control. Presentacional puro, mismo criterio que
 * `replacementModeOptions.ts`.
 */

import type { PersonGender, PersonGenderChoice } from "@anonly/anonymization-core";

import type { SelectOption } from "../common/Select.js";

export const PERSON_GENDER_LABEL: Readonly<Record<PersonGenderChoice, string>> = {
  f: "Femenino",
  m: "Masculino",
  neutral: "Sin determinar",
};

const PERSON_GENDER_CHOICES: ReadonlyArray<PersonGenderChoice> = ["f", "m", "neutral"];

export const PERSON_GENDER_OPTIONS: ReadonlyArray<SelectOption<PersonGenderChoice>> =
  PERSON_GENDER_CHOICES.map((choice) => ({ value: choice, label: PERSON_GENDER_LABEL[choice] }));

/**
 * ADR-069 §4: el almacenamiento sigue siendo `"f" | "m" | ausente`
 * (`EntityGroup.personGender`), pero el control de tres estados necesita un
 * valor para el tercer estado — de ahí el mapeo de la ausencia a `"neutral"`.
 */
export function toPersonGenderChoice(currentGender: PersonGender | undefined): PersonGenderChoice {
  return currentGender ?? "neutral";
}
