import {
  EntityType,
  PipelineStage,
  ReplacementMode,
  type EntityGroup,
  type Rule,
} from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import {
  isIndexInTypeVisible,
  sortGroups,
  summarizeEntities,
  visibleTypeEntries,
} from "../components/entities/entityTree.js";
import { hexToRgbChannels, typeBandTint } from "../components/entities/entityTypeColors.js";
import {
  describeEntityNumber,
  ENTITY_TYPE_ORDER,
  ENTITY_TYPE_SINGULAR,
  formatIndexInType,
} from "../components/entities/entityTypeLabels.js";
import {
  countEntitiesWithOwnMode,
  describeDocumentBandNote,
} from "../components/entities/modeLevels.js";
import { useEntitiesStore } from "../store/entities.store.js";

// ADR-169 §2/§5: la lista de entidades como tabla, su orden y la franja.

function makeGroup(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "g",
    type: EntityType.Person,
    canonicalValue: "Juan Pérez",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[PERSONA 01]",
    indexInType: 1,
    enabled: true,
    aliases: [],
    replacementValueUserSet: false,
    replacementPreviews: {
      placeholder: "[PERSONA 01]",
      mask: "XXXX XXXXX",
      synthetic: "Pedro Gómez",
      placeholderLadder: ["[PERSONA 01]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: "r",
    scope: "group",
    target: { kind: "group" },
    mode: ReplacementMode.Mask,
    priority: 100,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("sortGroups (Aparición | A–Z)", () => {
  const groups = [
    makeGroup({ id: "a", canonicalValue: "Zulema", indexInType: 1 }),
    makeGroup({ id: "b", canonicalValue: "Álvarez", indexInType: 3 }),
    makeGroup({ id: "c", canonicalValue: "Mario", indexInType: 2 }),
  ];

  it("Aparición: indexInType ascendente", () => {
    expect(sortGroups(groups, "appearance").map((g) => g.id)).toEqual(["a", "c", "b"]);
  });

  it("A–Z: localeCompare en español (Álvarez va con las A)", () => {
    expect(sortGroups(groups, "alpha").map((g) => g.canonicalValue)).toEqual([
      "Álvarez",
      "Mario",
      "Zulema",
    ]);
  });

  it("no toca indexInType ni el array de entrada", () => {
    const before = groups.map((g) => g.id);
    sortGroups(groups, "alpha");
    expect(groups.map((g) => g.id)).toEqual(before);
    expect(groups.map((g) => g.indexInType)).toEqual([1, 3, 2]);
  });

  it("visibleTypeEntries aplica el orden elegido a todos los tipos", () => {
    const map = new Map([[EntityType.Person, groups]]);
    const [entry] = visibleTypeEntries(map, "alpha");
    expect(entry?.[1][0]?.canonicalValue).toBe("Álvarez");
  });
});

describe("N.º de la lista", () => {
  it("dos dígitos, el mismo número del token", () => {
    expect(formatIndexInType(4)).toBe("04");
    expect(formatIndexInType(12)).toBe("12");
    expect(formatIndexInType(123)).toBe("123");
  });

  it("describeEntityNumber: 'Persona N.º 06'", () => {
    expect(describeEntityNumber(EntityType.Person, 6)).toBe("Persona N.º 06");
    expect(describeEntityNumber(EntityType.Organization, 3)).toBe("Organización N.º 03");
  });

  it("no se muestra hasta Ready (ADR-087 §6.1), ni durante un re-análisis", () => {
    for (const stage of [
      PipelineStage.Idle,
      PipelineStage.Importing,
      PipelineStage.OCRing,
      PipelineStage.Detecting,
      PipelineStage.Grouping,
      PipelineStage.Failed,
    ]) {
      expect(isIndexInTypeVisible(stage)).toBe(false);
    }
    for (const stage of [PipelineStage.Ready, PipelineStage.Exporting, PipelineStage.Done]) {
      expect(isIndexInTypeVisible(stage)).toBe(true);
    }
  });

  it("los 13 tipos tienen nombre en singular", () => {
    expect(ENTITY_TYPE_ORDER).toHaveLength(13);
    for (const type of ENTITY_TYPE_ORDER) {
      expect(ENTITY_TYPE_SINGULAR[type].length).toBeGreaterThan(0);
    }
  });
});

describe("summarizeEntities", () => {
  it("cuenta entidades y tipos, con singular", () => {
    expect(
      summarizeEntities([
        [EntityType.Person, [makeGroup(), makeGroup({ id: "2" })]],
        [EntityType.DNI, [makeGroup({ id: "3" })]],
      ]),
    ).toBe("3 entidades en 2 tipos");
    expect(summarizeEntities([[EntityType.DNI, [makeGroup()]]])).toBe("1 entidad en 1 tipo");
  });
});

describe("franja de tipo (color al 6 % / 7 %)", () => {
  it("hexToRgbChannels", () => {
    expect(hexToRgbChannels("#10b981")).toBe("16 185 129");
  });

  it("la opacidad la pone el tema (--anonly-band-tint)", () => {
    const tint = typeBandTint(EntityType.Person);
    expect(tint).toContain("rgb(16 185 129 / var(--anonly-band-tint))");
    expect(tint.startsWith("linear-gradient(")).toBe(true);
  });
});

describe("franja 'Todo el documento' (ADR-169 §5)", () => {
  const groups = [
    { id: "p1", type: EntityType.Person },
    { id: "p2", type: EntityType.Person },
    { id: "d1", type: EntityType.DNI },
  ];

  it("sin reglas de tipo ni de grupo: nadie tiene modo propio", () => {
    expect(countEntitiesWithOwnMode([], groups)).toBe(0);
    expect(
      countEntitiesWithOwnMode([rule({ scope: "global", target: { kind: "global" } })], groups),
    ).toBe(0);
  });

  it("cuenta las filas de un tipo con regla y las de grupo, sin repetir", () => {
    const rules = [
      rule({ id: "t", scope: "type", target: { kind: "type", entityType: EntityType.Person } }),
      rule({ id: "g1", scope: "group", target: { kind: "group", groupId: "p1" } }),
      rule({ id: "g2", scope: "group", target: { kind: "group", groupId: "d1" } }),
    ];
    expect(countEntitiesWithOwnMode(rules, groups)).toBe(3);
  });

  it("la segunda línea existe siempre y solo cambia su texto", () => {
    expect(describeDocumentBandNote(0)).toBe("Se aplica a todas las entidades.");
    expect(describeDocumentBandNote(1)).toBe(
      "1 entidad tiene modo propio: cambiar este modo la pisa.",
    );
    expect(describeDocumentBandNote(12)).toBe(
      "12 entidades tienen modo propio: cambiar este modo las pisa.",
    );
  });
});

describe("entities.store: orden y 'Ver en la lista'", () => {
  beforeEach(() => {
    useEntitiesStore.setState({ sortOrder: "appearance", flashGroupId: null });
    useEntitiesStore.getState().reset();
  });

  it("arranca en Aparición y sin resaltado", () => {
    expect(useEntitiesStore.getState().sortOrder).toBe("appearance");
    expect(useEntitiesStore.getState().flashGroupId).toBeNull();
  });

  it("reset (cerrar el documento) conserva el orden pero no el resaltado", () => {
    useEntitiesStore.getState().setSortOrder("alpha");
    useEntitiesStore.getState().setFlashGroupId("g1");
    useEntitiesStore.getState().reset();
    expect(useEntitiesStore.getState().sortOrder).toBe("alpha");
    expect(useEntitiesStore.getState().flashGroupId).toBeNull();
  });
});
