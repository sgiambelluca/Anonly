/**
 * `exportBlockReason.ts` (ADR-176 §1, `ui/Components.md` §2.5,
 * `ui/UX_Guidelines.md` §8.1/§8.4) — la regla pura del bloqueo de
 * `ExportButton`.
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
  exportBlockReason,
  firstPendingConflictId,
} from "../components/toolbar/exportBlockReason.js";

function candidate(overrides: Partial<ConflictCandidate> = {}): ConflictCandidate {
  return {
    source: DetectionSource.Regex,
    entityType: EntityType.DNI,
    confidence: 1,
    value: "X",
    ...overrides,
  };
}

function conflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    id: "conflict-1",
    groupId: "g1",
    reason: ConflictReason.Overlap,
    candidates: [candidate(), candidate({ source: DetectionSource.NER })],
    resolved: false,
    ...overrides,
  };
}

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

describe("exportBlockReason (ADR-176 §1)", () => {
  it("null sin conflictos", () => {
    expect(exportBlockReason([])).toBeNull();
  });

  it("null si todos los conflictos están resueltos", () => {
    expect(exportBlockReason([conflict({ resolved: true })])).toBeNull();
  });

  it("con un heldManual sin resolver: el motivo del choque", () => {
    expect(exportBlockReason([conflict({ heldManual: true, resolved: false })])).toBe(
      "Hay un choque sin resolver. Resolvelo para exportar.",
    );
  });

  it("con un pendiente que NO es heldManual: el motivo genérico", () => {
    expect(exportBlockReason([conflict({ resolved: false })])).toBe(
      "Hay un conflicto sin resolver.",
    );
  });

  it("con varios pendientes, alcanza con que UNO sea heldManual para el motivo del choque", () => {
    const conflicts = [
      conflict({ id: "c1", resolved: false }),
      conflict({ id: "c2", heldManual: true, resolved: false }),
    ];
    expect(exportBlockReason(conflicts)).toBe(
      "Hay un choque sin resolver. Resolvelo para exportar.",
    );
  });
});

describe("firstPendingConflictId (ADR-176 §1, ConflictDialog para lo no heldManual)", () => {
  it("el primer conflicto no-heldManual pendiente, en el orden del árbol", () => {
    const groupsByType = new Map([
      [
        EntityType.Person,
        [group({ id: "p1", indexInType: 1 }), group({ id: "p2", indexInType: 2 })],
      ],
      [EntityType.DNI, [group({ id: "d1", type: EntityType.DNI, indexInType: 1 })]],
    ]);
    // Pendiente en "d1", que en el árbol va después de Person.
    const conflicts = [conflict({ id: "c1", groupId: "d1", resolved: false })];
    expect(firstPendingConflictId({ conflicts, groupsByType, sortOrder: "appearance" })).toBe("c1");
  });

  it("ignora los heldManual (esos van por ManualOverlapDialog, no acá)", () => {
    const groupsByType = new Map([[EntityType.Person, [group({ id: "p1" })]]]);
    const conflicts = [conflict({ id: "c1", groupId: "p1", heldManual: true, resolved: false })];
    expect(firstPendingConflictId({ conflicts, groupsByType, sortOrder: "appearance" })).toBeNull();
  });

  it("ignora los resueltos", () => {
    const groupsByType = new Map([[EntityType.Person, [group({ id: "p1" })]]]);
    const conflicts = [conflict({ id: "c1", groupId: "p1", resolved: true })];
    expect(firstPendingConflictId({ conflicts, groupsByType, sortOrder: "appearance" })).toBeNull();
  });

  it("null si el conflicto apunta a un grupo que ya no está en groupsByType", () => {
    const groupsByType = new Map([[EntityType.Person, [group({ id: "otro" })]]]);
    const conflicts = [conflict({ id: "c1", groupId: "g1", resolved: false })];
    expect(firstPendingConflictId({ conflicts, groupsByType, sortOrder: "appearance" })).toBeNull();
  });

  it("null sin nada pendiente", () => {
    expect(
      firstPendingConflictId({ conflicts: [], groupsByType: new Map(), sortOrder: "appearance" }),
    ).toBeNull();
  });
});
