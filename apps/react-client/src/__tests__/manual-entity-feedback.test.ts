import { describe, expect, it } from "vitest";

import { manualEntityFeedback } from "../components/entities/manualEntityFeedback.js";

describe("manualEntityFeedback", () => {
  it("returns 'not-found' when occurrenceCount is 0 (ADR-061 §6 errata)", () => {
    expect(manualEntityFeedback({ occurrenceCount: 0 })).toBe("not-found");
  });

  it("returns 'added' when occurrenceCount is greater than 0", () => {
    expect(manualEntityFeedback({ occurrenceCount: 1 })).toBe("added");
    expect(manualEntityFeedback({ occurrenceCount: 5 })).toBe("added");
  });

  it("returns 'no-op' for null (no active document)", () => {
    expect(manualEntityFeedback(null)).toBe("no-op");
  });
});
