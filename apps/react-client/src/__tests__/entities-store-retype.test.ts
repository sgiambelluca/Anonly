/**
 * `entities.store.updateGroup` frente a un cambio de tipo (ADR-082).
 *
 * Regresión de un bug encontrado en prueba manual: el grupo se reclasificaba
 * bien en el motor y **la UI lo seguía mostrando en la categoría vieja**.
 * `updateGroup` resolvía el bucket con `findGroupType(state, group.id)` —o
 * sea, dónde el grupo ESTABA— y reemplazaba ahí, así que un grupo que cambió
 * de tipo se reescribía en su bucket anterior y no se movía nunca.
 *
 * Los 1471 tests de la suite pasaban con el bug vivo: los de `actions` solo
 * verifican que el evento se emita, y ninguno ejercitaba el store con un
 * grupo que cambia de `type`.
 */

import { EntityType, ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import { useEntitiesStore } from "../store/entities.store.js";

function makeGroup(overrides?: Partial<EntityGroup>): EntityGroup {
  return {
    id: "g-1",
    type: EntityType.Organization,
    canonicalValue: "Empresa S.A.",
    members: [],
    replacementMode: ReplacementMode.Placeholder,
    replacementValue: "[ORGANIZACION 01]",
    indexInType: 1,
    enabled: true,
    aliases: ["Empresa S.A."],
    replacementValueUserSet: false,
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function typeOf(groupId: string): EntityType | undefined {
  for (const [type, groups] of useEntitiesStore.getState().groupsByType) {
    if (groups.some((g) => g.id === groupId)) return type;
  }
  return undefined;
}

describe("entities.store.updateGroup con cambio de tipo (ADR-082)", () => {
  beforeEach(() => {
    useEntitiesStore.getState().reset();
  });

  it("mueve el grupo al bucket del tipo nuevo y lo saca del viejo", () => {
    const store = useEntitiesStore.getState();
    store.addGroup(makeGroup());
    expect(typeOf("g-1")).toBe(EntityType.Organization);

    store.updateGroup(makeGroup({ type: EntityType.Address, replacementValue: "[DIRECCION 01]" }));

    expect(typeOf("g-1")).toBe(EntityType.Address);
    const orgBucket = useEntitiesStore.getState().groupsByType.get(EntityType.Organization) ?? [];
    expect(orgBucket.some((g) => g.id === "g-1")).toBe(false);
  });

  it("no duplica el grupo si llega dos veces con el tipo nuevo", () => {
    const store = useEntitiesStore.getState();
    store.addGroup(makeGroup());
    const retyped = makeGroup({ type: EntityType.Address });

    store.updateGroup(retyped);
    store.updateGroup(retyped);

    const addressBucket = useEntitiesStore.getState().groupsByType.get(EntityType.Address) ?? [];
    expect(addressBucket.filter((g) => g.id === "g-1")).toHaveLength(1);
  });

  it("una actualización sin cambio de tipo sigue reemplazando en su bucket", () => {
    const store = useEntitiesStore.getState();
    store.addGroup(makeGroup());

    store.updateGroup(makeGroup({ enabled: false }));

    expect(typeOf("g-1")).toBe(EntityType.Organization);
    const bucket = useEntitiesStore.getState().groupsByType.get(EntityType.Organization) ?? [];
    expect(bucket).toHaveLength(1);
    expect(bucket[0]?.enabled).toBe(false);
  });
});
