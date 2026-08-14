import { describe, expect, it } from "vitest";

import {
  PERSON_GENDER_OPTIONS,
  toPersonGenderChoice,
} from "../components/entities/personGenderOptions.js";

describe("toPersonGenderChoice", () => {
  it.each([
    ["f", "f"],
    ["m", "m"],
    [undefined, "neutral"],
  ] as const)("stored %s → choice %s", (stored, expected) => {
    expect(toPersonGenderChoice(stored)).toBe(expected);
  });
});

describe("PERSON_GENDER_OPTIONS", () => {
  it("lists the three states of the control, in order", () => {
    expect(PERSON_GENDER_OPTIONS.map((option) => option.value)).toEqual(["f", "m", "neutral"]);
  });

  it("each option has a non-empty label", () => {
    for (const option of PERSON_GENDER_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
