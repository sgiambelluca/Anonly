import { DEFAULT_PATTERNS_AR } from "@anonly/regex-engine";
import { EntityType } from "@anonly/shared";
import { describe, expect, it } from "vitest";

import {
  ENTITY_TYPE_NAMES,
  SD_VARIANT_IDS,
  sdDegradation,
  SYNTHETIC_CORPUS_IDS,
  countTruthByType,
  countWords,
  cuitCheckDigit,
  ibanCheckDigits,
  type CorpusTruth,
  type SyntheticCorpusId,
} from "./ocrDpiDownCorpus.js";
import { buildSyntheticSource } from "./ocrDpiDownFixtures.js";
import { canonicalValue } from "./ocrDpiDownScoring.js";
import { SR_WORDS_PER_PAGE } from "./ocrDpiDownSr.js";

const REGEX_TYPES: ReadonlyArray<string> = ["DNI", "CUIT", "PHONE", "EMAIL", "IBAN", "DATE"];

/** El valor lo reconoce algún patrón por defecto del motor Regex, con su checksum, sobre su renglón. */
function recognizedByDefaultPatterns(truth: CorpusTruth): ReadonlyArray<string> {
  const unrecognized: string[] = [];
  for (const entity of truth.entities.filter((candidate) => candidate.detector === "regex")) {
    const lines = truth.lines.filter(
      (line) => line.pageIndex === entity.pageIndex && line.text.includes(entity.value),
    );
    const found = lines.some((line) =>
      DEFAULT_PATTERNS_AR.filter((pattern) => String(pattern.entityType) === entity.type).some(
        (pattern) =>
          [...line.text.matchAll(new RegExp(pattern.pattern.source, pattern.pattern.flags))].some(
            (match) => {
              const raw = match[0];
              const normalized = pattern.normalizer === undefined ? raw : pattern.normalizer(raw);
              return (
                canonicalValue(entity.type, raw) === canonicalValue(entity.type, entity.value) &&
                (pattern.checksum === undefined || pattern.checksum(normalized))
              );
            },
          ),
      ),
    );
    if (!found) unrecognized.push(`${entity.type}:${entity.value}`);
  }
  return unrecognized;
}

describe("tipos de entidad de la campaña", () => {
  it("cada nombre de tipo existe en el enum real del Core", () => {
    const real = new Set<string>(Object.values(EntityType).map(String));
    for (const name of ENTITY_TYPE_NAMES) expect(real.has(name)).toBe(true);
  });
});

describe("cuitCheckDigit e ibanCheckDigits", () => {
  it("el CUIT de ejemplo de la documentación cierra con 6", () => {
    expect(cuitCheckDigit("2012345678")).toBe(6);
  });
  it("rechaza una entrada que no son diez dígitos", () => {
    expect(() => cuitCheckDigit("123")).toThrow();
  });
  it("el IBAN de ejemplo de ES cierra con 91", () => {
    expect(ibanCheckDigits("ES", "21000418450200051332")).toBe("91");
  });
});

describe("corpus sintéticos", () => {
  const fixed = ["S12", "S10", "S8", "S6", "SD1", "SD2", "SD3", "SD4", "SD5"] as const;

  it.each(fixed)("%s: 16 entidades, todos los tipos, en un solo renglón cada una", async (id) => {
    const { truth } = await buildSyntheticSource(id);
    expect(truth.entities).toHaveLength(16);
    expect(countTruthByType(truth.entities)).toEqual({
      PERSON: 4,
      DNI: 2,
      CUIT: 2,
      PHONE: 2,
      EMAIL: 2,
      IBAN: 2,
      DATE: 2,
    });
    for (const entity of truth.entities) {
      expect(truth.lines.some((line) => line.text.includes(entity.value))).toBe(true);
      expect(entity.box.width).toBeGreaterThan(0);
    }
    expect(truth.pageCount).toBe(1);
    expect(truth.wordsPerPage[0]).toBeGreaterThan(0);
  });

  it("el tamaño de letra es el del identificador y el relleno crece al achicarla", async () => {
    const sizes = await Promise.all(
      (["S12", "S10", "S8", "S6"] as const).map(async (id) => buildSyntheticSource(id)),
    );
    expect(sizes.map((source) => source.truth.fontSize)).toEqual([12, 10, 8, 6]);
    const words = sizes.map((source) => source.truth.wordsPerPage[0] ?? 0);
    expect(words).toEqual([...words].sort((a, b) => a - b));
    expect(new Set(words).size).toBe(4);
    // Mismas entidades en los cuatro tamaños: lo único que cambia es la letra.
    const values = sizes.map((source) => source.truth.entities.map((entity) => entity.value));
    for (const list of values) expect(list).toEqual(values[0]);
  });

  it("las cinco variantes de SD son S10 con la misma receta y solo cambia la semilla; solo ellas degradan", async () => {
    const s10 = await buildSyntheticSource("S10");
    const seeds = new Set<number>();
    for (const id of SD_VARIANT_IDS) {
      const sd = await buildSyntheticSource(id);
      expect(sd.truth.degradation).toEqual(sdDegradation(id));
      seeds.add(sd.truth.degradation?.seed ?? -1);
      expect({ ...sd.truth.degradation, seed: 0 }).toEqual({ ...sdDegradation("SD1"), seed: 0 });
      expect(sd.truth.text).toBe(s10.truth.text);
      expect(Buffer.from(sd.bytes).equals(Buffer.from(s10.bytes))).toBe(true);
    }
    expect(seeds.size).toBe(5);
    for (const id of SYNTHETIC_CORPUS_IDS.filter(
      (candidate) => !SD_VARIANT_IDS.some((v) => v === candidate),
    ))
      expect((await buildSyntheticSource(id)).truth.degradation).toBeNull();
  });

  it("SE: dos páginas de dos renglones, a 0° y a 180°, con una persona y un DNI por página", async () => {
    const { truth } = await buildSyntheticSource("SE");
    expect(truth.pageCount).toBe(2);
    expect(truth.rotations).toEqual([0, 180]);
    expect(truth.lines).toHaveLength(4);
    expect(truth.entities.map((entity) => [entity.pageIndex, entity.type])).toEqual([
      [0, "PERSON"],
      [0, "DNI"],
      [1, "PERSON"],
      [1, "DNI"],
    ]);
  });

  it.each(SYNTHETIC_CORPUS_IDS)(
    "%s: cada entidad de Regex la reconocen los patrones por defecto del motor",
    async (id: SyntheticCorpusId) => {
      const { truth } = await buildSyntheticSource(id);
      expect(recognizedByDefaultPatterns(truth)).toEqual([]);
      expect(
        truth.entities.some((entity) => REGEX_TYPES.includes(entity.type)),
        "el corpus tiene entidades de Regex",
      ).toBe(true);
    },
  );

  it("es determinista: dos generaciones dan los mismos bytes y la misma verdad", async () => {
    for (const id of SYNTHETIC_CORPUS_IDS) {
      const first = await buildSyntheticSource(id);
      const second = await buildSyntheticSource(id);
      expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
      expect(second.truth).toEqual(first.truth);
    }
  });

  it("control de fallo: un valor fuera de los patrones por defecto se detecta como no reconocido", () => {
    const broken: CorpusTruth = {
      corpus: "S12",
      fontSize: 12,
      pageCount: 1,
      wordsPerPage: [3],
      lineHeightPt: 17,
      marginPt: 50,
      seed: null,
      rotations: null,
      degradation: null,
      lines: [{ pageIndex: 0, text: "CUIT 20-12345678-9 mal" }],
      text: "CUIT 20-12345678-9 mal",
      entities: [
        {
          type: "CUIT",
          value: "20-12345678-9",
          detector: "regex",
          pageIndex: 0,
          box: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    };
    expect(recognizedByDefaultPatterns(broken)).toEqual(["CUIT:20-12345678-9"]);
  });
});

describe("corpus SR", () => {
  it("la cantidad de palabras por página coincide con la lista, y la última página está vacía", async () => {
    const { truth } = await buildSyntheticSource("SR");
    expect(truth.pageCount).toBe(20);
    expect(truth.wordsPerPage).toEqual([...SR_WORDS_PER_PAGE]);
    expect(truth.wordsPerPage[19]).toBe(0);
    expect(truth.lines.some((line) => line.pageIndex === 19)).toBe(false);
  });

  it("la verdad lista nueve entidades en cada página con texto, y ninguna en la vacía", async () => {
    const { truth } = await buildSyntheticSource("SR");
    for (let page = 0; page < 19; page += 1) {
      const onPage = truth.entities.filter((entity) => entity.pageIndex === page);
      expect(onPage, `página ${page}`).toHaveLength(9);
      expect(new Set(onPage.map((entity) => entity.type))).toEqual(new Set(ENTITY_TYPE_NAMES));
      for (const entity of onPage)
        expect(
          truth.lines.some((line) => line.pageIndex === page && line.text.includes(entity.value)),
        ).toBe(true);
    }
    expect(truth.entities.filter((entity) => entity.pageIndex === 19)).toEqual([]);
  });

  it("largo medio de palabra de unos 5 caracteres, Helvetica 12 pt con interlineado 1,5", async () => {
    const { truth } = await buildSyntheticSource("SR");
    const words = truth.text.split(/\s+/).filter(Boolean);
    const mean = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    expect(mean).toBeGreaterThan(4.5);
    expect(mean).toBeLessThan(5.6);
    expect(truth.fontSize).toBe(12);
    expect(truth.lineHeightPt).toBe(18);
    expect(truth.seed).toBe("sr-v1");
  });

  it("el recuento de palabras es el de los renglones dibujados (control del contador)", () => {
    expect(countWords("a  b c")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});
