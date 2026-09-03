import {
  EntityType,
  ReplacementMode,
  type EntityGroup,
  type PersonGender,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { isPersonGenderToggleVisible } from "../components/entities/personGenderVisibility.js";

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
    replacementValueUserSet: false,
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// `ui/Components.md` §3.4b (ADR-071 §1): "type === EntityType.Person Y
// replacementMode ∈ { placeholder, synthetic }". La matriz completa —13 tipos
// × 4 modos— porque la condición tiene dos ejes y el test viejo solo cubría
// uno: miraba el tipo y daba `true` en los cuatro modos, que es exactamente
// el defecto de UX que ADR-071 corrige.
describe("isPersonGenderToggleVisible", () => {
  const ALL_TYPES = Object.values(EntityType);
  const ALL_MODES = Object.values(ReplacementMode);

  it("cubre los 13 tipos y los 4 modos", () => {
    expect(ALL_TYPES).toHaveLength(13);
    expect(ALL_MODES).toHaveLength(4);
  });

  it.each(ALL_TYPES.flatMap((type) => ALL_MODES.map((mode) => [type, mode] as const)))(
    "type %s + mode %s",
    (type, mode) => {
      const expected =
        type === EntityType.Person &&
        (mode === ReplacementMode.Placeholder || mode === ReplacementMode.Synthetic);
      expect(isPersonGenderToggleVisible(makeGroup({ type, replacementMode: mode }))).toBe(
        expected,
      );
    },
  );

  // El control aparece igual con género resuelto o sin resolver: su estado
  // neutro ES la marca de "sin determinar" (ADR-071 §4), así que la
  // visibilidad no puede depender de `personGender` — si dependiera, la marca
  // desaparecería justo al no haber dato que marcar.
  it.each([undefined, "f", "m"] as const)(
    "visible sobre Person/placeholder con personGender %s",
    (personGender: PersonGender | undefined) => {
      const group = makeGroup(personGender === undefined ? {} : { personGender });
      expect(isPersonGenderToggleVisible(group)).toBe(true);
    },
  );

  it.each([ReplacementMode.Mask, ReplacementMode.Redact] as const)(
    "oculto sobre Person en modo %s aunque tenga género resuelto",
    (replacementMode) => {
      expect(isPersonGenderToggleVisible(makeGroup({ replacementMode, personGender: "f" }))).toBe(
        false,
      );
    },
  );
});
