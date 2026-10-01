/**
 * `entities.store` frente a conflictos (ADR-191 §3, React_Client.md §2.2 regla 1).
 *
 * `CONFLICT_DETECTED` es idempotente por `id`: Grouping lo reemite con el mismo
 * `id` al restaurar un checkpoint. El store tiene que reemplazar, no agregar, y
 * un conflicto resuelto no puede conservar `heldManual` (ADR-175 §1).
 */

import { ConflictReason, EntityType, type Conflict } from "@anonly/anonymization-core";
import { beforeEach, describe, expect, it } from "vitest";

import { useEntitiesStore } from "../store/entities.store.js";

function makeConflict(overrides?: Partial<Conflict>): Conflict {
  return {
    id: "c-1",
    groupId: "g-1",
    reason: ConflictReason.Overlap,
    candidates: [],
    resolved: false,
    heldManual: true,
    ...overrides,
  };
}

describe("entities.store — conflictos", () => {
  beforeEach(() => {
    useEntitiesStore.getState().reset();
  });

  it("addConflict replaces a conflict with the same id instead of duplicating it", () => {
    const { addConflict } = useEntitiesStore.getState();
    addConflict(makeConflict({ resolved: true, resolvedType: EntityType.IBAN }));

    // Restaurar el checkpoint previo reemite el conflicto, ahora pendiente y en otro grupo.
    addConflict(makeConflict({ groupId: "g-restored" }));
    addConflict(makeConflict({ groupId: "g-restored" }));

    const { conflicts } = useEntitiesStore.getState();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ id: "c-1", groupId: "g-restored", resolved: false });
    expect(conflicts[0]?.resolvedType).toBeUndefined();
  });

  it("addConflict keeps distinct ids side by side and preserves their order", () => {
    const { addConflict } = useEntitiesStore.getState();
    addConflict(makeConflict({ id: "c-1" }));
    addConflict(makeConflict({ id: "c-2" }));
    addConflict(makeConflict({ id: "c-1", groupId: "g-2" }));

    expect(useEntitiesStore.getState().conflicts.map((c) => [c.id, c.groupId])).toEqual([
      ["c-1", "g-2"],
      ["c-2", "g-1"],
    ]);
  });

  it("resolveConflict drops heldManual so no resolved conflict keeps it (ADR-175 §1)", () => {
    const { addConflict, resolveConflict } = useEntitiesStore.getState();
    addConflict(makeConflict());

    resolveConflict("c-1", EntityType.IBAN);

    const [resolved] = useEntitiesStore.getState().conflicts;
    expect(resolved).toMatchObject({ resolved: true, resolvedType: EntityType.IBAN });
    expect(resolved).not.toHaveProperty("heldManual");
  });
});
