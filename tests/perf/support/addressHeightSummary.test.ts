import { describe, expect, it } from "vitest";

import { classifySentence, type ObservedOccurrence } from "./addressHeightClassify.js";
import type { AddressHeightRunRecord } from "./addressHeightRun.js";
import { expectedPageText, type AddressHeightSentence } from "./addressHeightSentences.js";
import {
  addressHeightRunFileName,
  buildRunTable,
  compareRepetitions,
  formatSummaryTable,
  resultLine,
  summarizeAddressHeight,
} from "./addressHeightSummary.js";

function s(id: string, text: string, place: string, number: string): AddressHeightSentence {
  return { id, category: id.charAt(0) as AddressHeightSentence["category"], text, place, number };
}

const A1 = s("A1", "Vive en Maipú 742 hace años.", "Maipú", "742");
const D1 = s("D1", "Llegó a Belgrano 1950 y volvió.", "Belgrano", "1950");
const E1 = s("E1", "Se realizó en Rosario 2019 con gente.", "Rosario", "2019");
const F1 = s("F1", "Fijó domicilio tras Mendoza 2005.", "Mendoza", "2005");
const H1 = s("H1", "Viajó a Mendoza 3 veces.", "Mendoza", "3");
const G1 = s("G1", "Vive en Lavalle al 4500 hoy.", "Lavalle", "4500");

function occ(value: string, pageIndex: number, entityType = "ADDRESS"): ObservedOccurrence {
  return {
    id: `${pageIndex}-${value}`,
    entityType,
    value,
    normalizedValue: null,
    source: "ner",
    confidence: 0.9,
    pageIndex,
    wordSpan: null,
  };
}

function record(sentence: AddressHeightSentence, values: ReadonlyArray<string>, index = 0) {
  return classifySentence({
    sentence,
    pageText: expectedPageText(sentence),
    pageWords: expectedPageText(sentence).split(" "),
    occurrences: values.map((value) => occ(value, index)),
  });
}

function run(
  repetition: number,
  sentences: ReturnType<typeof record>[],
  valid = true,
): AddressHeightRunRecord {
  return {
    schema: 1,
    repetition,
    valid,
    invalidReasons: valid ? [] : ["x"],
    pageCount: sentences.length,
    sourceKind: "text",
    config: { nerEnabled: true, performancePreset: "medium", engineOverridesPresent: false },
    textMismatches: [],
    occurrenceCount: 0,
    sentences,
  };
}

// A1, E1 (año sin palabra de dirección), F1 y H1 dentro, como espera la regla vigente; D1 a la vista (un
// desvío: la regla suma el año siempre); G1 sin marcar por el modelo.
const SAMPLE = [
  record(A1, ["Maipú 742"]),
  record(D1, ["Belgrano"]),
  record(E1, ["Rosario 2019"]),
  record(F1, ["Mendoza 2005"]),
  record(H1, ["Mendoza 3"]),
  record(G1, []),
];

describe("buildRunTable", () => {
  const table = buildRunTable(SAMPLE);

  it("cuenta por categoría los lugares marcados, los no marcados y los números dentro y a la vista", () => {
    const byCategory = Object.fromEntries(table.rows.map((row) => [row.category, row]));
    expect(byCategory.A).toMatchObject({
      sentences: 1,
      placeMarked: 1,
      placeNotMarked: 0,
      inside: 1,
      visible: 0,
    });
    expect(byCategory.D).toMatchObject({ inside: 0, visible: 1 });
    expect(byCategory.E).toMatchObject({ inside: 1, visible: 0 });
    expect(byCategory.G).toMatchObject({ placeMarked: 0, placeNotMarked: 1 });
    expect(table.total).toMatchObject({
      sentences: 6,
      placeMarked: 5,
      placeNotMarked: 1,
      inside: 4,
      visible: 1,
    });
  });

  it("alturas a la vista: la de D", () => {
    expect(table.heightsVisible).toEqual({ marked: 2, count: 1 });
  });

  it("años tapados de más: el de E y el de F", () => {
    expect(table.yearsOverCovered).toEqual({ marked: 2, count: 2 });
  });

  it("otros números tapados de más: H1", () => {
    expect(table.otherNumbersOverCovered).toEqual({ marked: 1, count: 1 });
  });

  it("no tiene ninguna columna de «tapar siempre»", () => {
    expect(JSON.stringify(table)).not.toContain("always");
    expect(JSON.stringify(table)).not.toContain("alwaysWouldCover");
  });

  it("lista las no marcadas y los desvíos de la regla con su motivo", () => {
    expect(table.notMarked.map((item) => item.id)).toEqual(["G1"]);
    // D1 queda a la vista y la regla vigente espera el año dentro: es un desvío.
    expect(table.unexpected.map((item) => item.id)).toEqual(["D1"]);
    expect(table.unexpected[0]?.reason).toContain("quedó a la vista");
    // Un número sin sumar es un desvío en A y en E; con los dos dentro no hay ninguno.
    const withDeviation = buildRunTable([record(A1, ["Maipú"]), record(E1, ["Rosario"])]);
    expect(withDeviation.unexpected.map((item) => item.id)).toEqual(["A1", "E1"]);
    expect(withDeviation.unexpected[0]?.addressValues).toEqual(["Maipú"]);
    const clean = buildRunTable([record(A1, ["Maipú 742"]), record(E1, ["Rosario 2019"])]);
    expect(clean.unexpected).toEqual([]);
  });
});

describe("summarizeAddressHeight", () => {
  it("dos corridas válidas e iguales: completa y coinciden", () => {
    const summary = summarizeAddressHeight({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE)],
    });
    expect(summary.complete).toBe(true);
    expect(summary.repetitionsAgree).toBe(true);
    expect(summary.differences).toEqual([]);
    expect(summary.runs.every((r) => r.table !== null)).toBe(true);
  });

  it("si una oración difiere entre repeticiones lo dice con su id", () => {
    const other = [record(A1, ["Maipú"]), ...SAMPLE.slice(1)];
    const summary = summarizeAddressHeight({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, other)],
    });
    expect(summary.repetitionsAgree).toBe(false);
    expect(summary.differences.map((d) => d.id)).toEqual(["A1"]);
  });

  it("una corrida inválida o faltante hace incompleta la tanda y no entra a las tablas", () => {
    const invalid = summarizeAddressHeight({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE, false)],
    });
    expect(invalid.complete).toBe(false);
    expect(invalid.repetitionsAgree).toBeNull();
    expect(invalid.runs[1]?.table).toBeNull();
    const missing = summarizeAddressHeight({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), undefined],
    });
    expect(missing.complete).toBe(false);
    expect(missing.runs[1]?.invalidReasons).toEqual(["falta el registro de la corrida"]);
  });

  it("compareRepetitions detecta oraciones que solo existen en una corrida", () => {
    const differences = compareRepetitions(run(1, SAMPLE), run(2, SAMPLE.slice(0, 2)));
    expect(differences.map((d) => d.id)).toEqual(["E1", "F1", "H1", "G1"]);
    const reverse = compareRepetitions(run(1, SAMPLE.slice(0, 2)), run(2, SAMPLE));
    expect(reverse.map((d) => d.id)).toEqual(["E1", "F1", "H1", "G1"]);
  });

  it("la tabla legible y la línea de resultado dan una sola medición, sin «tapar siempre»", () => {
    const summary = summarizeAddressHeight({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE)],
    });
    const table = formatSummaryTable(summary);
    expect(table).toContain("Corrida 1: válida");
    expect(table).toContain("Número: dentro");
    expect(table).not.toContain("Tapar siempre");
    expect(table).not.toContain("tapar siempre");
    expect(table).not.toContain("Contexto");
    expect(table).toContain("Alturas a la vista (A, B, C, D, G; sobre 2 con el lugar marcado): 1");
    expect(table).toContain("Años tapados de más (E, F; sobre 2): 2");
    expect(table).toContain("Lugar no marcado por el modelo (límite del modelo): G1");
    expect(table).toContain("Repeticiones: coinciden oración por oración.");
    expect(resultLine(summary)).toBe(
      "M-D1: completa; repeticiones coinciden; alturas a la vista 1, años tapados de más 2.",
    );
  });

  it("la tabla informa las corridas inválidas y los desvíos", () => {
    const summary = summarizeAddressHeight({
      expectedRepetitions: 2,
      records: [run(1, [record(A1, ["Maipú"])]), run(2, SAMPLE, false)],
    });
    const table = formatSummaryTable(summary);
    expect(table).toContain("INVÁLIDA (x)");
    expect(table).toContain("A1: Address=[Maipú]");
    expect(table).toContain("no hay dos corridas válidas que comparar");
    expect(resultLine(summary)).toContain("INCOMPLETA");
  });

  it("los nombres de archivo de las corridas son estables", () => {
    expect(addressHeightRunFileName(2)).toBe("address-height-run-r2.json");
  });
});
