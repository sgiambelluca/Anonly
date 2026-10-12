import { DEFAULT_PATTERNS_AR } from "@anonly/regex-engine";
import { describe, expect, it } from "vitest";

import {
  KEYWORD_LABELS,
  expectedKeywordAddressDetections,
  isKeywordLabel,
  keywordLinearityVerdict,
  makeKeywordAdversarialText,
} from "./regexWorstCaseKeyword.js";

const KIB = 1024;

function keywordPattern(): RegExp {
  const found = DEFAULT_PATTERNS_AR.find((candidate) => candidate.id === "address-keyword-ar");
  if (found === undefined) throw new Error("falta el patrón address-keyword-ar");
  return new RegExp(found.pattern.source, found.pattern.flags);
}

describe("makeKeywordAdversarialText", () => {
  it("reconoce las etiquetas", () => {
    for (const label of KEYWORD_LABELS) expect(isKeywordLabel(label)).toBe(true);
    expect(isKeywordLabel("adversarial-q")).toBe(false);
    expect(isKeywordLabel("normal")).toBe(false);
  });

  it.each(KEYWORD_LABELS)("%s: tiene el largo pedido y termina en la dirección real", (label) => {
    for (const sizeKiB of [2, 10, 160]) {
      const text = makeKeywordAdversarialText(sizeKiB * KIB, label);
      expect(text).toHaveLength(sizeKiB * KIB);
      expect(
        text.endsWith(
          label === "adversarial-keyword-caps" ? "CALLE TUCUMÁN 1650" : "calle Tucumán 1650",
        ),
      ).toBe(true);
    }
  });

  it.each(KEYWORD_LABELS)("%s: el cuerpo no tiene ningún dígito", (label) => {
    const text = makeKeywordAdversarialText(10 * KIB, label);
    expect(text.slice(0, text.lastIndexOf("1650") - 20)).not.toMatch(/\d/u);
  });

  it.each(KEYWORD_LABELS)("%s: el patrón encuentra una sola dirección, la del final", (label) => {
    for (const sizeKiB of [2, 10]) {
      const text = makeKeywordAdversarialText(sizeKiB * KIB, label);
      const matches = [...text.matchAll(keywordPattern())].map((match) => match[0]);
      expect(matches, `${label} ${sizeKiB} KiB`).toHaveLength(expectedKeywordAddressDetections());
      expect(matches[0]?.endsWith("1650")).toBe(true);
    }
  });

  it("las etiquetas son distintas entre sí", () => {
    const texts = KEYWORD_LABELS.map((label) => makeKeywordAdversarialText(2 * KIB, label));
    expect(new Set(texts).size).toBe(KEYWORD_LABELS.length);
  });

  it("la palabra larga es de 2000 letras y la sola, del largo del texto", () => {
    const long = makeKeywordAdversarialText(10 * KIB, "adversarial-keyword-long-word");
    expect(long).toContain(`A${"a".repeat(1999)}`);
    const single = makeKeywordAdversarialText(10 * KIB, "adversarial-keyword-single-long-word");
    const word = single.split(" ")[1] ?? "";
    expect(word.length).toBeGreaterThan(10 * KIB - 40);
  });

  it("las etiquetas en mayúsculas tienen la dirección del final en mayúsculas", () => {
    expect(makeKeywordAdversarialText(2 * KIB, "adversarial-keyword-caps")).toBe(
      makeKeywordAdversarialText(2 * KIB, "adversarial-keyword-caps").toUpperCase(),
    );
  });
});

describe("keywordLinearityVerdict", () => {
  const label = "adversarial-keyword-street" as const;

  it("una curva lineal no es superlineal", () => {
    const samples = [2, 10, 20, 40, 80, 160].flatMap((sizeKiB) => [
      { sizeKiB, ms: sizeKiB },
      { sizeKiB, ms: sizeKiB * 1.1 },
      { sizeKiB, ms: sizeKiB * 0.9 },
    ]);
    const verdict = keywordLinearityVerdict(label, samples);
    expect(verdict.superLinear).toBe(false);
    expect(verdict.interpretableSteps).toBeGreaterThan(0);
  });

  it("control de fallo: una curva cuadrática es superlineal", () => {
    const samples = [10, 20, 40, 80, 160].map((sizeKiB) => ({ sizeKiB, ms: sizeKiB * sizeKiB }));
    expect(keywordLinearityVerdict(label, samples).superLinear).toBe(true);
  });

  it("por debajo del piso de ruido no se interpreta", () => {
    const samples = [10, 20].map((sizeKiB) => ({ sizeKiB, ms: sizeKiB === 10 ? 0.1 : 0.9 }));
    const verdict = keywordLinearityVerdict(label, samples);
    expect(verdict.superLinear).toBe(false);
    expect(verdict.interpretableSteps).toBe(0);
  });
});
