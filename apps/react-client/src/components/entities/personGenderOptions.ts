/**
 * `personGenderOptions.ts` — etiquetas (es) de `PersonGenderChoice`, el mapeo
 * del valor almacenado en `EntityGroup.personGender` al valor de tres estados
 * que necesita el control, y el ciclo del `PersonGenderToggle`
 * (`ui/Components.md` §3.4b). Presentacional puro, mismo criterio que
 * `replacementModeOptions.ts`.
 *
 * El ciclo vive acá y no dentro del componente porque `apps/react-client`
 * corre sus tests en Node (`vitest.config.ts` raíz, sin jsdom): es la única
 * forma de testearlo sin renderizar, mismo criterio que
 * `personGenderVisibility.ts` y `entityTree.ts`.
 */

import type { PersonGender, PersonGenderChoice } from "@anonly/anonymization-core";

export const PERSON_GENDER_LABEL: Readonly<Record<PersonGenderChoice, string>> = {
  f: "Femenino",
  m: "Masculino",
  neutral: "Sin determinar",
};

/**
 * ADR-069 §4: el almacenamiento sigue siendo `"f" | "m" | ausente`
 * (`EntityGroup.personGender`), pero el control de tres estados necesita un
 * valor para el tercer estado — de ahí el mapeo de la ausencia a `"neutral"`.
 */
export function toPersonGenderChoice(currentGender: PersonGender | undefined): PersonGenderChoice {
  return currentGender ?? "neutral";
}

/**
 * ADR-071 §2: `neutral → f → m → neutral`. El neutro es el estado de reposo
 * de un grupo sin resolver, y ♀ antes que ♂ es el orden en que se conocen
 * los símbolos.
 */
export function nextPersonGenderChoice(current: PersonGenderChoice): PersonGenderChoice {
  if (current === "neutral") return "f";
  if (current === "f") return "m";
  return "neutral";
}
