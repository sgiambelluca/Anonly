/**
 * `manualOverlapWarning.ts` (ADR-175 §5, `Components.md` §6.3) — la regla de
 * cuándo se muestra el aviso persistente, pura y separada del `.tsx`
 * (ADR-056).
 */

import {
  ConflictReason,
  DetectionSource,
  EntityType,
  ReplacementMode,
  type Conflict,
  type ConflictCandidate,
  type EntityGroup,
} from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import {
  firstPendingManualOverlapGroupId,
  manualOverlapWarningValue,
  pendingManualOverlapConflicts,
  resolveManualOverlapWarning,
  shouldShowManualOverlapWarning,
} from "../components/conflicts/manualOverlapWarning.js";

function group(overrides: Partial<EntityGroup> = {}): EntityGroup {
  return {
    id: "g1",
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
      mask: "x",
      synthetic: "y",
      placeholderLadder: ["[PERSONA 01]"],
    },
    needsReview: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function candidate(overrides: Partial<ConflictCandidate> = {}): ConflictCandidate {
  return {
    source: DetectionSource.Manual,
    entityType: EntityType.Person,
    confidence: 1,
    value: "Juan Pérez",
    ...overrides,
  };
}

function held(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "conflict-1",
    groupId: "g1",
    reason: ConflictReason.Overlap,
    candidates: [candidate(), candidate({ source: DetectionSource.Regex, value: "Juan Pérez." })],
    resolved: false,
    heldManual: true,
    ...overrides,
  };
}

describe("pendingManualOverlapConflicts", () => {
  it("solo los heldManual sin resolver", () => {
    const resolved = held({ id: "c1", resolved: true });
    const { heldManual: _dropped, ...notHeldBase } = held({ id: "c2" });
    const notHeld: Conflict = notHeldBase;
    const pending = held({ id: "c3" });
    expect(pendingManualOverlapConflicts([resolved, notHeld, pending])).toEqual([pending]);
  });
});

describe("shouldShowManualOverlapWarning (ADR-175 §5)", () => {
  it("true con un pendiente y el diálogo cerrado", () => {
    expect(shouldShowManualOverlapWarning({ conflicts: [held()], dialogOpen: false })).toBe(true);
  });

  it("false con el diálogo abierto, aunque haya pendientes", () => {
    expect(shouldShowManualOverlapWarning({ conflicts: [held()], dialogOpen: true })).toBe(false);
  });

  it("false sin nada pendiente", () => {
    expect(shouldShowManualOverlapWarning({ conflicts: [], dialogOpen: false })).toBe(false);
  });
});

describe("firstPendingManualOverlapGroupId (ADR-175 §5)", () => {
  it("la primera fila, en el orden del árbol, con un pendiente", () => {
    const groupsByType = new Map([
      [
        EntityType.Person,
        [group({ id: "p1", indexInType: 1 }), group({ id: "p2", indexInType: 2 })],
      ],
      [EntityType.DNI, [group({ id: "d1", type: EntityType.DNI, indexInType: 1 })]],
    ]);
    // El pendiente está en "d1" (DNI), que en el árbol va DESPUÉS de Person
    // (`ENTITY_TYPE_ORDER`) — confirma que usa el orden real, no el de
    // inserción de `conflicts`.
    const conflicts = [held({ groupId: "d1" })];
    expect(
      firstPendingManualOverlapGroupId({ groupsByType, sortOrder: "appearance", conflicts }),
    ).toBe("d1");
  });

  it("null sin ningún pendiente", () => {
    const groupsByType = new Map([[EntityType.Person, [group()]]]);
    expect(
      firstPendingManualOverlapGroupId({ groupsByType, sortOrder: "appearance", conflicts: [] }),
    ).toBeNull();
  });

  it("null si el pendiente apunta a un grupo que ya no está en groupsByType", () => {
    const groupsByType = new Map([[EntityType.Person, [group({ id: "otro" })]]]);
    const conflicts = [held({ groupId: "g1" })];
    expect(
      firstPendingManualOverlapGroupId({ groupsByType, sortOrder: "appearance", conflicts }),
    ).toBeNull();
  });
});

describe("manualOverlapWarningValue", () => {
  it("el valor manual del primer choque pendiente de esa fila", () => {
    const conflicts = [held({ groupId: "g1" })];
    expect(manualOverlapWarningValue(conflicts, "g1")).toBe("Juan Pérez");
  });

  it("null sin un choque pendiente en esa fila", () => {
    expect(manualOverlapWarningValue([], "g1")).toBeNull();
  });
});

describe("resolveManualOverlapWarning (todo junto)", () => {
  it("arma el valor y los conflictIds de la primera fila pendiente", () => {
    const groupsByType = new Map([[EntityType.Person, [group({ id: "g1" })]]]);
    const conflicts = [held({ id: "c1", groupId: "g1" }), held({ id: "c2", groupId: "g1" })];

    const warning = resolveManualOverlapWarning({
      conflicts,
      groupsByType,
      sortOrder: "appearance",
      dialogOpen: false,
    });

    expect(warning).toEqual({ value: "Juan Pérez", conflictIds: ["c1", "c2"] });
  });

  it("null con el diálogo abierto", () => {
    const groupsByType = new Map([[EntityType.Person, [group({ id: "g1" })]]]);
    const warning = resolveManualOverlapWarning({
      conflicts: [held()],
      groupsByType,
      sortOrder: "appearance",
      dialogOpen: true,
    });
    expect(warning).toBeNull();
  });

  it("null sin nada pendiente", () => {
    const warning = resolveManualOverlapWarning({
      conflicts: [],
      groupsByType: new Map(),
      sortOrder: "appearance",
      dialogOpen: false,
    });
    expect(warning).toBeNull();
  });
});
