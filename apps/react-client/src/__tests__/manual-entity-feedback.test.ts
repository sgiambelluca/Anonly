import type { ManualEntityResult } from "@anonly/anonymization-core";
import { describe, expect, it } from "vitest";

import { manualEntityFeedback } from "../components/entities/manualEntityFeedback.js";

function result(overrides: Partial<ManualEntityResult> = {}): ManualEntityResult {
  return { occurrenceCount: 0, heldConflictIds: [], groupIds: [], ...overrides };
}

describe("manualEntityFeedback (ADR-175 §3)", () => {
  it("returns 'no-op' for null (no active document)", () => {
    expect(manualEntityFeedback(null)).toBe("no-op");
  });

  it("returns 'not-found' when occurrenceCount is 0 and there's nothing else (ADR-061 §6 errata)", () => {
    expect(manualEntityFeedback(result({ occurrenceCount: 0 }))).toBe("not-found");
  });

  it("returns 'added' when groupIds is not empty", () => {
    expect(manualEntityFeedback(result({ occurrenceCount: 1, groupIds: ["g1"] }))).toBe("added");
    expect(manualEntityFeedback(result({ occurrenceCount: 5, groupIds: ["g1", "g2"] }))).toBe(
      "added",
    );
  });

  // ADR-175 §3: el caso que rompe el invariante del Core
  // (`occurrenceCount > 0` ⇒ `heldConflictIds` o `groupIds` no vacío).
  it("returns 'error' when occurrenceCount is greater than 0 but neither heldConflictIds nor groupIds has anything", () => {
    expect(manualEntityFeedback(result({ occurrenceCount: 3 }))).toBe("error");
  });

  // ADR-174 §4 / ADR-175 §3: un choque sin resolver manda por sobre
  // cualquier otra lectura del resultado, incluso si además se formó un
  // grupo con otras apariciones del mismo valor.
  it("returns 'held' when heldConflictIds is not empty, regardless of occurrenceCount or groupIds", () => {
    expect(manualEntityFeedback(result({ occurrenceCount: 0, heldConflictIds: ["c1"] }))).toBe(
      "held",
    );
    expect(
      manualEntityFeedback(
        result({ occurrenceCount: 2, heldConflictIds: ["c1"], groupIds: ["g1"] }),
      ),
    ).toBe("held");
  });
});
