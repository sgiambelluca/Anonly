import { describe, expect, it } from "vitest";

import type { ObservedOccurrence } from "./addressHeightClassify.js";
import {
  classifyKeywordPage,
  combineCoverage,
  coreParts,
  locateKeywordOccurrence,
  partOf,
} from "./addressKeywordClassify.js";
import {
  ADDRESS_KEYWORD_PAGES,
  expectedKeywordPageText,
  type KeywordPage,
} from "./addressKeywordSentences.js";

function page(id: string): KeywordPage {
  const found = ADDRESS_KEYWORD_PAGES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`sin página ${id}`);
  return found;
}

let sequence = 0;
function occurrence(
  entityType: string,
  value: string,
  patch: Partial<ObservedOccurrence> = {},
): ObservedOccurrence {
  sequence += 1;
  return {
    id: `occ-${sequence}`,
    entityType,
    value,
    normalizedValue: null,
    source: "ner",
    confidence: 0.9,
    pageIndex: 0,
    wordSpan: null,
    ...patch,
  };
}

function classify(id: string, occurrences: ReadonlyArray<ObservedOccurrence>, pageText?: string) {
  const target = page(id);
  const text = pageText ?? expectedKeywordPageText(target);
  return classifyKeywordPage({
    page: target,
    pageText: text,
    pageWords: text.split(" "),
    occurrences,
  });
}

function states(record: ReturnType<typeof classify>) {
  return Object.fromEntries(record.parts.map((part) => [part.part, part.address]));
}

describe("classifyKeywordPage", () => {
  it("una dirección que abarca vía, nombre y altura cubre las tres partes enteras", () => {
    const record = classify("K1-1/n", [occurrence("ADDRESS", "Av. Corrientes 1980")]);
    expect(record.valid).toBe(true);
    expect(record.parts.map((p) => p.part)).toEqual(["via", "nombre", "altura"]);
    expect(states(record)).toEqual({ via: "full", nombre: "full", altura: "full" });
    expect(record.parts.every((p) => p.other === "none" && p.otherTypes.length === 0)).toBe(true);
    expect(record.parts.every((p) => p.any === "full")).toBe(true);
    expect(record.addresses.map((a) => [a.value, a.source])).toEqual([
      ["Av. Corrientes 1980", "ner"],
    ]);
    expect(record.others).toEqual([]);
    expect(record.unlocatedOccurrences).toBe(0);
  });

  it("si el modelo marca solo el nombre, la vía y la altura quedan a la vista", () => {
    const record = classify("K1-1/n", [occurrence("ADDRESS", "Corrientes")]);
    expect(states(record)).toEqual({ via: "none", nombre: "full", altura: "none" });
    expect(record.parts.map((p) => p.any)).toEqual(["none", "full", "none"]);
  });

  it("una dirección sin la altura deja la altura sin cubrir", () => {
    const record = classify("K1-2/n", [occurrence("ADDRESS", "avenida Pueyrredón")]);
    expect(states(record)).toEqual({ via: "full", nombre: "full", altura: "none" });
  });

  it("un nombre de varias palabras cubierto a medias queda en parte", () => {
    const record = classify("K3-1/n", [occurrence("ADDRESS", "Presidente Roque")]);
    expect(states(record)).toEqual({ via: "none", nombre: "partial", altura: "none" });
  });

  it("dos ocurrencias contiguas separadas por un espacio cubren entero el nombre", () => {
    const record = classify("K3-1/n", [
      occurrence("ADDRESS", "Presidente Roque"),
      occurrence("ADDRESS", "Sáenz Peña 1234"),
    ]);
    expect(states(record)).toEqual({ via: "none", nombre: "full", altura: "full" });
  });

  it("una ocurrencia de otro tipo que cubre el nombre se registra con su tipo y no cuenta como dirección", () => {
    const record = classify("K2-1/n", [occurrence("PERSON", "Maipú")]);
    const nombre = partOf(record, "nombre");
    expect(nombre).toMatchObject({
      address: "none",
      other: "full",
      otherTypes: ["PERSON"],
      any: "full",
    });
    expect(partOf(record, "altura")).toMatchObject({ address: "none", other: "none", any: "none" });
    expect(record.addresses).toEqual([]);
    expect(record.others.map((o) => [o.entityType, o.value, o.source])).toEqual([
      ["PERSON", "Maipú", "ner"],
    ]);
  });

  it("una patente sobre «MAR 450» cubre en parte el nombre y entera la altura, y se registra", () => {
    const record = classify("K3-7/M", [
      occurrence("ADDRESS", "AVENIDA DEL", { source: "ner" }),
      occurrence("PLATE", "MAR 450", { source: "regex" }),
    ]);
    expect(states(record)).toEqual({ via: "full", nombre: "partial", altura: "none" });
    const nombre = partOf(record, "nombre");
    expect(nombre).toMatchObject({ other: "partial", otherTypes: ["PLATE"], any: "full" });
    expect(partOf(record, "altura")).toMatchObject({
      address: "none",
      other: "full",
      otherTypes: ["PLATE"],
      any: "full",
    });
    expect(record.others.map((o) => [o.entityType, o.source])).toEqual([["PLATE", "regex"]]);
  });

  it("las ocurrencias del relleno no tocan la oración; las que la cruzan sí", () => {
    const record = classify("K1-1/n", [
      occurrence("ORGANIZATION", "Se deja constancia de lo actuado"),
      occurrence("PERSON", "expediente. La oficina"),
    ]);
    expect(record.others.map((o) => o.value)).toEqual(["expediente. La oficina"]);
    expect(record.parts.every((p) => p.any === "none")).toBe(true);
  });

  it("las partes que no hay en la oración no aparecen: K6-5 no tiene altura ni resto, K7-1 tiene las cuatro", () => {
    expect(classify("K6-5/n", []).parts.map((p) => p.part)).toEqual(["via", "nombre"]);
    expect(classify("K7-1/n", []).parts.map((p) => p.part)).toEqual([
      "via",
      "nombre",
      "altura",
      "resto",
    ]);
    expect(classify("K2-1/n", []).parts.map((p) => p.part)).toEqual(["nombre", "altura"]);
  });

  it("el resto de K7 se cubre aparte del nombre y la altura", () => {
    const record = classify("K7-1/n", [occurrence("ADDRESS", "calle Lavalle 385")]);
    expect(states(record)).toEqual({ via: "full", nombre: "full", altura: "full", resto: "none" });
    const withResto = classify("K7-1/n", [
      occurrence("ADDRESS", "calle Lavalle 385, piso 3, depto. B"),
    ]);
    expect(partOf(withResto, "resto")?.address).toBe("full");
  });

  it("una trampa de K8 no tiene partes y lista todo lo que se tapó en la oración", () => {
    const record = classify("K8-1/n", [
      occurrence("ADDRESS", "La calle"),
      occurrence("DATE", "3 horas", { source: "regex" }),
    ]);
    expect(record.parts).toEqual([]);
    expect(record.addresses.map((a) => a.value)).toEqual(["La calle"]);
    expect(record.others.map((o) => [o.entityType, o.value, o.source])).toEqual([
      ["DATE", "3 horas", "regex"],
    ]);
    expect(classify("K8-1/n", []).addresses).toEqual([]);
  });

  it("funciona igual en mayúsculas y sin tildes", () => {
    const record = classify("K1-6/S", [occurrence("ADDRESS", "PJE. GUEMES")]);
    expect(states(record)).toEqual({ via: "full", nombre: "full", altura: "none" });
    expect(record.script).toBe("S");
    expect(record.baseId).toBe("K1-6");
  });

  it("un texto extraído distinto del escrito invalida la página y no se normaliza", () => {
    const written = expectedKeywordPageText(page("K1-6/n"));
    const record = classify(
      "K1-6/n",
      [occurrence("ADDRESS", "Pje. Güemes 315")],
      written.replace("Güemes", "Guemes"),
    );
    expect(record.valid).toBe(false);
    expect(record.invalidReason).toContain("texto extraido distinto");
    expect(record.parts).toEqual([]);
    expect(record.pageText).toContain("Guemes");
  });

  it("una ocurrencia que no se puede ubicar se cuenta aparte y no cubre nada", () => {
    const record = classify("K1-1/n", [occurrence("ADDRESS", "Corrientes 9999")]);
    expect(record.unlocatedOccurrences).toBe(1);
    expect(record.addresses).toEqual([]);
    expect(record.parts.every((p) => p.any === "none")).toBe(true);
  });
});

describe("ocurrencias ambiguas", () => {
  it("un valor que se repite en la oración y se ubicó por valor se marca como ambiguo", () => {
    const record = classify("K1-8/n", [occurrence("ADDRESS", "."), occurrence("PERSON", "Gálvez")]);
    expect(record.addresses.map((o) => [o.value, o.locatedBy, o.ambiguous])).toEqual([
      [".", "value", true],
    ]);
    expect(record.others.map((o) => [o.value, o.ambiguous])).toEqual([["Gálvez", false]]);
  });

  it("si lo ubican los índices de palabra no es ambiguo aunque el valor se repita", () => {
    const text = expectedKeywordPageText(page("K1-8/n"));
    const words = text.split(" ");
    const index = words.indexOf("Bv.");
    const record = classifyKeywordPage({
      page: page("K1-8/n"),
      pageText: text,
      pageWords: words,
      occurrences: [
        occurrence("ADDRESS", "Bv.", {
          wordSpan: { startIndex: index, endIndexExclusive: index + 1 },
        }),
      ],
    });
    expect(record.addresses.map((o) => [o.locatedBy, o.ambiguous])).toEqual([["wordSpan", false]]);
  });
});

describe("locateKeywordOccurrence", () => {
  const text = "uno dos uno dos";
  const words = text.split(" ");

  it("prefiere los índices de palabra cuando el tramo coincide con el valor", () => {
    const located = locateKeywordOccurrence(
      occurrence("ADDRESS", "uno", { wordSpan: { startIndex: 2, endIndexExclusive: 3 } }),
      text,
      words,
      0,
    );
    expect(located).toMatchObject({ start: 8, end: 11, locatedBy: "wordSpan" });
  });

  it("si el tramo no coincide, ubica por el valor desde el comienzo de la oración", () => {
    const located = locateKeywordOccurrence(
      occurrence("ADDRESS", "dos", { wordSpan: { startIndex: 0, endIndexExclusive: 1 } }),
      text,
      words,
      5,
    );
    expect(located).toMatchObject({ start: 12, end: 15, locatedBy: "value" });
  });

  it("si el valor no está, usa los índices sin verificar, y si tampoco hay, queda sin ubicar", () => {
    const bySpan = locateKeywordOccurrence(
      occurrence("ADDRESS", "otra cosa", { wordSpan: { startIndex: 1, endIndexExclusive: 2 } }),
      text,
      words,
      0,
    );
    expect(bySpan).toMatchObject({ start: 4, end: 7, locatedBy: "wordSpan" });
    const none = locateKeywordOccurrence(occurrence("ADDRESS", "otra cosa"), text, words, 0);
    expect(none).toMatchObject({ start: null, end: null, locatedBy: "unlocated" });
  });
});

describe("combineCoverage y coreParts", () => {
  it("entera si todas lo están, nada si ninguna, en parte en cualquier otro caso", () => {
    expect(combineCoverage(["full", "full"])).toBe("full");
    expect(combineCoverage(["none", "none"])).toBe("none");
    expect(combineCoverage(["full", "none"])).toBe("partial");
    expect(combineCoverage(["partial"])).toBe("partial");
    expect(combineCoverage([])).toBe("none");
  });

  it("el núcleo es el nombre y, si la hay, la altura", () => {
    expect(coreParts(classify("K1-1/n", [])).map((p) => p.part)).toEqual(["nombre", "altura"]);
    expect(coreParts(classify("K6-5/n", [])).map((p) => p.part)).toEqual(["nombre"]);
    expect(coreParts(classify("K8-1/n", []))).toEqual([]);
  });
});
