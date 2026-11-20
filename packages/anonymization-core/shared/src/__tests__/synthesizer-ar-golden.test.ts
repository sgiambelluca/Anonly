/**
 * Valores fijos de `synthesize` con `country: "AR"` (ADR-221 §4, ADR-072).
 *
 * Los literales son los que daba el código ANTES de indexar los generadores
 * por país. Si este test cambia, un documento argentino cambia de valor
 * sintético al actualizar: no se acomoda, se reporta.
 */
import { describe, expect, it } from "vitest";

import { EntityType, type PersonGender } from "../enums.js";
import { synthesize } from "../synthesizer.js";

type GoldenRow = readonly [
  type: string,
  groupId: string,
  seed: string,
  gender: PersonGender | null,
  expected: string,
];

const GOLDEN: ReadonlyArray<GoldenRow> = [
  ["PERSON", "g-1", "seed-x", null, "Ricardo Díaz"],
  ["PERSON", "g-1", "seed-x", "f", "Claudia Díaz"],
  ["PERSON", "g-1", "seed-x", "m", "Ricardo Díaz"],
  ["PERSON", "g-1", "0f3a9c", null, "Laura Vega"],
  ["PERSON", "g-1", "0f3a9c", "f", "Laura Vega"],
  ["PERSON", "g-1", "0f3a9c", "m", "José Vega"],
  ["PERSON", "g-2", "seed-x", null, "Pedro Acosta"],
  ["PERSON", "g-2", "seed-x", "f", "Laura Acosta"],
  ["PERSON", "g-2", "seed-x", "m", "Pedro Acosta"],
  ["PERSON", "g-2", "0f3a9c", null, "Patricia Sánchez"],
  ["PERSON", "g-2", "0f3a9c", "f", "Patricia Sánchez"],
  ["PERSON", "g-2", "0f3a9c", "m", "Fernando Sánchez"],
  ["PERSON", "grupo-ñandú-0042", "seed-x", null, "Sofía Díaz"],
  ["PERSON", "grupo-ñandú-0042", "seed-x", "f", "Sofía Díaz"],
  ["PERSON", "grupo-ñandú-0042", "seed-x", "m", "Diego Díaz"],
  ["PERSON", "grupo-ñandú-0042", "0f3a9c", null, "Ana Acosta"],
  ["PERSON", "grupo-ñandú-0042", "0f3a9c", "f", "Ana Acosta"],
  ["PERSON", "grupo-ñandú-0042", "0f3a9c", "m", "Juan Acosta"],
  ["ORGANIZATION", "g-1", "seed-x", null, "Grupo Norte S.R.L."],
  ["ORGANIZATION", "g-1", "0f3a9c", null, "Comercial del Plata"],
  ["ORGANIZATION", "g-2", "seed-x", null, "Inversiones Sur"],
  ["ORGANIZATION", "g-2", "0f3a9c", null, "Comercial del Plata"],
  ["ORGANIZATION", "grupo-ñandú-0042", "seed-x", null, "Empresa S.A."],
  ["ORGANIZATION", "grupo-ñandú-0042", "0f3a9c", null, "Comercial del Plata"],
  ["ADDRESS", "g-1", "seed-x", null, "Pueyrredón 3501"],
  ["ADDRESS", "g-1", "0f3a9c", null, "Mitre 7754"],
  ["ADDRESS", "g-2", "seed-x", null, "Corrientes 412"],
  ["ADDRESS", "g-2", "0f3a9c", null, "Florida 5998"],
  ["ADDRESS", "grupo-ñandú-0042", "seed-x", null, "Alvear 1141"],
  ["ADDRESS", "grupo-ñandú-0042", "0f3a9c", null, "Florida 446"],
  ["DNI", "g-1", "seed-x", null, "53.195.163"],
  ["DNI", "g-1", "0f3a9c", null, "25.619.830"],
  ["DNI", "g-2", "seed-x", null, "94.125.130"],
  ["DNI", "g-2", "0f3a9c", null, "49.856.822"],
  ["DNI", "grupo-ñandú-0042", "seed-x", null, "15.044.983"],
  ["DNI", "grupo-ñandú-0042", "0f3a9c", null, "15.553.358"],
  ["CUIT", "g-1", "seed-x", null, "23-09119617-4"],
  ["CUIT", "g-1", "0f3a9c", null, "27-52055670-8"],
  ["CUIT", "g-2", "seed-x", null, "20-43677204-2"],
  ["CUIT", "g-2", "0f3a9c", null, "24-45215421-4"],
  ["CUIT", "grupo-ñandú-0042", "seed-x", null, "34-85759423-3"],
  ["CUIT", "grupo-ñandú-0042", "0f3a9c", null, "23-44714079-9"],
  ["PHONE", "g-1", "seed-x", null, "+54 221 3182-7366"],
  ["PHONE", "g-1", "0f3a9c", null, "+54 341 7517-0803"],
  ["PHONE", "g-2", "seed-x", null, "+54 11 6255-7753"],
  ["PHONE", "g-2", "0f3a9c", null, "+54 351 0096-8911"],
  ["PHONE", "grupo-ñandú-0042", "seed-x", null, "+54 341 2992-4219"],
  ["PHONE", "grupo-ñandú-0042", "0f3a9c", null, "+54 351 0764-9575"],
  ["EMAIL", "g-1", "seed-x", null, "user12686@test.net"],
  ["EMAIL", "g-1", "0f3a9c", null, "user77739@anon.ar"],
  ["EMAIL", "g-2", "seed-x", null, "user85831@example.org"],
  ["EMAIL", "g-2", "0f3a9c", null, "user04922@test.net"],
  ["EMAIL", "grupo-ñandú-0042", "seed-x", null, "user40711@anon.ar"],
  ["EMAIL", "grupo-ñandú-0042", "0f3a9c", null, "user75051@anon.ar"],
  ["IBAN", "g-1", "seed-x", null, "FR53 0389 8881 2945 6025 3932"],
  ["IBAN", "g-1", "0f3a9c", null, "FR40 4721 6407 9523 5341 5259"],
  ["IBAN", "g-2", "seed-x", null, "DE56 2629 0219 4781 5919 8054"],
  ["IBAN", "g-2", "0f3a9c", null, "DE51 5114 6211 8183 7104 1440"],
  ["IBAN", "grupo-ñandú-0042", "seed-x", null, "DE45 7860 4069 1020 9879 0422"],
  ["IBAN", "grupo-ñandú-0042", "0f3a9c", null, "FR90 2346 8556 8836 5466 1956"],
  ["CREDIT_CARD", "g-1", "seed-x", null, "5554 8645 4088 1263"],
  ["CREDIT_CARD", "g-1", "0f3a9c", null, "5291 4262 8018 2654"],
  ["CREDIT_CARD", "g-2", "seed-x", null, "5219 7597 6247 6296"],
  ["CREDIT_CARD", "g-2", "0f3a9c", null, "5269 8147 8817 2483"],
  ["CREDIT_CARD", "grupo-ñandú-0042", "seed-x", null, "5511 9580 0682 1441"],
  ["CREDIT_CARD", "grupo-ñandú-0042", "0f3a9c", null, "5554 4184 5667 6041"],
  ["DATE", "g-1", "seed-x", null, "25/08/1966"],
  ["DATE", "g-1", "0f3a9c", null, "07/09/1974"],
  ["DATE", "g-2", "seed-x", null, "20/05/2005"],
  ["DATE", "g-2", "0f3a9c", null, "23/11/1972"],
  ["DATE", "grupo-ñandú-0042", "seed-x", null, "10/04/1986"],
  ["DATE", "grupo-ñandú-0042", "0f3a9c", null, "07/09/1997"],
  ["LICENSE", "g-1", "seed-x", null, "31-9708-87"],
  ["LICENSE", "g-1", "0f3a9c", null, "17-0429-41"],
  ["LICENSE", "g-2", "seed-x", null, "35-9755-38"],
  ["LICENSE", "g-2", "0f3a9c", null, "95-7055-96"],
  ["LICENSE", "grupo-ñandú-0042", "seed-x", null, "52-0061-42"],
  ["LICENSE", "grupo-ñandú-0042", "0f3a9c", null, "02-1011-14"],
  ["PLATE", "g-1", "seed-x", null, "YX 512 PF"],
  ["PLATE", "g-1", "0f3a9c", null, "WY 763 RY"],
  ["PLATE", "g-2", "seed-x", null, "EY 928 MR"],
  ["PLATE", "g-2", "0f3a9c", null, "JH 244 CZ"],
  ["PLATE", "grupo-ñandú-0042", "seed-x", null, "GN 050 SL"],
  ["PLATE", "grupo-ñandú-0042", "0f3a9c", null, "WA 514 HG"],
  ["CUSTOM", "g-1", "seed-x", null, "custom-7"],
  ["CUSTOM", "g-1", "0f3a9c", null, "custom-7"],
  ["CUSTOM", "g-2", "seed-x", null, "custom-7"],
  ["CUSTOM", "g-2", "0f3a9c", null, "custom-7"],
  ["CUSTOM", "grupo-ñandú-0042", "seed-x", null, "custom-7"],
  ["CUSTOM", "grupo-ñandú-0042", "0f3a9c", null, "custom-7"],
];

describe("synthesize — Argentina idéntica (ADR-221 §4)", () => {
  it("covers every EntityType in the golden table", () => {
    const covered = new Set(GOLDEN.map((row) => row[0]));
    for (const type of Object.values(EntityType)) {
      expect(covered.has(type)).toBe(true);
    }
  });

  it.each(GOLDEN)(
    "AR %s %s %s gender=%s gives the pre-country value",
    (type, groupId, seed, gender, expected) => {
      const value = synthesize({
        type: type as EntityType,
        groupId,
        seed,
        indexInType: 7,
        country: "AR",
        ...(gender === null ? {} : { personGender: gender }),
      });
      expect(value).toBe(expected);
    },
  );

  it("does not let indexInType move the value of a sorted type under AR", () => {
    const base = { type: EntityType.CUIT, groupId: "g-1", seed: "seed-x", country: "AR" } as const;
    expect(synthesize({ ...base, indexInType: 1 })).toBe(synthesize({ ...base, indexInType: 99 }));
  });
});
