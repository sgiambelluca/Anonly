import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  THIRD_PARTY_CREDITS,
  type ThirdPartyCredit,
} from "../components/toolbar/thirdPartyCredits.js";

const TEXT_FIELDS: ReadonlyArray<keyof ThirdPartyCredit> = [
  "id",
  "title",
  "holder",
  "license",
  "licenseUrl",
  "sourceUrl",
  "changes",
  "usedFor",
];

const URL_FIELDS: ReadonlyArray<keyof ThirdPartyCredit> = ["licenseUrl", "sourceUrl"];

interface GenderLexiconProvenance {
  readonly source: {
    readonly datasetPage: string;
    readonly license: string;
  };
}

// `resolveJsonModule` está en `false` (tsconfig.base.json): no se puede
// `import` el .json. Mismo patrón que `readProtectedPdfFixtureBuffer` en
// render-engine/src/__tests__/fixtures/test-helpers.ts — `fileURLToPath` +
// `import.meta.url` para resolver la ruta, `fs` para leerla.
function readGenderLexiconProvenance(): GenderLexiconProvenance {
  const provenancePath = fileURLToPath(
    new URL(
      "../../../../packages/anonymization-core/grouping-engine/assets/gender-lexicon.provenance.json",
      import.meta.url,
    ),
  );
  return JSON.parse(readFileSync(provenancePath, "utf-8")) as GenderLexiconProvenance;
}

describe("THIRD_PARTY_CREDITS", () => {
  it("no está vacío y toda entrada tiene los ocho campos no vacíos", () => {
    expect(THIRD_PARTY_CREDITS.length).toBeGreaterThan(0);
    for (const credit of THIRD_PARTY_CREDITS) {
      for (const field of TEXT_FIELDS) {
        expect(credit[field].length).toBeGreaterThan(0);
      }
    }
  });

  it("todas las URLs usan esquema https:", () => {
    for (const credit of THIRD_PARTY_CREDITS) {
      for (const field of URL_FIELDS) {
        expect(new URL(credit[field]).protocol).toBe("https:");
      }
    }
  });

  // El test que importa (ADR-070 §5): impide que el crédito visible y la
  // procedencia auditable se desincronicen cuando alguien regenere el
  // artefacto desde otra fuente.
  it("la entrada buenos-aires-nombres-permitidos coincide con gender-lexicon.provenance.json en sourceUrl y license", () => {
    const credit = THIRD_PARTY_CREDITS.find(
      (entry) => entry.id === "buenos-aires-nombres-permitidos",
    );
    expect(credit).toBeDefined();

    const provenance = readGenderLexiconProvenance();
    expect(credit?.sourceUrl).toBe(provenance.source.datasetPage);
    expect(credit?.license).toBe(provenance.source.license);
  });
});
