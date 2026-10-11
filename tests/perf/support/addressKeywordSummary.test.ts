import { describe, expect, it } from "vitest";

import type { ObservedOccurrence } from "./addressHeightClassify.js";
import { classifyKeywordPage } from "./addressKeywordClassify.js";
import { compareWithBaseline } from "./addressKeywordExpectation.js";
import type { AddressKeywordRunRecord } from "./addressKeywordRun.js";
import {
  ADDRESS_KEYWORD_PAGES,
  expectedKeywordPageText,
  type KeywordPage,
} from "./addressKeywordSentences.js";
import {
  addressKeywordRunFileName,
  formatBaselineComparison,
  buildRunTable,
  compareRepetitions,
  formatPageLine,
  formatPagesTable,
  formatSummaryTable,
  resultLine,
  summarizeAddressKeyword,
} from "./addressKeywordSummary.js";

function page(id: string): KeywordPage {
  const found = ADDRESS_KEYWORD_PAGES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin página ${id}`);
  return found;
}

function occ(
  value: string,
  entityType = "ADDRESS",
  source = "ner",
  pageIndex = 0,
): ObservedOccurrence {
  return {
    id: `${pageIndex}-${entityType}-${value}`,
    entityType,
    value,
    normalizedValue: null,
    source,
    confidence: 0.9,
    pageIndex,
    wordSpan: null,
  };
}

function record(
  id: string,
  occurrences: ReadonlyArray<ObservedOccurrence>,
  pageText?: (expected: string) => string,
) {
  const target = page(id);
  const expected = expectedKeywordPageText(target);
  const text = pageText === undefined ? expected : pageText(expected);
  return classifyKeywordPage({
    page: target,
    pageText: text,
    pageWords: text.split(" "),
    occurrences,
  });
}

function run(
  repetition: number,
  pages: ReadonlyArray<ReturnType<typeof record>>,
  valid = true,
): AddressKeywordRunRecord {
  return {
    schema: 1,
    repetition,
    valid,
    invalidReasons: valid ? [] : ["x"],
    pageCount: pages.length,
    sourceKind: "text",
    config: { nerEnabled: true, performancePreset: "medium", engineOverridesPresent: false },
    invalidPages: [],
    occurrenceCount: 0,
    pages,
  };
}

// K1-1/n: dirección entera. K1-1/M: solo el nombre. K1-1/S: nada. K2-1/n: el nombre lo cubre una persona.
// K6-5/n: vía y nombre, sin altura. K8-1/n: se tapó de más. K8-2/n: nada. K1-2/n: página inválida.
const SAMPLE = [
  record("K1-1/n", [occ("Av. Corrientes 1980")]),
  record("K1-1/M", [occ("CORRIENTES")]),
  record("K1-1/S", []),
  record("K2-1/n", [occ("Maipú", "PERSON")]),
  record("K6-5/n", [occ("Av. Colón")]),
  record("K8-1/n", [occ("La calle"), occ("3 horas", "DATE", "regex")]),
  record("K8-2/n", []),
  record("K1-2/n", [occ("avenida Pueyrredón 1999")], (text) =>
    text.replace("Pueyrredón", "Pueyredon"),
  ),
];

describe("buildRunTable", () => {
  const table = buildRunTable(SAMPLE);
  const row = (category: string, script: string) => {
    const found = table.rows.find((r) => r.category === category && r.script === script);
    if (found === undefined) throw new Error(`sin fila ${category}/${script}`);
    return found;
  };

  it("cuenta el núcleo cubierto entero, en parte o nada, por dirección y por cualquier tipo", () => {
    expect(row("K1", "n")).toMatchObject({ pages: 1, invalidPages: 1 });
    expect(row("K1", "n").core.address).toEqual({ full: 1, partial: 0, none: 0 });
    expect(row("K1", "M").core.address).toEqual({ full: 0, partial: 1, none: 0 });
    expect(row("K1", "M").core.any).toEqual({ full: 0, partial: 1, none: 0 });
    expect(row("K1", "S").core.address).toEqual({ full: 0, partial: 0, none: 1 });
  });

  it("una persona sobre el nombre cuenta como cubierta contando cualquier tipo, no como dirección", () => {
    const k2 = row("K2", "n");
    expect(k2.core.address).toEqual({ full: 0, partial: 0, none: 1 });
    expect(k2.core.any).toEqual({ full: 0, partial: 1, none: 0 });
    expect(k2.parts.nombre.address).toEqual({ full: 0, partial: 0, none: 1 });
    expect(k2.parts.nombre.any).toEqual({ full: 1, partial: 0, none: 0 });
    expect(k2.parts.nombre.withOtherType).toBe(1);
    expect(k2.pagesWithOtherType).toBe(1);
  });

  it("una página sin altura cuenta su núcleo solo con el nombre", () => {
    const k6 = row("K6", "n");
    expect(k6.core.address).toEqual({ full: 1, partial: 0, none: 0 });
    expect(k6.parts.altura.pages).toBe(0);
    expect(k6.parts.via.pages).toBe(1);
  });

  it("K8 no tiene núcleo ni partes y cuenta las páginas donde se tapó algo", () => {
    const k8 = row("K8", "n");
    expect(k8).toMatchObject({ pages: 2, pagesTouched: 1 });
    expect(k8.core.address).toEqual({ full: 0, partial: 0, none: 0 });
  });

  it("los totales de K1 a K7 por escritura y en general no incluyen K8 ni las inválidas", () => {
    const all = table.totals.find((r) => r.script === "all");
    expect(all).toMatchObject({ category: "K1-K7", pages: 5, invalidPages: 1 });
    expect(all?.core.address).toEqual({ full: 2, partial: 1, none: 2 });
    expect(table.totals.map((r) => r.script)).toEqual(["n", "M", "S", "all"]);
  });

  it("lista las trampas con todo lo que se tapó, con su tipo y su detector", () => {
    expect(table.traps).toEqual([
      {
        id: "K8-1/n",
        valid: true,
        covered: [
          { entityType: "ADDRESS", value: "La calle", source: "ner" },
          { entityType: "DATE", value: "3 horas", source: "regex" },
        ],
      },
      { id: "K8-2/n", valid: true, covered: [] },
    ]);
  });

  it("lista aparte las páginas inválidas con su motivo", () => {
    expect(table.invalidPages).toEqual([
      { id: "K1-2/n", reason: "texto extraido distinto del escrito" },
    ]);
  });

  it("suma las ocurrencias ubicadas por un valor que se repite", () => {
    const withDot = buildRunTable([record("K1-8/n", [occ("."), occ("Gálvez", "PERSON")])]);
    expect(withDot.ambiguousOccurrences).toBe(1);
    expect(table.ambiguousOccurrences).toBe(0);
    expect(formatPageLine(record("K1-8/n", [occ(".")]))).toContain('"." (ner; ubicación ambigua)');
  });

  it("suma las ocurrencias sin ubicar", () => {
    const withUnlocated = buildRunTable([record("K1-1/n", [occ("nada que ver")])]);
    expect(withUnlocated.unlocatedOccurrences).toBe(1);
  });
});

describe("summarizeAddressKeyword", () => {
  it("dos corridas válidas e iguales: completa y coinciden", () => {
    const summary = summarizeAddressKeyword({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE)],
    });
    expect(summary.complete).toBe(true);
    expect(summary.repetitionsAgree).toBe(true);
    expect(summary.differences).toEqual([]);
    expect(summary.runs.every((r) => r.table !== null)).toBe(true);
  });

  it("si una página difiere entre repeticiones lo dice con su id", () => {
    const other = [record("K1-1/n", [occ("Corrientes")]), ...SAMPLE.slice(1)];
    const summary = summarizeAddressKeyword({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, other)],
    });
    expect(summary.repetitionsAgree).toBe(false);
    expect(summary.differences.map((d) => d.id)).toEqual(["K1-1/n"]);
  });

  it("una diferencia solo en el detector o en el tipo de lo que tapa también cuenta", () => {
    const other = [
      ...SAMPLE.slice(0, 5),
      record("K8-1/n", [occ("La calle", "ADDRESS", "regex"), occ("3 horas", "DATE", "regex")]),
      ...SAMPLE.slice(6),
    ];
    expect(compareRepetitions(run(1, SAMPLE), run(2, other)).map((d) => d.id)).toEqual(["K8-1/n"]);
  });

  it("una corrida inválida o faltante hace incompleta la tanda y no entra a las tablas", () => {
    const invalid = summarizeAddressKeyword({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE, false)],
    });
    expect(invalid.complete).toBe(false);
    expect(invalid.repetitionsAgree).toBeNull();
    expect(invalid.runs[1]?.table).toBeNull();
    const missing = summarizeAddressKeyword({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), undefined],
    });
    expect(missing.complete).toBe(false);
    expect(missing.runs[1]?.invalidReasons).toEqual(["falta el registro de la corrida"]);
  });

  it("compareRepetitions detecta páginas que solo existen en una corrida", () => {
    const differences = compareRepetitions(run(1, SAMPLE), run(2, SAMPLE.slice(0, 2)));
    expect(differences.map((d) => d.id)).toEqual(SAMPLE.slice(2).map((r) => r.id));
    const reverse = compareRepetitions(run(1, SAMPLE.slice(0, 2)), run(2, SAMPLE));
    expect(reverse.map((d) => d.id)).toEqual(SAMPLE.slice(2).map((r) => r.id));
  });

  it("la tabla legible y la línea de resultado dan una sola medición", () => {
    const summary = summarizeAddressKeyword({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE)],
    });
    const table = formatSummaryTable(summary);
    expect(table).toContain("Corrida 1: válida");
    expect(table).toContain("K1-K7");
    expect(table).toContain("Por parte, sobre K1 a K7");
    expect(table).toContain('K8-1/n: "La calle" ADDRESS (ner); "3 horas" DATE (regex)');
    expect(table).toContain("K8-2/n: nada");
    expect(table).toContain("Páginas inválidas (texto extraído distinto del escrito): K1-2/n");
    expect(table).toContain("Repeticiones: coinciden página por página.");
    expect(resultLine(summary)).toBe(
      "M-D2: completa; repeticiones coinciden; núcleo cubierto entero como dirección en 2 de 5 páginas de K1 a K7, páginas inválidas 1; ADR-217 NO se cumple: a la vista 3 (se esperan 4), trampas tapadas 1 en normal (0) y 0 en mayúsculas (12), páginas que no coinciden 4.",
    );
  });

  it("la tabla trae el bloque contra ADR-217 y la comparación contra la línea de base", () => {
    const summary = summarizeAddressKeyword({
      expectedRepetitions: 1,
      records: [run(1, SAMPLE)],
    });
    const table = formatSummaryTable(summary).split("\n");
    expect(table).toContain("Contra el criterio de ADR-217 (comparación, no gate)");
    expect(table).toContain(
      "  Trampas tapadas en escritura normal: 1 de 2 (se esperan 0) -> NO COINCIDE",
    );
    expect(table).toContain("Criterio: NO SE CUMPLE; páginas inválidas: K1-2/n");
    expect(summary.runs[0]?.expectation?.meetsCriterion).toBe(false);
    const comparison = compareWithBaseline(
      SAMPLE,
      SAMPLE.map((r) => r),
    );
    const text = formatBaselineComparison(comparison).join("\n");
    expect(text).toContain("Páginas iguales:");
    expect(text).toContain("Trampas que antes no se tapaban y ahora sí:");
  });

  it("con la observación del agrupado suma el bloque sobre lo que se pinta", () => {
    const keep = occ("Av. Corrientes 1980", "ADDRESS", "regex");
    const drop = { ...occ("Av. Corrientes 1980", "ADDRESS", "ner"), id: "drop-id" };
    const target = page("K1-1/n");
    const text = expectedKeywordPageText(target);
    const record1 = classifyKeywordPage({
      page: target,
      pageText: text,
      pageWords: text.split(" "),
      occurrences: [keep, drop],
      finalOccurrenceIds: new Set([keep.id]),
    });
    const summary = summarizeAddressKeyword({
      expectedRepetitions: 1,
      records: [run(1, [record1])],
    });
    expect(summary.runs[0]?.expectationFinal).not.toBeNull();
    expect(summary.runs[0]?.expectationFinal?.doublePainted).toEqual([]);
    expect(summary.runs[0]?.expectation?.doublePainted).toHaveLength(1);
    const table = formatSummaryTable(summary);
    expect(table).toContain("sobre lo que sobrevive al agrupado (lo que se pinta)");
    expect(table).toContain("sobre los eventos de detección");
    // Los registros que no observaron el agrupado no traen el segundo bloque.
    const old = summarizeAddressKeyword({ expectedRepetitions: 1, records: [run(1, SAMPLE)] });
    expect(old.runs[0]?.expectationFinal).toBeNull();
    expect(formatSummaryTable(old)).not.toContain("sobre lo que sobrevive");
  });

  it("la tabla informa las corridas inválidas", () => {
    const summary = summarizeAddressKeyword({
      expectedRepetitions: 2,
      records: [run(1, SAMPLE), run(2, SAMPLE, false)],
    });
    const table = formatSummaryTable(summary);
    expect(table).toContain("INVÁLIDA (x)");
    expect(table).toContain("no hay dos corridas válidas que comparar");
    expect(resultLine(summary)).toContain("INCOMPLETA");
  });

  it("los nombres de archivo de las corridas son estables", () => {
    expect(addressKeywordRunFileName(2)).toBe("address-keyword-run-r2.json");
  });
});

describe("formatPageLine", () => {
  it("una línea por página con direcciones, otras ocurrencias y el estado de cada parte", () => {
    expect(formatPageLine(SAMPLE[0]!)).toBe(
      'K1-1/n | dirección: "Av. Corrientes 1980" (ner) | otras: — | via=E nombre=E altura=E',
    );
    expect(formatPageLine(SAMPLE[3]!)).toBe(
      'K2-1/n | dirección: — | otras: "Maipú" PERSON (ner) | nombre=N[otro PERSON E; cualq E] altura=N',
    );
    expect(formatPageLine(SAMPLE[5]!)).toBe(
      'K8-1/n | dirección: "La calle" (ner) | otras: "3 horas" DATE (regex) | sin partes',
    );
    expect(formatPageLine(SAMPLE[7]!)).toBe(
      "K1-2/n | INVÁLIDA: texto extraido distinto del escrito",
    );
  });

  it("la tabla de páginas tiene una línea por página", () => {
    expect(formatPagesTable(SAMPLE).trimEnd().split("\n")).toHaveLength(SAMPLE.length);
  });
});
