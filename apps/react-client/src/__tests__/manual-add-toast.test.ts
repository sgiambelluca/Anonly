import {
  DetectionSource,
  EntityType,
  ReplacementMode,
  type EntityGroup,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  describeManualAdd,
  findAddedGroup,
  foldForLookup,
} from "../components/entities/manualEntityFeedback.js";

// ADR-169 §7: el toast de las tres vías de agregado.

function group(overrides: Partial<EntityGroup>): EntityGroup {
  return {
    id: "g",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 06]",
    indexInType: 6,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[PERSONA 06]",
      mask: "x",
      synthetic: "y",
      placeholderLadder: ["[PERSONA 06]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("foldForLookup", () => {
  it("sin mayúsculas, sin tildes, espacios colapsados", () => {
    expect(foldForLookup("  JOSÉ   Pérez ")).toBe("jose perez");
  });
});

describe("findAddedGroup", () => {
  const person = group({ id: "p6", canonicalValue: "Lucía Ferreyra" });
  const org = group({
    id: "o1",
    type: EntityType.Organization,
    canonicalValue: "Banco Nación",
    aliases: ["BANCO NACION"],
  });
  const withMember = group({
    id: "p2",
    canonicalValue: "María Laura Fernández",
    members: [
      {
        occurrenceId: "o",
        value: "Fernández",
        pageIndex: 0,
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        source: DetectionSource.Manual,
      },
    ],
  });
  const byType = new Map([
    [EntityType.Person, [person, withMember]],
    [EntityType.Organization, [org]],
  ]);

  it("encuentra por canónico en el tipo elegido", () => {
    expect(findAddedGroup(byType, "lucia ferreyra", EntityType.Person)?.id).toBe("p6");
  });

  it("encuentra por alias o por el valor de un miembro", () => {
    expect(findAddedGroup(byType, "Banco Nación", EntityType.Organization)?.id).toBe("o1");
    expect(findAddedGroup(byType, "Fernández", EntityType.Person)?.id).toBe("p2");
  });

  it("si el dedup lo sumó a un grupo de otro tipo, lo encuentra igual", () => {
    expect(findAddedGroup(byType, "Banco Nacion", EntityType.Custom)?.id).toBe("o1");
  });

  it("sin grupo: undefined", () => {
    expect(findAddedGroup(byType, "nadie", EntityType.Person)).toBeUndefined();
  });
});

describe("describeManualAdd", () => {
  it("'Agregaste «X» · Persona N.º 06 · 2 apariciones ocultas'", () => {
    expect(
      describeManualAdd({
        value: "Lucía Ferreyra",
        entityType: EntityType.Person,
        occurrenceCount: 2,
        group: group({ indexInType: 6 }),
      }),
    ).toEqual({
      title: "Agregaste «Lucía Ferreyra»",
      description: "Persona N.º 06 · 2 apariciones ocultas",
    });
  });

  it("el N.º es el del grupo que quedó, aunque el tipo elegido fuera otro", () => {
    expect(
      describeManualAdd({
        value: "x",
        entityType: EntityType.Custom,
        occurrenceCount: 1,
        group: group({ type: EntityType.Organization, indexInType: 3 }),
      }).description,
    ).toBe("Organización N.º 03 · 1 aparición oculta");
  });

  it("sin grupo encontrado, solo el tipo", () => {
    expect(
      describeManualAdd({
        value: "x",
        entityType: EntityType.DNI,
        occurrenceCount: 3,
        group: undefined,
      }).description,
    ).toBe("DNI · 3 apariciones ocultas");
  });
});
