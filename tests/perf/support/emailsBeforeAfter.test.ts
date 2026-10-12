import { describe, expect, it } from "vitest";

import {
  compareCampaign,
  compareCell,
  comparisonLines,
  dpiDownCellId,
  nativeCellIdOf,
  viewOfDpiDownCell,
  viewOfNativeCell,
  type CellView,
} from "./emailsBeforeAfter.js";
import type { ObservedEntity } from "./ocrDpiDownScoring.js";

const EMAIL = "ricardo.ibarra@example.org";

function view(patch: Partial<CellView> = {}): CellView {
  return {
    id: "S8-n150-r1",
    valid: true,
    invalidReasons: [],
    effectiveDpis: [151],
    emails: { expected: 2, detected: 2, missed: 0, added: 0 },
    lostEmails: [],
    addedEmails: [],
    otherMissed: [],
    otherAdded: [],
    detected: [],
    observedText: "texto leído",
    ...patch,
  };
}

const lost = (expected = EMAIL, reading: "at-as-q" | "other-reading" = "at-as-q") => ({
  pageIndex: 0,
  expected,
  reading,
  fragment: expected.replace("@", "Q"),
});

const email = (value: string, normalizedValue?: string): ObservedEntity => ({
  type: "EMAIL",
  value,
  ...(normalizedValue === undefined ? {} : { normalizedValue }),
  pageIndex: 0,
  box: null,
});

describe("adaptadores", () => {
  it("una celda de DPI descendente: cuenta de emails, texto entero y lectura de cada perdido", () => {
    const result = viewOfDpiDownCell({
      corpus: "S8",
      dpi: 150,
      repetition: 1,
      valid: true,
      dispatch: { effectiveDpis: [150] },
      entitiesVsTruth: {
        byType: { EMAIL: { expected: 2, detected: 1, missed: 1, added: 0 }, DNI: { expected: 1 } },
      },
      syntheticDetail: {
        missedVsTruth: [
          { type: "EMAIL", pageIndex: 0, value: EMAIL },
          { type: "DNI", pageIndex: 0, value: "34.567.891" },
        ],
        addedVsTruth: [{ type: "PERSON", pageIndex: 0, value: "Lucía Femández" }],
        detected: [],
        observedText: "mail ricardo.ibarraQexample.org fin",
      },
    });
    expect(result.id).toBe("S8-d150-rep1");
    expect(dpiDownCellId("S8", 150, 1)).toBe(result.id);
    expect(result.emails).toEqual({ expected: 2, detected: 1, missed: 1, added: 0 });
    expect(result.lostEmails).toEqual([
      { pageIndex: 0, expected: EMAIL, reading: "at-as-q", fragment: "ricardo.ibarraQexample.org" },
    ]);
    expect(result.otherMissed).toEqual([{ type: "DNI", pageIndex: 0, value: "34.567.891" }]);
    expect(result.otherAdded).toHaveLength(1);
    expect(result.effectiveDpis).toEqual([150]);
  });

  it("una celda nativa conserva lo que guardó el arnés de emails nativos", () => {
    const result = viewOfNativeCell({
      corpus: "SD1",
      nativeDpi: 150,
      repetition: 2,
      valid: true,
      nativeDpiEvidence: { effectiveDpis: [151] },
      emails: {
        expected: 2,
        detected: 1,
        missed: 1,
        added: 0,
        lost: [lost()],
        addedValues: [],
      },
      otherTypes: { missed: [], added: [] },
      observedText: "x",
    });
    expect(result.id).toBe("SD1-n150-r2");
    expect(nativeCellIdOf("SD1", 150, 2)).toBe(result.id);
    expect(result.lostEmails).toHaveLength(1);
    expect(result.detected).toBeNull();
  });
});

describe("compareCell", () => {
  it("un email recuperado: value leído, valor normalizado y que coincide con la verdad", () => {
    const before = view({
      emails: { expected: 2, detected: 1, missed: 1, added: 0 },
      lostEmails: [lost()],
    });
    const after = view({
      detected: [email("ricardo.ibarraQexample.org", EMAIL)],
    });
    const result = compareCell(before, after);
    expect(result.textIdentical).toBe(true);
    expect(result.recovered).toEqual([
      {
        pageIndex: 0,
        expected: EMAIL,
        beforeReading: "at-as-q",
        beforeFragment: "ricardo.ibarraQexample.org",
        detectedValue: "ricardo.ibarraQexample.org",
        detectedNormalizedValue: EMAIL,
        normalizedMatchesTruth: true,
      },
    ]);
    expect(result.stillLost).toEqual([]);
    expect(result.newlyLost).toEqual([]);
    expect(result.addedAfter).toEqual([]);
  });

  it("un valor normalizado que difiere de la verdad en la forma (aunque sea el mismo canónico) no coincide letra por letra", () => {
    const before = view({ lostEmails: [lost()] });
    const after = view({
      detected: [email("ricardo.ibarraQexample.org", "Ricardo.Ibarra@example.org")],
    });
    expect(compareCell(before, after).recovered[0]?.normalizedMatchesTruth).toBe(false);
  });

  it("sin lo detectado guardado no se puede mirar el valor: queda n/d, no verdadero", () => {
    const before = view({ lostEmails: [lost()] });
    const after = view({ detected: null });
    expect(compareCell(before, after).recovered[0]).toMatchObject({
      detectedValue: null,
      normalizedMatchesTruth: null,
    });
  });

  it("los que siguen perdidos y los perdidos nuevos se separan", () => {
    const other = "contacto.estudio@example.org";
    const before = view({ lostEmails: [lost(), lost(other, "other-reading")] });
    const after = view({
      lostEmails: [lost(other, "other-reading"), lost("nuevo@example.com")],
    });
    const result = compareCell(before, after);
    expect(result.recovered.map((item) => item.expected)).toEqual([EMAIL]);
    expect(result.stillLost.map((item) => item.expected)).toEqual([other]);
    expect(result.newlyLost.map((item) => item.expected)).toEqual(["nuevo@example.com"]);
  });

  it("un email agregado que no está en la verdad se informa", () => {
    const after = view({ addedEmails: [{ pageIndex: 1, value: "ajeno@example.net" }] });
    expect(compareCell(view(), after).addedAfter).toEqual([
      { pageIndex: 1, value: "ajeno@example.net" },
    ]);
  });

  it("un agregado que ya estaba en la línea de base se informa pero no es nuevo", () => {
    const added = { pageIndex: 0, value: "suarez@example.com" };
    const result = compareCell(view({ addedEmails: [added] }), view({ addedEmails: [added] }));
    expect(result.addedAfter).toEqual([added]);
    expect(result.newlyAdded).toEqual([]);
    const fresh = compareCell(
      view({ addedEmails: [added] }),
      view({ addedEmails: [added, { pageIndex: 1, value: "x@y.com" }] }),
    );
    expect(fresh.newlyAdded).toEqual([{ pageIndex: 1, value: "x@y.com" }]);
    const text = comparisonLines(
      compareCampaign(
        "t",
        new Map([["A", view({ id: "A", addedEmails: [added] })]]),
        new Map([["A", view({ id: "A", addedEmails: [added] })]]),
      ),
    ).join("\n");
    expect(text).toContain("[ya estaba en la línea de base]");
    expect(text).toContain("nuevos respecto de la línea de base=0");
  });

  it("el texto leído distinto marca la celda como no limpia", () => {
    expect(compareCell(view(), view({ observedText: "otro" })).textIdentical).toBe(false);
  });

  it("otras entidades que cambian contra la verdad, en cualquier tipo", () => {
    const dni = { type: "DNI", pageIndex: 0, value: "34.567.891" };
    const org = { type: "ORGANIZATION", pageIndex: 0, value: "Correo" };
    const person = { type: "PERSON", pageIndex: 0, value: "Ana" };
    const result = compareCell(
      view({ otherMissed: [dni], otherAdded: [org] }),
      view({ otherMissed: [], otherAdded: [org, person] }),
    );
    expect(result.otherChanges.noLongerMissed).toEqual([dni]);
    expect(result.otherChanges.newlyAdded).toEqual([person]);
    expect(result.otherChanges.newlyMissed).toEqual([]);
    expect(result.otherChanges.noLongerAdded).toEqual([]);
  });

  it("lo detectado que no es email y difiere entre corridas se lista; el email no entra", () => {
    const person = (value: string): ObservedEntity => ({
      type: "PERSON",
      value,
      pageIndex: 0,
      box: null,
    });
    const result = compareCell(
      view({ detected: [person("Ana Paz"), email("a@x.com")] }),
      view({ detected: [person("Ana Paz"), person("Luis"), email("a@x.com", "a@x.com")] }),
    );
    expect(result.otherChanges.detectedOnlyAfter).toEqual([person("Luis")]);
    expect(result.otherChanges.detectedOnlyBefore).toEqual([]);
    expect(compareCell(view({ detected: null }), view()).otherChanges.detectedOnlyAfter).toBeNull();
  });
});

describe("compareCampaign y comparisonLines", () => {
  const key = (id: string, patch: Partial<CellView> = {}): [string, CellView] => [
    id,
    view({ id, ...patch }),
  ];

  it("suma solo las celdas válidas en las dos y arma el resultado", () => {
    const before = new Map([
      key("A", {
        emails: { expected: 2, detected: 0, missed: 2, added: 0 },
        lostEmails: [lost(), lost("b@example.com")],
      }),
      key("B"),
      key("C", { valid: false, invalidReasons: ["x"] }),
      key("SOLO-ANTES"),
    ]);
    const after = new Map([
      key("A", {
        detected: [
          email("ricardo.ibarraQexample.org", EMAIL),
          email("bQexample.com", "b@example.com"),
        ],
      }),
      key("B"),
      key("C"),
      key("SOLO-DESPUES"),
    ]);
    const result = compareCampaign("prueba", before, after);
    expect(result.totals.cellsCompared).toBe(3);
    expect(result.totals.cellsValidInBoth).toBe(2);
    expect(result.totals.cellsInvalid).toEqual(["C"]);
    expect(result.totals.emailsBefore).toEqual({ expected: 4, detected: 2, missed: 2, added: 0 });
    expect(result.totals.emailsAfter).toEqual({ expected: 4, detected: 4, missed: 0, added: 0 });
    expect(result.totals.recovered).toBe(2);
    expect(result.totals.stillLost).toBe(0);
    expect(result.totals.addedAfter).toBe(0);
    expect(result.onlyBefore).toEqual(["SOLO-ANTES"]);
    expect(result.onlyAfter).toEqual(["SOLO-DESPUES"]);
    expect(result.allRecoveredNormalizedMatchTruth).toBe(true);
    const text = comparisonLines(result).join("\n");
    expect(text).toContain("recuperados=2");
    expect(text).toContain("recuperado p0 ricardo.ibarra@example.org: antes at-as-q");
    expect(text).toContain("texto leído idéntico a la línea de base en todas las celdas: sí");
  });

  it("agregados, perdidos nuevos y texto distinto salen con mayúsculas en el informe", () => {
    const before = new Map([key("A")]);
    const after = new Map([
      key("A", {
        observedText: "otro",
        lostEmails: [lost()],
        addedEmails: [{ pageIndex: 0, value: "ajeno@example.net" }],
        emails: { expected: 2, detected: 2, missed: 1, added: 1 },
      }),
    ]);
    const text = comparisonLines(compareCampaign("x", before, after)).join("\n");
    expect(text).toContain("AGREGADO que no está en la verdad p0: ajeno@example.net");
    expect(text).toContain("PERDIDO NUEVO p0");
    expect(text).toContain("[TEXTO DISTINTO]");
    expect(text).toContain("NO (A)");
  });
});
