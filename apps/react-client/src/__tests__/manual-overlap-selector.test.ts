/**
 * Selector de `ManualOverlapDialog`.
 *
 * `apps/react-client` no tiene librería de DOM para tests (R-12), así que el
 * diálogo no se monta acá: el selector se prueba como función pura. Zustand 5
 * compara con `Object.is`; un selector que devuelve un array nuevo en cada
 * llamada necesita `useShallow`, que descansa en `shallow`. Lo que se garantiza
 * es que el resultado sea estable bajo esa comparación mientras los conflictos
 * observados no cambian. El montaje real lo cubre el E2E de choques.
 */

import { ConflictReason, type Conflict } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";
import { shallow } from "zustand/vanilla/shallow";

import { conflictsByIds } from "../components/conflicts/conflictResolution.js";

function makeConflict(id: string, overrides: Partial<Conflict> = {}): Conflict {
  return {
    id,
    groupId: "g-1",
    reason: ConflictReason.Overlap,
    candidates: [],
    resolved: false,
    heldManual: true,
    ...overrides,
  };
}

describe("conflictsByIds (selector de ManualOverlapDialog)", () => {
  it("returns the requested conflicts in the order of the ids and skips missing ones", () => {
    const conflicts = [makeConflict("a"), makeConflict("b"), makeConflict("c")];

    expect(conflictsByIds(conflicts, ["c", "zzz", "a"]).map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("is stable under shallow comparison for the same state (what useShallow relies on)", () => {
    const conflicts = [makeConflict("a"), makeConflict("b")];

    const first = conflictsByIds(conflicts, ["a", "b"]);
    const second = conflictsByIds(conflicts, ["a", "b"]);

    expect(first).not.toBe(second);
    expect(shallow(first, second)).toBe(true);
  });

  it("stays shallow-equal when an unrelated conflict is added, and changes when a watched one does", () => {
    const watched = makeConflict("a");
    const before = conflictsByIds([watched, makeConflict("b")], ["a"]);

    const unrelatedAdded = conflictsByIds([watched, makeConflict("b"), makeConflict("c")], ["a"]);
    expect(shallow(before, unrelatedAdded)).toBe(true);

    const resolved = conflictsByIds([{ ...watched, resolved: true }, makeConflict("b")], ["a"]);
    expect(shallow(before, resolved)).toBe(false);
  });
});
