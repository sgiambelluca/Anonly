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
  advanceConflictWalk,
  conflictWalkProgress,
  currentConflictId,
  startConflictWalk,
} from "../components/conflicts/conflictWalk.js";
import {
  exportBlockReason,
  firstPendingConflictId,
  pendingConflictIdsInTreeOrder,
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

describe("pendingConflictIdsInTreeOrder (la cola de «Resolver»)", () => {
  const groupsByType = new Map([
    [EntityType.Person, [group({ id: "p1", indexInType: 1 }), group({ id: "p2", indexInType: 2 })]],
    [EntityType.DNI, [group({ id: "d1", type: EntityType.DNI, indexInType: 1 })]],
  ]);

  it("todos los pendientes, en el orden del árbol y no en el de llegada", () => {
    const conflicts = [
      conflict({ id: "c-d1", groupId: "d1" }),
      conflict({ id: "c-p2", groupId: "p2" }),
      conflict({ id: "c-p1", groupId: "p1" }),
    ];
    const ids = pendingConflictIdsInTreeOrder({ conflicts, groupsByType, sortOrder: "appearance" });
    expect([...ids].sort()).toEqual(["c-d1", "c-p1", "c-p2"]);
    expect(ids.indexOf("c-p1")).toBeLessThan(ids.indexOf("c-p2"));
    expect(ids[0]).toBe(
      firstPendingConflictId({ conflicts, groupsByType, sortOrder: "appearance" }),
    );
  });

  it("dos conflictos de la misma fila entran los dos, en el orden en que llegaron", () => {
    const conflicts = [
      conflict({ id: "segundo", groupId: "p2" }),
      conflict({ id: "a", groupId: "p1" }),
      conflict({ id: "b", groupId: "p1" }),
    ];
    expect(
      pendingConflictIdsInTreeOrder({ conflicts, groupsByType, sortOrder: "appearance" }),
    ).toEqual(["a", "b", "segundo"]);
  });

  it("deja afuera los resueltos, los heldManual y los de un grupo que ya no está", () => {
    const conflicts = [
      conflict({ id: "resuelto", groupId: "p1", resolved: true }),
      conflict({ id: "choque", groupId: "p1", heldManual: true }),
      conflict({ id: "huerfano", groupId: "no-existe" }),
      conflict({ id: "queda", groupId: "p2" }),
    ];
    expect(
      pendingConflictIdsInTreeOrder({ conflicts, groupsByType, sortOrder: "appearance" }),
    ).toEqual(["queda"]);
  });
});

describe("conflictWalk (recorrer los conflictos sin volver al globo)", () => {
  const pending = (ids: ReadonlyArray<string>): Conflict[] =>
    ids.map((id) => conflict({ id, groupId: `g-${id}` }));

  it("sin pendientes no hay recorrido", () => {
    expect(startConflictWalk([])).toBeNull();
  });

  it("arranca en el primero y muestra la posición sobre el total", () => {
    const walk = startConflictWalk(["a", "b", "c"]);
    expect(walk).not.toBeNull();
    if (walk === null) return;
    expect(currentConflictId(walk)).toBe("a");
    expect(conflictWalkProgress(walk)).toBe("1/3");
  });

  it("al aplicar pasa al siguiente, y el total no cambia", () => {
    const first = startConflictWalk(["a", "b", "c"]);
    if (first === null) throw new Error("sin recorrido");
    // El store todavía no refleja que "a" se resolvió: no importa, queda atrás.
    const second = advanceConflictWalk(first, pending(["a", "b", "c"]));
    expect(second).not.toBeNull();
    if (second === null) return;
    expect(currentConflictId(second)).toBe("b");
    expect(conflictWalkProgress(second)).toBe("2/3");
  });

  it("saltea los que dejaron de estar pendientes mientras tanto", () => {
    const first = startConflictWalk(["a", "b", "c", "d"]);
    if (first === null) throw new Error("sin recorrido");
    const conflicts = [
      conflict({ id: "b", groupId: "g-b", resolved: true }),
      conflict({ id: "c", groupId: "g-c", heldManual: true }),
      conflict({ id: "d", groupId: "g-d" }),
    ];
    const next = advanceConflictWalk(first, conflicts);
    expect(next).not.toBeNull();
    if (next === null) return;
    expect(currentConflictId(next)).toBe("d");
    expect(conflictWalkProgress(next)).toBe("4/4");
  });

  it("después del último, el recorrido termina", () => {
    const first = startConflictWalk(["a", "b"]);
    if (first === null) throw new Error("sin recorrido");
    const second = advanceConflictWalk(first, pending(["a", "b"]));
    if (second === null) throw new Error("tenía que seguir");
    expect(advanceConflictWalk(second, pending(["a", "b"]))).toBeNull();
  });

  it("termina si lo que quedaba ya no está pendiente", () => {
    const first = startConflictWalk(["a", "b"]);
    if (first === null) throw new Error("sin recorrido");
    expect(advanceConflictWalk(first, [])).toBeNull();
  });

  it("nunca vuelve atrás, aunque uno anterior siga pendiente", () => {
    const first = startConflictWalk(["a", "b"]);
    if (first === null) throw new Error("sin recorrido");
    const second = advanceConflictWalk(first, pending(["a", "b"]));
    if (second === null) throw new Error("tenía que seguir");
    expect(advanceConflictWalk(second, pending(["a"]))).toBeNull();
  });
});
