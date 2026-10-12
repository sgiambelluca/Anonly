import { describe, expect, it } from "vitest";

import type { ObservedOccurrence } from "./addressHeightClassify.js";
import { classifyKeywordPage, type KeywordPageRecord } from "./addressKeywordClassify.js";
import {
  ADR217_EXPECTED_COVERED_TRAPS,
  ADR217_EXPECTED_VISIBLE,
  compareWithBaseline,
  evaluateAdr217,
  hasSurvivalInfo,
  overlappingAddresses,
  survivorsOnly,
} from "./addressKeywordExpectation.js";
import {
  ADDRESS_KEYWORD_PAGES,
  expectedKeywordPageText,
  presentParts,
  type KeywordPage,
} from "./addressKeywordSentences.js";

let sequence = 0;
function occurrence(
  value: string,
  patch: Partial<ObservedOccurrence> = {},
  entityType = "ADDRESS",
): ObservedOccurrence {
  sequence += 1;
  return {
    id: `occ-${sequence}`,
    entityType,
    value,
    normalizedValue: null,
    source: "regex",
    confidence: 1,
    pageIndex: 0,
    wordSpan: null,
    ...patch,
  };
}

function page(id: string): KeywordPage {
  const found = ADDRESS_KEYWORD_PAGES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin página ${id}`);
  return found;
}

function classify(target: KeywordPage, occurrences: ReadonlyArray<ObservedOccurrence>) {
  const text = expectedKeywordPageText(target);
  return classifyKeywordPage({
    page: target,
    pageText: text,
    pageWords: text.split(" "),
    occurrences,
  });
}

/** El tramo del texto de la página que va de la primera parte al nombre o a la altura. */
function coreSpan(target: KeywordPage): string {
  const text = expectedKeywordPageText(target);
  const parts = presentParts(target.parts).filter((p) => p.name !== "resto");
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first === undefined || last === undefined) throw new Error("sin partes");
  const start = text.indexOf(first.text, text.indexOf(target.text));
  const lastStart = text.indexOf(last.text, start);
  return text.slice(start, lastStart + last.text.length);
}

/** La corrida que ADR-217 espera: el patrón cierra todo salvo lo previsto y tapa las trampas previstas. */
function expectedRun(
  patch: (target: KeywordPage) => ReadonlyArray<ObservedOccurrence> | undefined = () => undefined,
): KeywordPageRecord[] {
  return ADDRESS_KEYWORD_PAGES.map((target) => {
    const patched = patch(target);
    if (patched !== undefined) return classify(target, patched);
    if (target.category === "K8") {
      const covered =
        target.script !== "n" && ADR217_EXPECTED_COVERED_TRAPS.includes(target.baseId);
      const words = target.text.split(" ");
      return classify(target, covered ? [occurrence(words.slice(1, 4).join(" "))] : []);
    }
    if (ADR217_EXPECTED_VISIBLE.includes(target.id)) return classify(target, []);
    return classify(target, [occurrence(coreSpan(target))]);
  });
}

describe("evaluateAdr217", () => {
  it("la corrida que ADR-217 espera cumple el criterio: 4 de 138, 0 de 9 y 12 de 18", () => {
    const report = evaluateAdr217(expectedRun());
    expect(report.visible).toMatchObject({ observed: 4, expected: 4, of: 138, matches: true });
    expect(report.visible.pages).toEqual(["K5-3/n", "K5-5/n", "K5-5/M", "K5-5/S"]);
    expect(report.trapsNormal).toMatchObject({ observed: 0, expected: 0, of: 9, matches: true });
    expect(report.trapsUpper).toMatchObject({ observed: 12, expected: 12, of: 18, matches: true });
    expect(report.mismatches).toEqual([]);
    expect(report.meetsCriterion).toBe(true);
    expect(report.closed).toHaveLength(134);
    expect(report.closedByCounts).toEqual({ regex: 134, modelo: 0, ambos: 0, union: 0 });
  });

  it("las seis trampas tapadas son las de la tabla del ADR, en M y en S", () => {
    const report = evaluateAdr217(expectedRun());
    expect(report.trapsUpper.pages).toEqual(
      ["M", "S"].flatMap((script) =>
        ["K8-1", "K8-2", "K8-3", "K8-7", "K8-8", "K8-9"].map((id) => `${id}/${script}`),
      ),
    );
  });

  it("una página que debía cerrarse y no cerró es una diferencia", () => {
    const report = evaluateAdr217(
      expectedRun((target) => (target.id === "K1-1/n" ? [] : undefined)),
    );
    expect(report.visible.observed).toBe(5);
    expect(report.meetsCriterion).toBe(false);
    expect(report.mismatches).toEqual([
      { id: "K1-1/n", kind: "debia-cerrar-y-no-cerro", detail: "nada" },
    ]);
  });

  it("una página que debía quedar a la vista y se cerró es una diferencia", () => {
    const report = evaluateAdr217(
      expectedRun((target) =>
        target.id === "K5-5/n" ? [occurrence(coreSpan(target))] : undefined,
      ),
    );
    expect(report.visible.observed).toBe(3);
    expect(report.mismatches.map((m) => [m.id, m.kind])).toEqual([
      ["K5-5/n", "debia-quedar-a-la-vista-y-se-cerro"],
    ]);
  });

  it("una trampa tapada en escritura normal, o una no prevista en mayúsculas, no debía taparse", () => {
    const report = evaluateAdr217(
      expectedRun((target) =>
        target.id === "K8-1/n" || target.id === "K8-4/M"
          ? [occurrence(target.text.split(" ").slice(1, 3).join(" "))]
          : undefined,
      ),
    );
    expect(report.trapsNormal.observed).toBe(1);
    expect(report.trapsUpper.observed).toBe(13);
    expect(report.mismatches.map((m) => [m.id, m.kind])).toEqual([
      ["K8-1/n", "no-debia-taparse-y-se-tapo"],
      ["K8-4/M", "no-debia-taparse-y-se-tapo"],
    ]);
    expect(report.meetsCriterion).toBe(false);
  });

  it("una trampa prevista en mayúsculas que no se tapó es una diferencia", () => {
    const report = evaluateAdr217(
      expectedRun((target) => (target.id === "K8-2/S" ? [] : undefined)),
    );
    expect(report.trapsUpper.observed).toBe(11);
    expect(report.mismatches).toEqual([
      { id: "K8-2/S", kind: "debia-taparse-y-no-se-tapo", detail: "nada" },
    ]);
  });

  it("dice quién cerró el núcleo: solo el patrón, solo el modelo, los dos o la unión", () => {
    const target = page("K1-1/n");
    const span = coreSpan(target);
    const nameOnly = "Corrientes";
    const heightOnly = "1980";
    const kinds = (occurrences: ReadonlyArray<ObservedOccurrence>) => {
      const report = evaluateAdr217([classify(target, occurrences)]);
      return report.closed[0]?.closedBy;
    };
    expect(kinds([occurrence(span)])).toBe("regex");
    expect(kinds([occurrence(span, { source: "ner" })])).toBe("modelo");
    expect(kinds([occurrence(span), occurrence(span, { source: "ner" })])).toBe("ambos");
    expect(kinds([occurrence(nameOnly), occurrence(heightOnly, { source: "ner" })])).toBe("union");
  });

  it("una persona del modelo sobre el nombre cierra el núcleo para «cualquier tipo» pero no para dirección", () => {
    const target = page("K2-1/n");
    const report = evaluateAdr217([
      classify(target, [occurrence("Maipú", { source: "ner" }, "PERSON"), occurrence("1434")]),
    ]);
    expect(report.visible.observed).toBe(0);
    expect(report.visibleAddressOnly.observed).toBe(1);
  });

  it("detecta las dos direcciones pintadas sobre el mismo tramo y dice si es contenida", () => {
    const target = page("K1-1/n");
    const record = classify(target, [
      occurrence("Av. Corrientes", { source: "ner" }),
      occurrence("Av. Corrientes 1980"),
    ]);
    expect(overlappingAddresses(record)).toEqual([
      {
        first: { value: "Av. Corrientes", source: "ner" },
        second: { value: "Av. Corrientes 1980", source: "regex" },
        relation: "contenida",
      },
    ]);
    const report = evaluateAdr217([record]);
    expect(report.doublePainted.map((d) => d.id)).toEqual(["K1-1/n"]);
  });

  it("una cruzada es cruzada; las separadas y las de otro tipo no cuentan", () => {
    const target = page("K6-1/n");
    const crossed = classify(target, [
      occurrence("Av. Corrientes"),
      occurrence("Corrientes y Maipú"),
    ]);
    expect(overlappingAddresses(crossed).map((p) => p.relation)).toEqual(["cruzada"]);
    const apart = classify(target, [occurrence("Av. Corrientes"), occurrence("Maipú")]);
    expect(overlappingAddresses(apart)).toEqual([]);
    const other = classify(target, [
      occurrence("Av. Corrientes"),
      occurrence("Corrientes", {}, "PERSON"),
    ]);
    expect(overlappingAddresses(other)).toEqual([]);
  });

  it("una página inválida no entra a ningún total y se lista aparte", () => {
    const records = expectedRun();
    const bad = classifyKeywordPage({
      page: page("K1-1/n"),
      pageText: "otro texto",
      pageWords: ["otro", "texto"],
      occurrences: [],
    });
    const report = evaluateAdr217([bad, ...records.slice(1)]);
    expect(report.invalidPages).toEqual(["K1-1/n"]);
    expect(report.visible.of).toBe(137);
    expect(report.visible.observed).toBe(4);
  });
});

describe("lo que sobrevive al agrupado", () => {
  const target = page("K1-1/n");
  const text = expectedKeywordPageText(target);

  function withSurvivors(
    survivors: ReadonlySet<string>,
    occurrences: ReadonlyArray<ObservedOccurrence>,
  ) {
    return classifyKeywordPage({
      page: target,
      pageText: text,
      pageWords: text.split(" "),
      occurrences,
      finalOccurrenceIds: survivors,
    });
  }

  it("sin la observación del agrupado no hay información de supervivencia", () => {
    const record = classify(target, [occurrence("Av. Corrientes 1980")]);
    expect(hasSurvivalInfo([record])).toBe(false);
    expect(record.addresses[0]?.survives).toBeUndefined();
  });

  it("marca cada ocurrencia según esté o no en un grupo final", () => {
    const keep = occurrence("Av. Corrientes 1980", { id: "a" });
    const drop = occurrence("Av. Corrientes 1980", { id: "b", source: "ner" });
    const record = withSurvivors(new Set(["a"]), [keep, drop]);
    expect(hasSurvivalInfo([record])).toBe(true);
    expect(record.addresses.map((o) => [o.source, o.survives])).toEqual([
      ["regex", true],
      ["ner", false],
    ]);
  });

  it("dos direcciones iguales que el agrupado resolvió en una no son dos pintadas", () => {
    const keep = occurrence("Av. Corrientes 1980", { id: "a" });
    const drop = occurrence("Av. Corrientes 1980", { id: "b", source: "ner" });
    const record = withSurvivors(new Set(["a"]), [keep, drop]);
    expect(overlappingAddresses(record)).toHaveLength(1);
    const [survivors] = survivorsOnly([record]);
    expect(survivors === undefined ? [] : overlappingAddresses(survivors)).toEqual([]);
    expect(evaluateAdr217(survivorsOnly([record])).doublePainted).toEqual([]);
  });

  it("dos direcciones contenidas que sobreviven las dos son dos pintadas (el límite de ADR-117)", () => {
    const wide = occurrence("calle 50 N° 889 de La Plata", { id: "a", source: "ner" });
    const narrow = occurrence("calle 50 N° 889", { id: "b" });
    const record = classify(page("K5-1/n"), []);
    const both = classifyKeywordPage({
      page: page("K5-1/n"),
      pageText: expectedKeywordPageText(page("K5-1/n")),
      pageWords: expectedKeywordPageText(page("K5-1/n")).split(" "),
      occurrences: [wide, narrow],
      finalOccurrenceIds: new Set(["a", "b"]),
    });
    expect(record.addresses).toEqual([]);
    const report = evaluateAdr217(survivorsOnly([both]));
    expect(report.doublePainted.map((d) => [d.id, d.pairs[0]?.relation])).toEqual([
      ["K5-1/n", "contenida"],
    ]);
  });

  it("la cobertura sobre lo que sobrevive no cuenta lo descartado", () => {
    const only = occurrence("Av. Corrientes 1980", { id: "a" });
    const record = withSurvivors(new Set(), [only]);
    expect(evaluateAdr217([record]).visible.observed).toBe(0);
    expect(evaluateAdr217(survivorsOnly([record])).visible.observed).toBe(1);
  });
});

describe("compareWithBaseline", () => {
  const target = page("K1-1/n");
  const trap = page("K8-1/M");
  const full = (p: KeywordPage) => classify(p, [occurrence(coreSpan(p))]);
  const none = (p: KeywordPage) => classify(p, []);

  it("una página que antes no estaba cubierta y ahora sí mejora; al revés, empeora", () => {
    const better = compareWithBaseline([full(target)], [none(target)]);
    expect(better.improved).toEqual([
      { id: "K1-1/n", before: "núcleo none", after: "núcleo full" },
    ]);
    expect(better.worse).toEqual([]);
    const worse = compareWithBaseline([none(target)], [full(target)]);
    expect(worse.worse).toEqual([{ id: "K1-1/n", before: "núcleo full", after: "núcleo none" }]);
    expect(worse.improved).toEqual([]);
  });

  it("una página igual cuenta como igual", () => {
    const same = compareWithBaseline([full(target)], [full(target)]);
    expect(same).toMatchObject({ same: 1, improved: [], worse: [] });
  });

  it("una trampa que antes no se tapaba y ahora sí se lista aparte, y al revés", () => {
    const covered = classify(trap, [occurrence("CALLE ESTUVO CORTADA 3")]);
    const newly = compareWithBaseline([covered], [none(trap)]);
    expect(newly.trapsNewlyCovered.map((c) => [c.id, c.before])).toEqual([["K8-1/M", "nada"]]);
    expect(newly.improved).toEqual([]);
    const gone = compareWithBaseline([none(trap)], [covered]);
    expect(gone.trapsNoLongerCovered.map((c) => c.id)).toEqual(["K8-1/M"]);
  });

  it("una página que falta o es inválida en alguna de las dos no es comparable", () => {
    const invalid = classifyKeywordPage({
      page: target,
      pageText: "x",
      pageWords: ["x"],
      occurrences: [],
    });
    expect(compareWithBaseline([full(target)], []).notComparable).toEqual(["K1-1/n"]);
    expect(compareWithBaseline([invalid], [full(target)]).notComparable).toEqual(["K1-1/n"]);
  });
});
