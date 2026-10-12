import { describe, expect, it } from "vitest";

import { formatIncompleteDiagnostic } from "./validateSampleSummaryDiagnostic.js";

describe("M-V1 incomplete summary diagnostic", () => {
  it("preserves safe partial counts and outcomes without publishing measurements", () => {
    const text = formatIncompleteDiagnostic("Error", "format-tables", {
      expectedRuns: 36,
      recordedRuns: 1,
      missingRuns: 35,
      failedRuns: [{ id: "R1-low-r1", stage: "export", kind: "product" }],
      issues: ["group-conflict-pending"],
    });
    expect(text).toContain("Esperadas 36; registradas 1; faltantes 35; fallidas 1");
    expect(text).toContain("R1-low-r1, export, product");
    expect(text).toContain("INCOMPLETA");
    expect(text).not.toMatch(/Ready|OCR s|MB|bytes/i);
  });

  it("states when no safe partial diagnostic was captured", () => {
    expect(formatIncompleteDiagnostic("TypeError", "load-run-records", null)).toContain(
      "No había un diagnóstico seguro completo antes del fallo.",
    );
  });
});
