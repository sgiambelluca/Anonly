import { describe, expect, it } from "vitest";

import {
  boxCoverage,
  canonicalValue,
  compareEntities,
  distributionOf,
  pairBoxCoverage,
  scoreTokens,
  type ObservedEntity,
} from "./ocrDpiDownScoring.js";

const box = (x: number, y = 0, width = 100, height = 10) => ({ x, y, width, height });
const entity = (
  type: string,
  value: string,
  pageIndex = 0,
  at: ReturnType<typeof box> | null = box(0),
): ObservedEntity => ({ type, value, pageIndex, box: at });

describe("canonicalValue", () => {
  it("ignora mayúsculas, diacríticos y separadores", () => {
    expect(canonicalValue("PERSON", "Marina Suárez")).toBe("marinasuarez");
    expect(canonicalValue("DNI", "34.567.891")).toBe("34567891");
    expect(canonicalValue("EMAIL", "Marina.Suarez@Example.com")).toBe("marinasuarezexamplecom");
  });
  it("el teléfono se reduce a sus diez últimos dígitos, con o sin +54", () => {
    expect(canonicalValue("PHONE", "+54 11 4567-8901")).toBe("1145678901");
    expect(canonicalValue("PHONE", "11 4567-8901")).toBe("1145678901");
  });
});

describe("compareEntities", () => {
  const truth = [
    entity("DNI", "34.567.891"),
    entity("EMAIL", "a@x.com"),
    entity("PERSON", "Ana López"),
  ];

  it("lectura idéntica: nada perdido ni agregado", () => {
    const result = compareEntities(truth, [
      entity("DNI", "34567891"),
      entity("EMAIL", "A@X.com"),
      entity("PERSON", "Ana Lopez"),
    ]);
    expect(result.totals).toEqual({ expected: 3, detected: 3, matched: 3, missed: 0, added: 0 });
    expect(result.missed).toEqual([]);
  });

  it("control de fallo: una entidad perdida y una agregada se cuentan por tipo", () => {
    const result = compareEntities(truth, [
      entity("DNI", "34.567.891"),
      entity("PERSON", "Ana López"),
      entity("PHONE", "11 1234 5678"),
    ]);
    expect(result.byType.EMAIL).toEqual({
      expected: 1,
      detected: 0,
      matched: 0,
      missed: 1,
      added: 0,
    });
    expect(result.byType.PHONE).toEqual({
      expected: 0,
      detected: 1,
      matched: 0,
      missed: 0,
      added: 1,
    });
    expect(result.totals.missed).toBe(1);
    expect(result.totals.added).toBe(1);
    expect(result.missed).toEqual([{ type: "EMAIL", pageIndex: 0, value: "a@x.com" }]);
  });

  it("multiconjunto: la misma entidad detectada una vez de dos esperadas pierde una", () => {
    const result = compareEntities(
      [entity("DNI", "1.234.567"), entity("DNI", "1.234.567")],
      [entity("DNI", "1.234.567")],
    );
    expect(result.totals.missed).toBe(1);
  });

  it("la página forma parte de la clave", () => {
    const result = compareEntities(
      [entity("DNI", "1.234.567", 0)],
      [entity("DNI", "1.234.567", 1)],
    );
    expect(result.totals).toMatchObject({ missed: 1, added: 1, matched: 0 });
  });

  it("sin entidades en ninguno de los dos lados no inventa tipos", () => {
    expect(compareEntities([], []).byType).toEqual({});
  });
});

describe("boxCoverage y pairBoxCoverage", () => {
  it("la caja del brazo cubre la de referencia: 1; disjunta: 0; la mitad: 0,5", () => {
    expect(boxCoverage(box(0), box(0))).toBe(1);
    expect(boxCoverage(box(0), box(500))).toBe(0);
    expect(boxCoverage(box(0), box(50))).toBe(0.5);
  });

  it("una caja que crece no penaliza; una que se achica, sí (a diferencia del IoU)", () => {
    expect(boxCoverage(box(0, 0, 100, 10), box(-20, -5, 200, 30))).toBe(1);
    expect(boxCoverage(box(0, 0, 100, 10), box(0, 0, 80, 10))).toBe(0.8);
  });

  it("una referencia sin área no es medible (null, no 0 ni NaN)", () => {
    expect(boxCoverage({ x: 0, y: 0, width: 0, height: 5 }, box(0))).toBeNull();
  });

  it("empareja por clave y devuelve una cobertura por entidad presente en los dos brazos", () => {
    const reference = [
      entity("DNI", "1.234.567", 0, box(0)),
      entity("EMAIL", "a@x.com", 0, box(200)),
    ];
    const candidate = [
      entity("DNI", "1.234.567", 0, box(0)),
      entity("EMAIL", "a@x.com", 0, box(210)),
      entity("PHONE", "11 1234 5678", 0, box(400)),
    ];
    const pairing = pairBoxCoverage(reference, candidate);
    expect(pairing.values).toEqual([0.9, 1]);
    expect(pairing.pairsWithoutBox).toBe(0);
  });

  it("una entidad que falta en un brazo no aporta una cobertura de cero", () => {
    expect(pairBoxCoverage([entity("DNI", "1.234.567")], []).values).toEqual([]);
  });

  it("dos instancias de la misma clave se emparejan por mayor cobertura", () => {
    const pairing = pairBoxCoverage(
      [entity("DNI", "1.234.567", 0, box(0)), entity("DNI", "1.234.567", 0, box(500))],
      [entity("DNI", "1.234.567", 0, box(505)), entity("DNI", "1.234.567", 0, box(0))],
    );
    expect(pairing.values.every((value) => value >= 0.95)).toBe(true);
  });

  it("control de fallo: una entidad común sin caja medible se cuenta, aunque haya otras con caja", () => {
    const pairing = pairBoxCoverage(
      [entity("DNI", "1.234.567", 0, null), entity("EMAIL", "a@x.com", 0, box(0))],
      [entity("DNI", "1.234.567"), entity("EMAIL", "a@x.com", 0, box(0))],
    );
    expect(pairing.values).toEqual([1]);
    expect(pairing.pairsWithoutBox).toBe(1);
  });
});

describe("distributionOf", () => {
  it("una lista vacía es null, no una distribución de ceros", () => {
    expect(distributionOf([])).toBeNull();
    expect(distributionOf([Number.NaN])).toBeNull();
  });
  it("mínimo, mediana, media y cuántos quedan bajo cada cota descriptiva", () => {
    const distribution = distributionOf([1, 1, 0.97, 0.6]);
    expect(distribution).toMatchObject({ count: 4, min: 0.6, max: 1 });
    expect(distribution?.median).toBeCloseTo(0.985, 6);
    expect(distribution?.belowBin["0.99"]).toBe(2);
    expect(distribution?.belowBin["0.5"]).toBe(0);
  });
});

describe("scoreTokens", () => {
  it("lectura completa: recall y precisión 1", () => {
    const score = scoreTokens("Juan Pérez, DNI 34.567.891", "juan perez dni 34567891");
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
  });
  it("control de fallo: un token perdido baja el recall y uno falso baja la precisión", () => {
    const score = scoreTokens("uno dos tres cuatro", "uno dos tres cinco");
    expect(score.recall).toBe(0.75);
    expect(score.precision).toBe(0.75);
    expect(score.matchedTokens).toBe(3);
  });
  it("multiconjunto: repetir un token de más no suma coincidencias", () => {
    expect(scoreTokens("a b", "a a a b").matchedTokens).toBe(2);
  });
  it("sin referencia no hay recall (null), no cero", () => {
    expect(scoreTokens("", "algo").recall).toBeNull();
    expect(scoreTokens("algo", "").precision).toBeNull();
  });
});
