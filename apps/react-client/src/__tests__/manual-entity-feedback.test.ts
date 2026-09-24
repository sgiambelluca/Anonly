import { describe, expect, it } from "vitest";

import { manualEntityFeedback } from "../components/entities/manualEntityFeedback.js";

describe("manualEntityFeedback", () => {
  it("returns 'no-op' for null (no active document)", () => {
    expect(manualEntityFeedback(null, false)).toBe("no-op");
    expect(manualEntityFeedback(null, true)).toBe("no-op");
  });

  it("returns 'not-found' when occurrenceCount is 0 (ADR-061 §6 errata)", () => {
    expect(manualEntityFeedback({ occurrenceCount: 0, heldConflictIds: [] }, false)).toBe(
      "not-found",
    );
  });

  it("returns 'added' when occurrenceCount is greater than 0 and the value landed in a group", () => {
    expect(manualEntityFeedback({ occurrenceCount: 1, heldConflictIds: [] }, true)).toBe("added");
    expect(manualEntityFeedback({ occurrenceCount: 5, heldConflictIds: [] }, true)).toBe("added");
  });

  // ADR-174 §4 / Components.md §3.4c: occurrenceCount > 0 solo no alcanza —
  // lo cuenta el Core antes de agrupar. Sin un grupo real con el valor, no
  // hay nada que el toast de éxito pueda afirmar.
  it("returns 'not-found' when occurrenceCount is greater than 0 but no group ended up with the value", () => {
    expect(manualEntityFeedback({ occurrenceCount: 3, heldConflictIds: [] }, false)).toBe(
      "not-found",
    );
  });

  // ADR-174 §4: un choque sin resolver manda por sobre cualquier otra
  // lectura del resultado, incluso si además se formó un grupo con otras
  // apariciones del mismo valor.
  it("returns 'held' when heldConflictIds is not empty, regardless of occurrenceCount or groupFound", () => {
    expect(
      manualEntityFeedback({ occurrenceCount: 0, heldConflictIds: ["conflict-1"] }, false),
    ).toBe("held");
    expect(
      manualEntityFeedback({ occurrenceCount: 2, heldConflictIds: ["conflict-1"] }, true),
    ).toBe("held");
  });
});
