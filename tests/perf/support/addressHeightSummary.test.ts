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

// A1 dentro; D1 a la vista (esperado); E1 año sin tocar (tapar siempre lo cubriría); F1 año dentro
// (tapado de más); H1 dentro; G1 sin marcar por el modelo.
const SAMPLE = [
  record(A1, ["Maipú 742"]),
  record(D1, ["Belgrano"]),
  record(E1, ["Rosario"]),
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
      context: { inside: 1, visible: 0 },
      always: { inside: 1, visible: 0 },
    });
    expect(byCategory.D).toMatchObject({
      context: { inside: 0, visible: 1 },
      always: { inside: 1, visible: 0 },
    });
    expect(byCategory.E).toMatchObject({
      context: { inside: 0, visible: 1 },
      always: { inside: 1, visible: 0 },
    });
    expect(byCategory.G).toMatchObject({ placeMarked: 0, placeNotMarked: 1 });
    expect(table.total).toMatchObject({ sentences: 6, placeMarked: 5, placeNotMarked: 1 });
    expect(table.total.context).toEqual({ inside: 3, visible: 2 });
    expect(table.total.always).toEqual({ inside: 5, visible: 0 });
  });

  it("alturas a la vista: la regla deja la de D; tapar siempre la cubre", () => {
    expect(table.heightsVisible).toEqual({ marked: 2, context: 1, always: 0 });
  });

  it("años tapados de más: la regla tapa el de F; tapar siempre suma el de E", () => {
    expect(table.yearsOverCovered).toEqual({ marked: 2, context: 1, always: 2 });
  });

  it("otros números tapados de más: H1", () => {
    expect(table.otherNumbersOverCovered).toEqual({ marked: 1, context: 1, always: 1 });
  });

  it("lista las no marcadas y los desvíos de la regla con su motivo", () => {
    expect(table.notMarked.map((item) => item.id)).toEqual(["G1"]);
    // E1 no es desvío (sin tocar); F1 está esperado dentro; el único desvío posible acá es ninguno.
    expect(table.unexpected).toEqual([]);
    const withDeviation = buildRunTable([record(A1, ["Maipú"]), record(E1, ["Rosario 2019"])]);
    expect(withDeviation.unexpected.map((item) => item.id)).toEqual(["A1", "E1"]);
    expect(withDeviation.unexpected[0]?.addressValues).toEqual(["Maipú"]);
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

  it("la tabla legible y la línea de resultado nombran las dos variantes", () => {
    const summary = summarizeAddressHeight({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE)],
    });
    const table = formatSummaryTable(summary);
    expect(table).toContain("Corrida 1: válida");
    expect(table).toContain("Contexto");
    expect(table).toContain("Tapar siempre");
    expect(table).toContain("Lugar no marcado por el modelo (límite del modelo): G1");
    expect(table).toContain("Repeticiones: coinciden oración por oración.");
    expect(resultLine(summary)).toBe(
      "M-D1: completa; repeticiones coinciden; alturas a la vista 1 (contexto) / 0 (tapar siempre), " +
        "años tapados de más 1 / 2.",
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
