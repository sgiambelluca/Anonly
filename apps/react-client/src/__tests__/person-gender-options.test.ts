import type { PersonGenderChoice } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  nextPersonGenderChoice,
  PERSON_GENDER_LABEL,
  toPersonGenderChoice,
} from "../components/entities/personGenderOptions.js";
import { PERSON_GENDER_SYMBOL } from "../components/entities/personGenderSymbols.js";

const ALL_CHOICES: ReadonlyArray<PersonGenderChoice> = ["f", "m", "neutral"];

// ADR-071 §2: el estado mostrado sale SIEMPRE de `EntityGroup.personGender`,
// así que un grupo con género inferido aparece con su símbolo sin ninguna
// interacción previa. El control no tiene estado propio, y esta función es
// toda su derivación.
describe("toPersonGenderChoice", () => {
  it.each([
    ["f", "f"],
    ["m", "m"],
    [undefined, "neutral"],
  ] as const)("stored %s → choice %s", (stored, expected) => {
    expect(toPersonGenderChoice(stored)).toBe(expected);
  });
});

// ADR-071 §2: `neutral → f → m → neutral`.
describe("nextPersonGenderChoice", () => {
  it.each([
    ["neutral", "f"],
    ["f", "m"],
    ["m", "neutral"],
  ] as const)("%s → %s", (current, expected) => {
    expect(nextPersonGenderChoice(current)).toBe(expected);
  });

  it("tres clicks vuelven al punto de partida, desde cualquier estado", () => {
    for (const start of ALL_CHOICES) {
      const afterThree = nextPersonGenderChoice(
        nextPersonGenderChoice(nextPersonGenderChoice(start)),
      );
      expect(afterThree).toBe(start);
    }
  });

  it("el ciclo visita los tres estados: ninguno queda inalcanzable", () => {
    const visited = new Set<PersonGenderChoice>();
    let current: PersonGenderChoice = "neutral";
    for (let i = 0; i < 3; i++) {
      visited.add(current);
      current = nextPersonGenderChoice(current);
    }
    expect([...visited].sort()).toEqual([...ALL_CHOICES].sort());
  });
});

describe("presentación de los tres estados", () => {
  it("cada estado tiene etiqueta no vacía y símbolo propio", () => {
    for (const choice of ALL_CHOICES) {
      expect(PERSON_GENDER_LABEL[choice].length).toBeGreaterThan(0);
      expect(PERSON_GENDER_SYMBOL[choice]).toBeTypeOf("function");
    }
  });

  it("los tres símbolos son distintos entre sí", () => {
    const symbols = ALL_CHOICES.map((choice) => PERSON_GENDER_SYMBOL[choice]);
    expect(new Set(symbols).size).toBe(3);
  });
});
