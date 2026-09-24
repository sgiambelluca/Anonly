import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  describeManualAdd,
  resolveAddedGroup,
} from "../components/entities/manualEntityFeedback.js";

// ADR-169 §7: el toast de las tres vías de agregado. ADR-175 §3: el grupo a
// nombrar se resuelve por `groupIds` (los ids que trae el resultado del
// Core), nunca buscando por texto — `findAddedGroup`/`foldForLookup` se
// retiraron (U-3).

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

describe("resolveAddedGroup (ADR-175 §3)", () => {
  const person = group({ id: "p6", canonicalValue: "Lucía Ferreyra" });
  const org = group({ id: "o1", type: EntityType.Organization, canonicalValue: "Banco Nación" });
  const byType = new Map([
    [EntityType.Person, [person]],
    [EntityType.Organization, [org]],
  ]);

  it("resuelve el único id de groupIds", () => {
    expect(resolveAddedGroup(byType, ["p6"], EntityType.Person)?.id).toBe("p6");
  });

  it("con varios ids, prefiere el primero del tipo pedido", () => {
    expect(resolveAddedGroup(byType, ["o1", "p6"], EntityType.Person)?.id).toBe("p6");
  });

  it("sin ninguno del tipo pedido, el primero de todos", () => {
    // El dedup del Core sumó el agregado a un grupo de otro tipo (ADR-175
    // §3 errata: el `groupIds` ya viene filtrado por tipo desde el Core en
    // el caso general, pero la UI no vuelve a filtrar — nombra lo que le
    // dieron, en el orden que le dieron).
    expect(resolveAddedGroup(byType, ["o1"], EntityType.Custom)?.id).toBe("o1");
  });

  it("un id que ya no está en el store se ignora, sin romper", () => {
    expect(resolveAddedGroup(byType, ["desaparecido", "p6"], EntityType.Person)?.id).toBe("p6");
  });

  it("groupIds vacío: undefined", () => {
    expect(resolveAddedGroup(byType, [], EntityType.Person)).toBeUndefined();
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
