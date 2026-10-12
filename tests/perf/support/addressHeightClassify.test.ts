import { describe, expect, it } from "vitest";

import {
  checkExpectation,
  classifySentence,
  locateOccurrence,
  type ObservedOccurrence,
} from "./addressHeightClassify.js";
import {
  FILLER_AFTER,
  FILLER_BEFORE,
  expectedPageText,
  type AddressHeightSentence,
} from "./addressHeightSentences.js";

function sentence(id: string, text: string, place: string, number: string): AddressHeightSentence {
  return { id, category: id.charAt(0) as AddressHeightSentence["category"], text, place, number };
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

function classify(s: AddressHeightSentence, occurrences: ReadonlyArray<ObservedOccurrence>) {
  const pageText = expectedPageText(s);
  return classifySentence({ sentence: s, pageText, pageWords: pageText.split(" "), occurrences });
}

const MAIPU = sentence(
  "A1",
  "El demandado tiene domicilio en Maipú 1434 y fue notificado por cédula.",
  "Maipú",
  "1434",
);
const ROSARIO = sentence(
  "E1",
  "El congreso se realizó en Rosario 2019 con gran asistencia.",
  "Rosario",
  "2019",
);
const BELGRANO_D = sentence(
  "D1",
  "La carta documento fue enviada a Belgrano 1950 y volvió sin firmar.",
  "Belgrano",
  "1950",
);

describe("classifySentence", () => {
  it("el modelo marcó solo la calle y la altura queda a la vista", () => {
    const record = classify(MAIPU, [occurrence("ADDRESS", "Maipú")]);
    expect(record.sentenceInPageText).toBe(true);
    expect(record.placeMarked).toBe(true);
    expect(record.addressValues).toEqual(["Maipú"]);
    expect(record.numberInAddress).toBe(false);
    expect(record.adjacent).toBe(true);
    expect(record.yearLike).toBe(false);
  });

  it("la dirección extendida contiene el número", () => {
    const record = classify(MAIPU, [occurrence("ADDRESS", "Maipú 1434")]);
    expect(record.placeMarked).toBe(true);
    expect(record.numberInAddress).toBe(true);
    expect(record.adjacent).toBe(false);
  });

  it("un año pegado a un lugar que la dirección no incluye: queda a la vista y es adyacente", () => {
    const record = classify(ROSARIO, [occurrence("ADDRESS", "Rosario")]);
    expect(record.placeMarked).toBe(true);
    expect(record.numberInAddress).toBe(false);
    expect(record.adjacent).toBe(true);
    expect(record.yearLike).toBe(true);
  });

  it("si la dirección incluye el año, el número queda dentro", () => {
    const record = classify(ROSARIO, [occurrence("ADDRESS", "Rosario 2019")]);
    expect(record.numberInAddress).toBe(true);
    expect(record.yearLike).toBe(true);
  });

  it("el lugar no marcado por el modelo: nada se cuenta como cubierto", () => {
    const record = classify(BELGRANO_D, []);
    expect(record.placeMarked).toBe(false);
    expect(record.numberInAddress).toBe(false);
    expect(record.addressValues).toEqual([]);
  });

  it("una ocurrencia de otro tipo que marca el lugar no cuenta como Address", () => {
    const record = classify(ROSARIO, [occurrence("ORGANIZATION", "Rosario")]);
    expect(record.placeMarked).toBe(false);
  });

  it("el número cubierto por otro tipo se informa con su tipo y no cuenta como dentro de la dirección", () => {
    const h4 = sentence("H4", "Se reunieron en Salta 12/03/2021 por la mañana.", "Salta", "12");
    const record = classify(h4, [
      occurrence("ADDRESS", "Salta"),
      occurrence("DATE", "12/03/2021", { source: "regex" }),
    ]);
    expect(record.numberCoveredByOther).toEqual(["DATE"]);
    expect(record.numberInAddress).toBe(false);
    expect(record.yearLike).toBe(false);
  });

  it("adjacent acepta los conectores de ADR-212 y rechaza otro texto entre medio", () => {
    const connectors: ReadonlyArray<readonly [string, string, boolean]> = [
      ["Maipú N° 1434", "Maipú", true],
      ["Maipú Nº 1434", "Maipú", true],
      ["Maipú nro. 1434", "Maipú", true],
      ["Maipú Nro 1434", "Maipú", true],
      ["Maipú número 1434", "Maipú", true],
      ["Maipú al 1434", "Maipú", true],
      ["Maipú No. 1434", "Maipú", true],
      ["Maipú esquina 1434", "Maipú", false],
    ];
    for (const [fragment, place, expected] of connectors) {
      const s = sentence("G1", `Vive en ${fragment} hace años.`, place, "1434");
      const record = classify(s, [occurrence("ADDRESS", place)]);
      expect(record.adjacent, fragment).toBe(expected);
    }
  });

  it("ubica por palabras cuando el valor no aparece en el texto", () => {
    const pageText = expectedPageText(MAIPU);
    const pageWords = pageText.split(" ");
    const start = pageWords.indexOf("Maipú");
    const record = classifySentence({
      sentence: MAIPU,
      pageText,
      pageWords,
      occurrences: [
        occurrence("ADDRESS", "Maipu?", {
          wordSpan: { startIndex: start, endIndexExclusive: start + 2 },
        }),
      ],
    });
    expect(record.occurrences[0]?.locatedBy).toBe("wordSpan");
    expect(record.placeMarked).toBe(true);
    expect(record.numberInAddress).toBe(true);
  });

  it("una ocurrencia que no se puede ubicar se cuenta aparte y no marca nada", () => {
    const record = classify(MAIPU, [occurrence("ADDRESS", "Otra cosa")]);
    expect(record.unlocatedOccurrences).toBe(1);
    expect(record.placeMarked).toBe(false);
    expect(record.addressValues).toEqual(["Otra cosa"]);
  });

  it("si la oración no está en el texto extraído, no se afirma nada", () => {
    const record = classifySentence({
      sentence: MAIPU,
      pageText: `${FILLER_BEFORE} otra cosa ${FILLER_AFTER}`,
      pageWords: [],
      occurrences: [occurrence("ADDRESS", "Maipú")],
    });
    expect(record.sentenceInPageText).toBe(false);
    expect(record.placeMarked).toBe(false);
    expect(record.numberInAddress).toBe(false);
  });
});

describe("locateOccurrence", () => {
  it("prefiere la aparición dentro de la oración y cae al resto de la página si no está", () => {
    const text = "Maipú aquí. Maipú allá.";
    const located = locateOccurrence(occurrence("ADDRESS", "Maipú"), text, [], 12);
    expect(located.start).toBe(12);
    const fallback = locateOccurrence(occurrence("ADDRESS", "aquí"), text, [], 12);
    expect(fallback.start).toBe(6);
  });

  it("un wordSpan fuera de rango queda sin ubicar", () => {
    const located = locateOccurrence(
      occurrence("ADDRESS", "zzz", { wordSpan: { startIndex: 5, endIndexExclusive: 9 } }),
      "uno dos",
      ["uno", "dos"],
      0,
    );
    expect(located.locatedBy).toBe("unlocated");
  });
});

describe("checkExpectation", () => {
  it("alcanzó lo esperado: altura que no parece año, dentro", () => {
    const record = classify(MAIPU, [occurrence("ADDRESS", "Maipú 1434")]);
    expect(checkExpectation(record)).toEqual({
      asExpected: true,
      expected: "inside",
      reason: null,
    });
  });

  it("altura esperada dentro que queda a la vista: desvío con motivo", () => {
    const record = classify(MAIPU, [occurrence("ADDRESS", "Maipú")]);
    const check = checkExpectation(record);
    expect(check.asExpected).toBe(false);
    expect(check.reason).toContain("quedó a la vista");
  });

  it("categoría D: la altura con forma de año dentro es lo esperado; a la vista es un desvío", () => {
    const inside = checkExpectation(classify(BELGRANO_D, [occurrence("ADDRESS", "Belgrano 1950")]));
    expect(inside).toEqual({ asExpected: true, expected: "inside", reason: null });
    const visible = checkExpectation(classify(BELGRANO_D, [occurrence("ADDRESS", "Belgrano")]));
    expect(visible.asExpected).toBe(false);
    expect(visible.expected).toBe("inside");
    expect(visible.reason).toContain("quedó a la vista");
  });

  it("categoría E: el año dentro es lo esperado (tapado de más); a la vista es un desvío", () => {
    const inside = checkExpectation(classify(ROSARIO, [occurrence("ADDRESS", "Rosario 2019")]));
    expect(inside).toEqual({ asExpected: true, expected: "inside", reason: null });
    const visible = checkExpectation(classify(ROSARIO, [occurrence("ADDRESS", "Rosario")]));
    expect(visible.asExpected).toBe(false);
    expect(visible.reason).toContain("quedó a la vista");
  });

  it("H4: el número que la forma excluye se espera sin tocar; dentro es un desvío", () => {
    const h4 = sentence("H4", "Se reunieron en Salta 12/03/2021 por la mañana.", "Salta", "12");
    const untouched = checkExpectation(classify(h4, [occurrence("ADDRESS", "Salta")]));
    expect(untouched).toEqual({ asExpected: true, expected: "untouched", reason: null });
    const inside = checkExpectation(classify(h4, [occurrence("ADDRESS", "Salta 12")]));
    expect(inside.asExpected).toBe(false);
    expect(inside.reason).toContain("tapado de más");
  });

  it("sin el lugar marcado, no es un desvío de la regla", () => {
    const check = checkExpectation(classify(MAIPU, []));
    expect(check.asExpected).toBe(true);
    expect(check.reason).toContain("límite del modelo");
  });
});
