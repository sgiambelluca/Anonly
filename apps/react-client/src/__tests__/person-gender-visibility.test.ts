import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  isPersonGenderSelectVisible,
  isPersonGenderUndeterminedMarkVisible,
} from "../components/entities/personGenderVisibility.js";

function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "group-1",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 01]",
    indexInType: 1,
    enabled: true,
    aliases: ["Juan Pérez"],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// `ui/Components.md` §3.4b: "Visibilidad: solo sobre grupos con
// type === EntityType.Person. En cualquier otro tipo no se renderiza."
describe("isPersonGenderSelectVisible", () => {
  it.each([
    [EntityType.Person, true],
    [EntityType.Organization, false],
    [EntityType.Address, false],
    [EntityType.DNI, false],
    [EntityType.CUIT, false],
    [EntityType.Phone, false],
    [EntityType.Email, false],
    [EntityType.IBAN, false],
    [EntityType.CreditCard, false],
    [EntityType.Date, false],
    [EntityType.License, false],
    [EntityType.Plate, false],
    [EntityType.Custom, false],
  ] as const)("type %s → %s", (type, expected) => {
    expect(isPersonGenderSelectVisible(type)).toBe(expected);
  });
});

// ADR-060 §5: "Sin determinar → token neutro, y se marca en el árbol."
// Componentes.md §3.3: "solo sobre grupos Person en modo placeholder sin
// personGender resuelto."
describe("isPersonGenderUndeterminedMarkVisible", () => {
  it("Person, placeholder, sin género resuelto → true", () => {
    expect(isPersonGenderUndeterminedMarkVisible(makeGroup())).toBe(true);
  });

  it("Person, placeholder, género femenino resuelto → false", () => {
    expect(isPersonGenderUndeterminedMarkVisible(makeGroup({ personGender: "f" }))).toBe(false);
  });

  it("Person, placeholder, género masculino resuelto → false", () => {
    expect(isPersonGenderUndeterminedMarkVisible(makeGroup({ personGender: "m" }))).toBe(false);
  });

  it.each([ReplacementMode.Mask, ReplacementMode.Synthetic, ReplacementMode.Redact] as const)(
    "Person, modo %s (no placeholder), sin género → false",
    (mode) => {
      expect(isPersonGenderUndeterminedMarkVisible(makeGroup({ replacementMode: mode }))).toBe(
        false,
      );
    },
  );

  it("tipo distinto de Person, placeholder, sin género → false", () => {
    expect(
      isPersonGenderUndeterminedMarkVisible(makeGroup({ type: EntityType.Organization })),
    ).toBe(false);
  });
});
