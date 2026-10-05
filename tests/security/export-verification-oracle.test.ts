import { describe, expect, it } from "vitest";

import {
  findForbiddenNumericFragments,
  normalizePhrase,
  numericCandidates,
  verifyExport,
  type ExportVerificationFixture,
} from "../e2e/support/exportVerificationOracle.js";

function fixture(
  sourceLines: ReadonlyArray<string>,
  outputLines: ReadonlyArray<string>,
  overrides: Partial<ExportVerificationFixture> = {},
): ExportVerificationFixture {
  const page = (lines: ReadonlyArray<string>) => ({ widthPt: 595, heightPt: 842, lines });
  return {
    id: "native",
    expectedPageCount: 1,
    source: { pages: [page(sourceLines)] },
    output: { pages: [page(outputLines)] },
    neighborsByPage: [["INICIO PUBLICO", "CIERRE PUBLICO"]],
    sourceIdentifiersByPage: [["34567891"]],
    forbiddenIdentifiers: ["34567891"],
    ...overrides,
  };
}

describe("independent export OCR oracle", () => {
  it("normalizes diacritics, case, and whitespace without edit distance", () => {
    expect(normalizePhrase("  RegIÓN   Pública ")).toBe("REGION PUBLICA");
  });

  it("joins permitted separators only within an OCR line", () => {
    const candidates = numericCandidates(["DNI 34.567.891", "otra línea 62-938-475"]);
    expect(candidates.some((candidate) => candidate.includes("34567891"))).toBe(true);
    expect(candidates).toContain("62938475");
    expect(numericCandidates(["3456", "7891"])).not.toContain("34567891");
  });

  it("detects identifiers glued to labels and adjacent text without converting phrases", () => {
    const gluedCandidates = numericCandidates(["DNI34567891", "DNI 34567891PUBLICO"]);
    expect(gluedCandidates.some((candidate) => candidate.includes("34567891"))).toBe(true);
    expect(
      findForbiddenNumericFragments(["DNI34567891", "DNI 34567891PUBLICO"], ["34567891"]),
    ).toEqual(expect.arrayContaining(["34567891", "3456", "7891"]));
    const fragmentCandidates = numericCandidates(["reemplazo3456PUBLICO", "texto7891fin"]);
    expect(fragmentCandidates.some((candidate) => candidate.includes("3456"))).toBe(true);
    expect(fragmentCandidates.some((candidate) => candidate.includes("7891"))).toBe(true);
    expect(numericCandidates(["INICIO PUBLICO", "SENSIBILIDAD"])).toEqual([]);
  });

  it("maps numeric confusables only inside numeric candidates", () => {
    expect(
      numericCandidates(["DNI 34.56B.89I", "INICIO PUBLICO"]).some((candidate) =>
        candidate.includes("34568891"),
      ),
    ).toBe(true);
  });

  it("rejects full identifiers and their four digit prefixes and suffixes", () => {
    expect(findForbiddenNumericFragments(["texto 34 567 891"], ["34567891"])).toEqual(
      expect.arrayContaining(["34567891", "3456", "7891"]),
    );
    expect(findForbiddenNumericFragments(["texto 7891"], ["34567891"])).toContain("7891");
  });

  it("keeps explicitly permitted numeric fixture content", () => {
    expect(
      findForbiddenNumericFragments(["CAUSA FICTICIA 72938461"], ["72938461"], ["72938461"]),
    ).toEqual([]);
  });

  it("distinguishes the geometry-only cause from the stamp E2E allowlist", () => {
    const source = [
      "INICIO PUBLICO",
      "SELLO PUBLICO DNI 34.567.891 CAUSA FICTICIA 72938461",
      "CIERRE PUBLICO",
    ];
    const outputWithOnlyCauseVisible = [
      "INICIO PUBLICO",
      "SELLO PUBLICO DNI CAUSA FICTICIA 72938461",
      "CIERRE PUBLICO",
    ];
    const geometry = fixture(source, outputWithOnlyCauseVisible, {
      forbiddenIdentifiers: ["34567891", "72938461"],
      sourceIdentifiersByPage: [["34567891", "72938461"]],
    });
    const endToEnd = {
      ...geometry,
      forbiddenIdentifiers: ["34567891"],
      allowedIdentifiers: ["72938461"],
    };
    expect(verifyExport(geometry).status).toBe("NO CUMPLE");
    expect(verifyExport(endToEnd).status).toBe("CUMPLE");
  });

  it("passes when every neighbor remains and all sensitive fragments are gone", () => {
    expect(
      verifyExport(
        fixture(
          ["INICIO PUBLICO", "DNI 34.567.891", "CIERRE PUBLICO"],
          ["INICIO PUBLICO", "DNI", "CIERRE PUBLICO"],
        ),
      ).status,
    ).toBe("CUMPLE");
  });

  it("rejects missing output neighbors and leaked numeric fragments", () => {
    expect(
      verifyExport(
        fixture(
          ["INICIO PUBLICO", "DNI 34.567.891", "CIERRE PUBLICO"],
          ["INICIO PUBLICO", "DNI 3456", "CIERRE"],
        ),
      ).status,
    ).toBe("NO CUMPLE");
  });

  it("reports an unreadable original as inconclusive", () => {
    const result = verifyExport(
      fixture(["INICIO PUBLICO", "CIERRE PUBLICO"], ["INICIO PUBLICO", "CIERRE PUBLICO"]),
    );
    expect(result.status).toBe("INCONCLUSO");
    if (result.status === "INCONCLUSO")
      expect(result.reasons).toContain('fuente página 1: OCR no leyó objetivo completo "34567891"');
  });

  it("requires source targets only on their fixture page but checks output leaks on every page", () => {
    const page = (lines: ReadonlyArray<string>) => ({ widthPt: 595, heightPt: 842, lines });
    const twoPages: ExportVerificationFixture = {
      ...fixture(
        ["INICIO PUBLICO", "DNI 34.567.891", "CIERRE PUBLICO"],
        ["INICIO PUBLICO", "CIERRE PUBLICO"],
      ),
      expectedPageCount: 2,
      source: {
        pages: [
          page(["INICIO PUBLICO", "DNI 34.567.891", "CIERRE PUBLICO"]),
          page(["INICIO PUBLICO", "CIERRE PUBLICO"]),
        ],
      },
      output: {
        pages: [
          page(["INICIO PUBLICO", "CIERRE PUBLICO"]),
          page(["INICIO PUBLICO", "DNI 34.567.891", "CIERRE PUBLICO"]),
        ],
      },
      neighborsByPage: [
        ["INICIO PUBLICO", "CIERRE PUBLICO"],
        ["INICIO PUBLICO", "CIERRE PUBLICO"],
      ],
      sourceIdentifiersByPage: [["34567891"], []],
    };
    expect(verifyExport(twoPages).status).toBe("NO CUMPLE");
    expect(
      verifyExport({
        ...twoPages,
        output: {
          pages: [
            page(["INICIO PUBLICO", "CIERRE PUBLICO"]),
            page(["INICIO PUBLICO", "CIERRE PUBLICO"]),
          ],
        },
      }).status,
    ).toBe("CUMPLE");
  });

  it("rejects changed page dimensions and missing output pages", () => {
    const onePage = fixture(
      ["INICIO PUBLICO", "DNI 34.567.891", "CIERRE PUBLICO"],
      ["INICIO PUBLICO", "CIERRE PUBLICO"],
      {
        output: {
          pages: [{ widthPt: 594, heightPt: 842, lines: ["INICIO PUBLICO", "CIERRE PUBLICO"] }],
        },
      },
    );
    expect(verifyExport(onePage).status).toBe("NO CUMPLE");
    expect(verifyExport({ ...onePage, expectedPageCount: 2 }).status).toBe("INCONCLUSO");
  });
});
