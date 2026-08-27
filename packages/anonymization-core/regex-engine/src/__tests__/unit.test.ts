import {
  EngineEvents,
  EntityType,
  type EngineContext,
  type EntityFound,
  type Page,
  type Word,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DEFAULT_PATTERNS_AR } from "../patterns/default-ar.js";
import { RegexEngine } from "../regex.engine.js";

import {
  createEngineContext,
  makeDocument,
  makeEmptyPage,
  makePage,
  makePageFromWords,
  makeSinglePageDocument,
  makeWord,
} from "./fixtures/test-helpers.js";

async function firstOccurrence(
  engine: RegexEngine,
  ctx: EngineContext,
  tokens: ReadonlyArray<string>,
): Promise<EntityFound["occurrence"] | undefined> {
  const busEmitSpy = vi.spyOn(ctx.bus, "emit");
  const document = makeSinglePageDocument(`doc-${Math.random()}`, tokens);
  await engine.process({ document }, ctx);
  const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
  return (call?.[2] as EntityFound | undefined)?.occurrence;
}

/*
 * Variante de `firstOccurrence` para texto rotado (ADR-066 §6): los helpers
 * compartidos arman words horizontales, y acá hace falta fijar `rotation` por
 * palabra. Las cajas son verticales (alto por texto, ancho por cuerpo), como
 * las que produce `pdf-engine` para un run a 90°.
 */
async function firstOccurrenceOfRotatedPage(
  engine: RegexEngine,
  ctx: EngineContext,
  tokens: ReadonlyArray<{ readonly text: string; readonly rotation?: 90 | 180 | 270 }>,
): Promise<EntityFound["occurrence"] | undefined> {
  let y = 100;
  const words: Word[] = tokens.map(({ text, rotation }) => {
    const height = Math.max(text.length * 6, 1);
    const word: Word = {
      text,
      bbox: { x: 30, y, width: 8, height, ...(rotation !== undefined ? { rotation } : {}) },
      pageIndex: 0,
      confidence: 1.0,
      source: "pdf",
    };
    y += height + 10;
    return word;
  });
  const page: Page = {
    index: 0,
    width: 595,
    height: 842,
    words,
    text: words.map((w) => w.text).join(" "),
    requiresOCR: false,
    ocrCompleted: false,
  };

  const busEmitSpy = vi.spyOn(ctx.bus, "emit");
  await engine.process({ document: makeDocument(`doc-${Math.random()}`, [page]) }, ctx);
  const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
  return (call?.[2] as EntityFound | undefined)?.occurrence;
}

describe("RegexEngine — unit tests", () => {
  let engine: RegexEngine;
  let ctx: EngineContext;

  beforeEach(async () => {
    engine = new RegexEngine();
    ctx = createEngineContext();
    await engine.init(ctx);
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  describe("DEFAULT_PATTERNS_AR — contrato de datos", () => {
    it("contiene exactamente los 14 patrones default de Regex_Engine.md (ADR-096)", () => {
      const ids = DEFAULT_PATTERNS_AR.map((p) => p.id).sort();
      expect(ids).toEqual(
        [
          "caratula-ar",
          "credit-card",
          "cuit-ar",
          "date-ar",
          "date-textual-ar",
          "dni-ar",
          "email",
          "iban",
          "license-ar",
          "phone-landline-ar",
          "phone-mobile-ar",
          "plate-mercosur-ar",
          "plate-mercosur-moto-ar",
          "plate-vieja-ar",
        ].sort(),
      );
    });

    it("maskFormat por tipo coincide con ADR-012 (Plate: ADR-029, ambas variantes)", () => {
      const byId = new Map(DEFAULT_PATTERNS_AR.map((p) => [p.id, p.maskFormat]));
      expect(byId.get("dni-ar")).toBe("XX.XXX.XXX");
      expect(byId.get("cuit-ar")).toBe("XX-XXXXXXXX-X");
      expect(byId.get("phone-mobile-ar")).toBe("+XX XXX XXX-XXXX");
      expect(byId.get("phone-landline-ar")).toBe("+XX XXX XXX-XXXX");
      expect(byId.get("email")).toBe("xxxx@xxxx.xx");
      expect(byId.get("iban")).toBe("XX00 XXXX XXXX XXXX XXXX");
      expect(byId.get("credit-card")).toBe("XXXX XXXX XXXX XXXX");
      expect(byId.get("date-ar")).toBe("XX/XX/XXXX");
      expect(byId.get("date-textual-ar")).toBe("XX/XX/XXXX");
      expect(byId.get("license-ar")).toBe("XX-XXXX-XX");
      // ADR-029 §2 / ADR-096 §2: cada variante de patente lleva su propio
      // maskFormat, fiel a su forma real — incluida la de motovehículo.
      expect(byId.get("plate-vieja-ar")).toBe("XXX XXX");
      expect(byId.get("plate-mercosur-ar")).toBe("XX XXX XX");
      expect(byId.get("plate-mercosur-moto-ar")).toBe("X XXX XXX");
    });
  });

  describe("DNI (caso 3, §14: exacto)", () => {
    it("DNI with and without dots normalizes to same", async () => {
      const document = makeSinglePageDocument("doc-dni-dots", ["34.567.891", "34567891"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(2);
      const calls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      const values = calls.map((c) => (c[2] as EntityFound).occurrence.normalizedValue);
      expect(values).toEqual(["34567891", "34567891"]);
      for (const c of calls) {
        expect((c[2] as EntityFound).occurrence.entityType).toBe(EntityType.DNI);
      }
    });
  });

  describe("CUIT", () => {
    it("valid CUIT matches and passes checksum", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["CUIT", "20-34567891-4"]);
      expect(occurrence?.entityType).toBe(EntityType.CUIT);
      expect(occurrence?.normalizedValue).toBe("20345678914");
      expect(occurrence?.value).toBe("20-34567891-4");
    });

    it("CUIT without dashes also matches", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["20345678914"]);
      expect(occurrence?.entityType).toBe(EntityType.CUIT);
      expect(occurrence?.normalizedValue).toBe("20345678914");
    });

    it("CUIT inválido con guiones deja expuesto un match de Phone más largo (overlap, caso 10)", async () => {
      // Comportamiento emergente correcto, no un bug: al fallar el checksum
      // del CUIT (dígito verificador 3 en vez de 4), ese match se descarta
      // (caso 4). Los guiones "20-34567891-3" también calzan con la forma
      // \d{2}-\d{4}\d{4} de phone-mobile-ar ("20-3456" + "7891", 11
      // caracteres, con \b real antes de "20" y después de "7891" — antes de
      // el guión final), que es MÁS LARGO que el DNI de 8 dígitos embebido
      // ("34567891") y gana la resolución de overlaps. edge.test.ts usa la
      // variante SIN guiones para aislar el caso 4 puro (0 ocurrencias, sin
      // ningún competidor \b-anclado posible).
      const occurrence = await firstOccurrence(engine, ctx, ["20-34567891-3"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.value).toBe("20-34567891");
    });
  });

  describe("Phone", () => {
    it("AR mobile phone with +54 prefix matches", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["+54", "11", "1234-5678"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.normalizedValue).toBe("541112345678");
    });

    it("AR landline phone matches", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["011", "41234567"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.normalizedValue).toBe("01141234567");
    });
  });

  // ADR-093: la característica telefónica argentina no siempre tiene dos
  // dígitos — lo invariante es que característica + abonado suman 10.
  describe("Phone móvil — característica de 2/3/4 dígitos (ADR-093)", () => {
    // Los cinco ejemplos literales de ADR-093 §1 Contexto: uno detectado ya
    // antes de este ADR (CABA, característica de 2) y cuatro que "NO
    // DETECTA" con el patrón viejo — cada uno con y sin el prefijo "+54".
    const casos: ReadonlyArray<{
      readonly ciudad: string;
      readonly sinPrefijo: string;
      readonly normalizedSinPrefijo: string;
      readonly normalizedConPrefijo: string;
    }> = [
      {
        ciudad: "CABA (característica de 2)",
        sinPrefijo: "11 4567-8900",
        normalizedSinPrefijo: "1145678900",
        normalizedConPrefijo: "541145678900",
      },
      {
        ciudad: "La Plata (característica de 3)",
        sinPrefijo: "221 456-7890",
        normalizedSinPrefijo: "2214567890",
        normalizedConPrefijo: "542214567890",
      },
      {
        ciudad: "Rosario (característica de 3)",
        sinPrefijo: "341 456-7890",
        normalizedSinPrefijo: "3414567890",
        normalizedConPrefijo: "543414567890",
      },
      {
        ciudad: "Córdoba (característica de 3)",
        sinPrefijo: "351 456-7890",
        normalizedSinPrefijo: "3514567890",
        normalizedConPrefijo: "543514567890",
      },
      {
        ciudad: "Santa Rosa (característica de 4)",
        sinPrefijo: "2954 12-3456",
        normalizedSinPrefijo: "2954123456",
        normalizedConPrefijo: "542954123456",
      },
    ];

    it.each(casos)(
      "$ciudad — sin prefijo de país",
      async ({ sinPrefijo, normalizedSinPrefijo }) => {
        const document = makeSinglePageDocument(`doc-caract-${sinPrefijo}`, sinPrefijo.split(" "));
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        await engine.process({ document }, ctx);
        const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
        const occurrence = (call?.[2] as EntityFound | undefined)?.occurrence;
        expect(occurrence?.entityType, sinPrefijo).toBe(EntityType.Phone);
        expect(occurrence?.normalizedValue, sinPrefijo).toBe(normalizedSinPrefijo);
      },
    );

    it.each(casos)("$ciudad — con prefijo +54", async ({ sinPrefijo, normalizedConPrefijo }) => {
      const tokens = [`+54`, ...sinPrefijo.split(" ")];
      const document = makeSinglePageDocument(`doc-caract-prefijo-${sinPrefijo}`, tokens);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
      const occurrence = (call?.[2] as EntityFound | undefined)?.occurrence;
      expect(occurrence?.entityType, sinPrefijo).toBe(EntityType.Phone);
      expect(occurrence?.normalizedValue, sinPrefijo).toBe(normalizedConPrefijo);
    });

    // ADR-093 §1: el `9` opcional del formato de móvil internacional.
    it('"+54 9 11 4567-8900" matches (formato de móvil internacional)', async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["+54", "9", "11", "4567-8900"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.normalizedValue).toBe("5491145678900");
    });

    // No-regresión: `phone-landline-ar` no se toca (ADR-093 §3) y sigue
    // tomando el formato nacional con "0" inicial. La nueva alternancia de
    // tres ramas de phone-mobile-ar no puede matchear "0221-4567890" (ningún
    // agrupamiento de 10 dígitos se alinea con los `\b` reales del string,
    // que solo existen antes de "0221", a los dos lados del guion y al
    // final) — si esto cambiara, el teléfono se contaría dos veces.
    it('"0221-4567890" sigue siendo tomado por phone-landline-ar, sin cambios', async () => {
      const document = makeSinglePageDocument("doc-landline-no-regression", ["0221-4567890"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(1);
      const phoneOccurrences = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => o.entityType === EntityType.Phone);
      expect(phoneOccurrences).toHaveLength(1);
      expect(phoneOccurrences[0]?.value).toBe("0221-4567890");
      expect(phoneOccurrences[0]?.normalizedValue).toBe("02214567890");
    });

    // ADR-093 §2: el falso positivo del CUIT es preexistente (v1.6.1/v1.6.2)
    // y este ADR no lo toca — mismo valor, mismo mecanismo (checksum del
    // CUIT falla, y "20-12345678" gana la resolución de overlaps por ser más
    // largo que el DNI de 8 dígitos embebido). Se afirma acá, con la
    // alternancia nueva ya en juego, para que quede registrado que el cambio
    // no lo introdujo ni lo movió.
    it('"CUIT 20-12345678-9" sigue produciendo el mismo falso positivo, sin cambios (ADR-093 §2)', async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["CUIT", "20-12345678-9"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.value).toBe("20-12345678");
      expect(occurrence?.normalizedValue).toBe("2012345678");
    });

    // ADR-093 §1, tabla de medición: las ocho trampas contra las que se midió
    // el patrón enumerado (7 de ellas no deben emitir Phone; la octava es el
    // CUIT de arriba, que sí emite y está documentada aparte). Ninguna suma
    // exactamente 10 dígitos en una corrida contigua de dígitos/separadores
    // `[\s-]`, que es justo lo que la alternancia de tres ramas exige.
    describe("las ocho trampas medidas — siete que no deben emitir Phone", () => {
      const trampas: ReadonlyArray<{ readonly nombre: string; readonly tokens: string[] }> = [
        {
          nombre: "expediente (PP-13-00-027653-24/00, ADR-075 §2)",
          tokens: ["PP-13-00-027653-24/00"],
        },
        { nombre: "DNI con puntos", tokens: ["DNI", "34.567.891"] },
        {
          nombre: "tarjeta (tres grupos de 4, ADR-093 §1)",
          tokens: ["4532", "1234", "5678"],
        },
        { nombre: "fecha con barras", tokens: ["Fecha", "07/07/2026"] },
        {
          nombre: "IBAN (tres grupos de 4, ADR-093 §1)",
          tokens: ["1234", "5678", "9012"],
        },
        {
          nombre: "paginación, con palabra que corta la corrida",
          tokens: ["Página", "4567", "de", "8901"],
        },
        {
          nombre: "dos números sueltos adyacentes (ADR-093 §1)",
          tokens: ["expediente", "1234", "5678"],
        },
      ];

      it.each(trampas)("$nombre no emite Phone", async ({ tokens }) => {
        const document = makeSinglePageDocument(`doc-trampa-${tokens.join("-")}`, tokens);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        await engine.process({ document }, ctx);
        const phoneOccurrences = busEmitSpy.mock.calls
          .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
          .map(([, , payload]) => (payload as EntityFound).occurrence)
          .filter((o) => o.entityType === EntityType.Phone);
        expect(phoneOccurrences, tokens.join(" ")).toHaveLength(0);
      });
    });
  });

  // ADR-096 §4: el abonado se escribe partido, y el patrón de antes exigía
  // un solo bloque de dígitos. Apareció solo, en la corrida del evaluador.
  describe("Phone fijo — separador partido en el abonado (ADR-096 §4)", () => {
    it('"011 4567-8902" emite Phone', async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["011", "4567-8902"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.normalizedValue).toBe("01145678902");
    });

    // No-regresión: la forma que ya funcionaba sigue funcionando.
    it('"0221-4567890" sigue emitiendo Phone (no regresión)', async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["0221-4567890"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.normalizedValue).toBe("02214567890");
    });
  });

  describe("Email", () => {
    it("valid email matches and normalizes to lowercase", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["Juan.Perez@Example.COM"]);
      expect(occurrence?.entityType).toBe(EntityType.Email);
      expect(occurrence?.normalizedValue).toBe("juan.perez@example.com");
    });
  });

  describe("IBAN", () => {
    it("valid IBAN (ES91...) matches and passes ISO 13616 checksum", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["ES9121000418450200051332"]);
      expect(occurrence?.entityType).toBe(EntityType.IBAN);
      expect(occurrence?.normalizedValue).toBe("ES9121000418450200051332");
    });

    // ADR-096 §3: ISO 13616 recomienda imprimir el IBAN en grupos de cuatro
    // separados por espacios — la forma en que aparece en cualquier
    // documento — y el patrón de antes no admitía espacios internos, o sea
    // que detectaba solo la forma que nadie escribe. Ejemplo literal del ADR.
    it("valid IBAN printed with spaces (ISO 13616 grouping) matches", async () => {
      const occurrence = await firstOccurrence(engine, ctx, [
        "ES05",
        "7068",
        "9876",
        "9644",
        "6251",
        "9569",
      ]);
      expect(occurrence?.entityType).toBe(EntityType.IBAN);
      expect(occurrence?.normalizedValue).toBe("ES0570689876964462519569");
    });

    // La red sigue puesta: un IBAN impreso con espacios pero con el dígito
    // verificador incorrecto sigue sin emitir.
    it("IBAN printed with spaces but invalid checksum is discarded", async () => {
      const document = makeSinglePageDocument("doc-iban-spaced-invalid", [
        "ES05",
        "7068",
        "9876",
        "9644",
        "6251",
        "9560",
      ]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });

    it("invalid IBAN checksum is discarded", async () => {
      const document = makeSinglePageDocument("doc-iban-invalid", ["ES9121000418450200051333"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });

  describe("CreditCard", () => {
    it("valid Luhn credit card matches", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["4111111111111111"]);
      expect(occurrence?.entityType).toBe(EntityType.CreditCard);
      expect(occurrence?.normalizedValue).toBe("4111111111111111");
    });
  });

  describe("Date", () => {
    it("date with 4-digit year normalizes to DD/MM/YYYY unchanged", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["15/03/1990"]);
      expect(occurrence?.entityType).toBe(EntityType.Date);
      expect(occurrence?.normalizedValue).toBe("15/03/1990");
    });

    it("date with 2-digit year pivots to 19XX/20XX and pads day/month", async () => {
      const occurrenceOld = await firstOccurrence(engine, ctx, ["5-6-91"]);
      expect(occurrenceOld?.normalizedValue).toBe("05/06/1991");

      const occurrenceNew = await firstOccurrence(engine, ctx, ["5-6-05"]);
      expect(occurrenceNew?.normalizedValue).toBe("05/06/2005");
    });

    it("date with day/month out of range is discarded", async () => {
      const document = makeSinglePageDocument("doc-date-invalid", ["35/13/2020"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });

  describe("Fechas escritas en texto (ADR-075 §1)", () => {
    it('"Quilmes, 07 de julio de 2026" is detected as a Date', async () => {
      const occurrence = await firstOccurrence(engine, ctx, [
        "Quilmes,",
        "07",
        "de",
        "julio",
        "de",
        "2026",
      ]);
      expect(occurrence?.entityType).toBe(EntityType.Date);
      expect(occurrence?.normalizedValue).toBe("07/07/2026");
    });

    it("textual and numeric dates produce the same normalizedValue", async () => {
      const textual = await firstOccurrence(engine, ctx, ["07", "de", "julio", "de", "2026"]);
      const numeric = await firstOccurrence(engine, ctx, ["7/7/2026"]);
      expect(textual?.normalizedValue).toBe(numeric?.normalizedValue);
    });

    it('ordinal day, "del", "setiembre" and uppercase all match', async () => {
      const ordinalDegree = await firstOccurrence(engine, ctx, ["1º", "de", "julio", "de", "2026"]);
      expect(ordinalDegree?.normalizedValue).toBe("01/07/2026");

      const ordinalMasculine = await firstOccurrence(engine, ctx, [
        "1°",
        "de",
        "julio",
        "de",
        "2026",
      ]);
      expect(ordinalMasculine?.normalizedValue).toBe("01/07/2026");

      const noOrdinal = await firstOccurrence(engine, ctx, ["1", "de", "julio", "de", "2026"]);
      expect(noOrdinal?.normalizedValue).toBe("01/07/2026");

      const del = await firstOccurrence(engine, ctx, ["7", "de", "julio", "del", "2026"]);
      expect(del?.normalizedValue).toBe("07/07/2026");

      const setiembre = await firstOccurrence(engine, ctx, ["7", "de", "setiembre", "de", "2026"]);
      expect(setiembre?.normalizedValue).toBe("07/09/2026");
      const septiembre = await firstOccurrence(engine, ctx, [
        "7",
        "de",
        "septiembre",
        "de",
        "2026",
      ]);
      expect(septiembre?.normalizedValue).toBe("07/09/2026");

      const uppercase = await firstOccurrence(engine, ctx, [
        "QUILMES,",
        "07",
        "DE",
        "JULIO",
        "DE",
        "2026",
      ]);
      expect(uppercase?.entityType).toBe(EntityType.Date);
      expect(uppercase?.normalizedValue).toBe("07/07/2026");
    });
  });

  describe("License", () => {
    it("professional license matches and normalizes", async () => {
      // ADR-096 §1: la cola de un dígito (`-6`) no es una de las once formas
      // medidas, pero estaba acá y en el `maskFormat` desde ADR-012. El
      // patrón la conserva a propósito: sin ella el valor saldría como
      // "MP-12345" y el "-6" quedaría a la vista.
      const occurrence = await firstOccurrence(engine, ctx, ["MP-12345-6"]);
      expect(occurrence?.entityType).toBe(EntityType.License);
      expect(occurrence?.normalizedValue).toBe("MP123456");
    });

    // ADR-096 §1, Validación: las 11 formas reales medidas emiten License,
    // y la alternativa vieja se retira sin perder ninguna.
    describe("las 11 formas medidas (ADR-096 §1)", () => {
      const forms: ReadonlyArray<{ readonly nombre: string; readonly tokens: string[] }> = [
        { nombre: "MN 12345", tokens: ["MN", "12345"] },
        { nombre: "MP 23456", tokens: ["MP", "23456"] },
        { nombre: "MN 45.318 (separador de miles)", tokens: ["MN", "45.318"] },
        { nombre: "MP 9.328 (separador de miles)", tokens: ["MP", "9.328"] },
        { nombre: "M.P. 34567 (abreviatura con puntos)", tokens: ["M.P.", "34567"] },
        { nombre: "M.N. 56789 (abreviatura con puntos)", tokens: ["M.N.", "56789"] },
        { nombre: "MN12345 (sin separador)", tokens: ["MN12345"] },
        { nombre: "MP-12345 (guión)", tokens: ["MP-12345"] },
        { nombre: "M.P.-34567 (puntos + guión)", tokens: ["M.P.-34567"] },
        {
          nombre: "Matrícula Profesional 40097 (número pelado anclado en la etiqueta)",
          tokens: ["Matrícula", "Profesional", "40097"],
        },
        {
          nombre: "Matrícula profesional: MP 61852 (etiqueta + prefijo)",
          tokens: ["Matrícula", "profesional:", "MP", "61852"],
        },
      ];

      it.each(forms)("$nombre emite License", async ({ tokens }) => {
        const document = makeSinglePageDocument(`doc-license-${tokens.join("-")}`, tokens);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        await engine.process({ document }, ctx);
        const licenseOccurrences = busEmitSpy.mock.calls
          .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
          .map(([, , payload]) => (payload as EntityFound).occurrence)
          .filter((o) => o.entityType === EntityType.License);
        expect(licenseOccurrences, tokens.join(" ")).toHaveLength(1);
      });
    });

    // ADR-096 §1: el falso positivo que la alternativa vieja aportaba y que
    // se retira junto con ella — sin la etiqueta como ancla, "A-12345" de un
    // número de expediente no es distinguible de una matrícula.
    it('"Expediente A-12345" does NOT emit License (retired false positive)', async () => {
      const document = makeSinglePageDocument("doc-expediente-a-12345", ["Expediente", "A-12345"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const licenseOccurrences = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => o.entityType === EntityType.License);
      expect(licenseOccurrences).toHaveLength(0);
    });
  });

  describe("Plate", () => {
    it("AR plate vieja matches and carries its own maskFormat (ADR-029)", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["ABC", "123"]);
      expect(occurrence?.entityType).toBe(EntityType.Plate);
      expect(occurrence?.normalizedValue).toBe("ABC123");
      expect(occurrence?.maskFormat).toBe("XXX XXX");
    });

    it("AR plate Mercosur matches and carries its own maskFormat (ADR-029)", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["AB", "123", "CD"]);
      expect(occurrence?.entityType).toBe(EntityType.Plate);
      expect(occurrence?.normalizedValue).toBe("AB123CD");
      expect(occurrence?.maskFormat).toBe("XX XXX XX");
    });

    it("AR plate motovehículo Mercosur matches and carries its own maskFormat (ADR-096 §2)", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["A", "456", "EFG"]);
      expect(occurrence?.entityType).toBe(EntityType.Plate);
      expect(occurrence?.normalizedValue).toBe("A456EFG");
      expect(occurrence?.maskFormat).toBe("X XXX XXX");
    });

    // ADR-096 §2, Validación: las 8 formas medidas (las tres estructuras,
    // con los tres separadores), incluidas las dos de motovehículo.
    describe("las 8 formas medidas (ADR-096 §2)", () => {
      const forms: ReadonlyArray<{ readonly nombre: string; readonly tokens: string[] }> = [
        { nombre: "ABC 123 (vieja, espacio)", tokens: ["ABC", "123"] },
        { nombre: "ABC123 (vieja, sin separador)", tokens: ["ABC123"] },
        { nombre: "ABC-123 (vieja, guión — transcripción)", tokens: ["ABC-123"] },
        { nombre: "AB 123 CD (Mercosur auto, espacio)", tokens: ["AB", "123", "CD"] },
        { nombre: "AB123CD (Mercosur auto, sin separador)", tokens: ["AB123CD"] },
        { nombre: "AB-123-CD (Mercosur auto, guión)", tokens: ["AB-123-CD"] },
        { nombre: "A 123 BCD (Mercosur moto, espacio)", tokens: ["A", "123", "BCD"] },
        { nombre: "A456EFG (Mercosur moto, sin separador)", tokens: ["A456EFG"] },
      ];

      it.each(forms)("$nombre emite Plate", async ({ tokens }) => {
        const document = makeSinglePageDocument(`doc-plate-${tokens.join("-")}`, tokens);
        const busEmitSpy = vi.spyOn(ctx.bus, "emit");
        await engine.process({ document }, ctx);
        const plateOccurrences = busEmitSpy.mock.calls
          .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
          .map(([, , payload]) => (payload as EntityFound).occurrence)
          .filter((o) => o.entityType === EntityType.Plate);
        expect(plateOccurrences, tokens.join(" ")).toHaveLength(1);
      });
    });
  });

  describe("occurrence.maskFormat (ADR-029)", () => {
    it("every emitted occurrence carries the maskFormat of the pattern that matched it", async () => {
      const document = makeSinglePageDocument("doc-maskformat-all", [
        "DNI",
        "34.567.891",
        "CUIT",
        "20-34567891-4",
        "email",
        "ana@example.com",
        "patente",
        "ABC",
        "123",
        "y",
        "AB",
        "123",
        "CD",
      ]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);

      const occurrences = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map((c) => (c[2] as EntityFound).occurrence);

      const byType = new Map(occurrences.map((o) => [`${o.entityType}:${o.value}`, o.maskFormat]));
      expect(byType.get("DNI:34.567.891")).toBe("XX.XXX.XXX");
      expect(byType.get("CUIT:20-34567891-4")).toBe("XX-XXXXXXXX-X");
      expect(byType.get("EMAIL:ana@example.com")).toBe("xxxx@xxxx.xx");
      expect(byType.get("PLATE:ABC 123")).toBe("XXX XXX");
      expect(byType.get("PLATE:AB 123 CD")).toBe("XX XXX XX");
    });

    it("a custom pattern's occurrence carries its own maskFormat", async () => {
      engine.addPattern({
        id: "custom-code",
        entityType: EntityType.Custom,
        pattern: /\bCODE-\d{4}\b/g,
        normalizer: (v: string) => v.toUpperCase(),
        maskFormat: "CODE-XXXX",
      });

      const occurrence = await firstOccurrence(engine, ctx, ["Referencia", "CODE-1234"]);
      expect(occurrence?.entityType).toBe(EntityType.Custom);
      expect(occurrence?.maskFormat).toBe("CODE-XXXX");
    });
  });

  describe("Word span / bbox mapping", () => {
    it("maps a multi-word match to the correct wordSpan and union bbox", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["AB", "123", "CD"]);
      expect(occurrence?.wordSpan).toEqual({ startIndex: 0, endIndexExclusive: 3 });
      expect(occurrence?.bbox.x).toBe(10); // x del primer word ("AB")
      expect(occurrence?.bbox.width).toBeGreaterThan(0);
      expect(occurrence?.bbox.height).toBe(12);
    });

    it("maps a single-word match to a single-word wordSpan", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["antes", "34.567.891", "despues"]);
      expect(occurrence?.wordSpan).toEqual({ startIndex: 1, endIndexExclusive: 2 });
    });

    // ADR-066 §6: la unión de bboxes arma un bbox NUEVO; sin propagación
    // explícita `rotation` se cae en silencio y el pintado rotado de §7 nunca
    // se activa (verificado sobre la firma digital de la pericia real: el Word
    // salía con rotation 90 y la Occurrence sin rotation).
    it("propagates rotation from the matched words to the occurrence bbox", async () => {
      const occurrence = await firstOccurrenceOfRotatedPage(engine, ctx, [
        { text: "Date:", rotation: 90 },
        { text: "07/07/2026", rotation: 90 },
      ]);
      expect(occurrence?.value).toBe("07/07/2026");
      expect(occurrence?.bbox.rotation).toBe(90);
    });

    it("propagates rotation when every word of a multi-word match agrees", async () => {
      const occurrence = await firstOccurrenceOfRotatedPage(engine, ctx, [
        { text: "AB", rotation: 270 },
        { text: "123", rotation: 270 },
        { text: "CD", rotation: 270 },
      ]);
      expect(occurrence?.wordSpan).toEqual({ startIndex: 0, endIndexExclusive: 3 });
      expect(occurrence?.bbox.rotation).toBe(270);
    });

    it("omits rotation when the words of a match disagree on the angle", async () => {
      const occurrence = await firstOccurrenceOfRotatedPage(engine, ctx, [
        { text: "AB", rotation: 90 },
        { text: "123" },
        { text: "CD", rotation: 90 },
      ]);
      expect(occurrence?.wordSpan).toEqual({ startIndex: 0, endIndexExclusive: 3 });
      expect(occurrence?.bbox.rotation).toBeUndefined();
    });

    // No-regresión: texto horizontal sigue sin el campo (ausente ≡ 0).
    it("leaves rotation absent for horizontal text", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["antes", "34.567.891", "despues"]);
      expect(occurrence?.bbox.rotation).toBeUndefined();
    });
  });

  // Caso 26 (§13, ADR-074 §2/§3).
  describe("fragments (footprint multi-línea)", () => {
    // El test que define el ADR de este lado: un teléfono partido entre dos
    // renglones ("0221" cierra una línea, "4567890" abre la siguiente,
    // phone-landline-ar) emite UNA Occurrence con fragments.length === 2, un
    // rectángulo por línea, y bbox sigue siendo la envolvente de los dos.
    it("a match whose words fall on two lines emits one occurrence with two fragments", async () => {
      const words = [makeWord("0221", 10, 0, 100), makeWord("4567890", 10, 0, 130)];
      const page = makePageFromWords(0, words);
      const document = makeDocument("doc-two-lines", [page]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
      const occurrence = (call?.[2] as EntityFound | undefined)?.occurrence;

      expect(occurrence?.entityType).toBe(EntityType.Phone);
      expect(occurrence?.fragments).toEqual([
        { x: 10, y: 100, width: 24, height: 12 },
        { x: 10, y: 130, width: 42, height: 12 },
      ]);
      expect(occurrence?.bbox).toEqual({ x: 10, y: 100, width: 42, height: 42 });
    });

    // No-regresión: el caso normal (una sola línea) no cambia ni un byte.
    it("a single-line match carries no fragments and its bbox is unchanged", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["AB", "123", "CD"]);
      expect(occurrence?.fragments).toBeUndefined();
      expect(occurrence?.bbox).toEqual({ x: 10, y: 100, width: 62, height: 12 });
    });

    it("three lines produce three fragments in reading order", async () => {
      // phone-mobile-ar tiene dos puntos de separador opcional: "11" + "4567" + "8900".
      const words = [
        makeWord("11", 10, 0, 100),
        makeWord("4567", 10, 0, 130),
        makeWord("8900", 10, 0, 160),
      ];
      const page = makePageFromWords(0, words);
      const document = makeDocument("doc-three-lines", [page]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
      const occurrence = (call?.[2] as EntityFound | undefined)?.occurrence;

      expect(occurrence?.fragments).toHaveLength(3);
      expect(occurrence?.fragments?.map((f) => f.y)).toEqual([100, 130, 160]);
    });

    // Interacción con ADR-066 §6: el texto rotado no se fragmenta aunque sus
    // palabras estén "apiladas" en y distintos (es la geometría normal de un
    // run vertical), y conserva la rotation que ya propagaba antes de este ADR.
    it("a rotated match carries no fragments and keeps its rotation", async () => {
      const occurrence = await firstOccurrenceOfRotatedPage(engine, ctx, [
        { text: "AB", rotation: 270 },
        { text: "123", rotation: 270 },
        { text: "CD", rotation: 270 },
      ]);
      expect(occurrence?.fragments).toBeUndefined();
      expect(occurrence?.bbox.rotation).toBe(270);
    });
  });

  describe("Overlap resolution (caso 10 generalizado, no específico a DNI/CUIT)", () => {
    it("keeps the longest of two overlapping custom patterns", async () => {
      // "short-digits" (sin \b) matchea "12" y "34" como dos ocurrencias
      // separadas de su propio scan; "long-digits" matchea "1234" completo.
      // Los tres matches crudos se superponen entre sí (mismo span [0,4)
      // cubierto). El barrido por longitud descendente debe quedarse solo
      // con "1234" (longitud 4), descartando ambos submatches de longitud 2.
      engine.addPattern({
        id: "short-digits",
        entityType: EntityType.Custom,
        pattern: /\d{2}/g,
        normalizer: (v: string) => v,
        maskFormat: "XX",
      });
      engine.addPattern({
        id: "long-digits",
        entityType: EntityType.Custom,
        pattern: /\d{4}/g,
        normalizer: (v: string) => v,
        maskFormat: "XXXX",
      });

      const document = makeSinglePageDocument("doc-overlap-custom", ["1234"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(1);
      const calls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      const occurrence = (calls[0]?.[2] as EntityFound).occurrence;
      expect(occurrence.value).toBe("1234");
      expect(occurrence.entityType).toBe(EntityType.Custom);
    });
  });

  describe("Guarda de corrida (ADR-075 §2, §4)", () => {
    it('"PP-13-00-027653-24/00" emits no Phone occurrence', async () => {
      const document = makeSinglePageDocument("doc-guard-expediente", ["PP-13-00-027653-24/00"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);

      const phoneOccurrences = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => o.entityType === EntityType.Phone);
      expect(phoneOccurrences).toHaveLength(0);
    });

    // Regresión (hallazgo post-mergeo, escenario 8 de E2E, `text-10p.pdf`):
    // `phone-mobile-ar` tiene un `[\s-]?` opcional ANTES de su `\b`, así que
    // sobre "CUIT 20-12345678-9" el match crudo trae el espacio adentro
    // (`" 20-12345678"`, `startIndex` apunta al espacio, no al "2"). Sin
    // recortar ese espacio antes de medir la corrida, `computeRunBounds` mide
    // adyacencia contra el carácter ANTERIOR al espacio — la "T" de "CUIT" —
    // y la corrida se extendía por error hasta "CUIT", con letras: la guarda
    // descartaba un teléfono real. Nunca lo cubrió un test unitario porque
    // ninguno de los otros cinco tipos bajo la guarda tiene un separador
    // opcional ANTES de su `\b` — es específico de `phone-mobile-ar`.
    it("a phone-mobile-ar match preceded by a word and a space still emits (leading separator inside the match)", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["CUIT", "20-12345678-9"]);
      expect(occurrence?.entityType).toBe(EntityType.Phone);
    });

    // v1.6.2: el `[\s-]?` opcional de `phone-mobile-ar` se traga el espacio
    // que lo precede, y ese `match[0]` era el `value` de la ocurrencia — o sea
    // el `canonicalValue` del grupo. Un valor que arranca con espacio no puede
    // encontrarse a sí mismo desde "Ver ocurrencias" (ADR-084 §2), porque el
    // matcheo es por palabra entera. `runPattern` lo recorta antes de armar el
    // RawMatch, y el `wordSpan` tiene que quedar apuntando al primer dígito.
    it("the emitted value never carries the edge whitespace the pattern swallowed", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["CUIT", "20-12345678-9"]);
      expect(occurrence?.value).toBe("20-12345678");
      expect(occurrence?.value).toBe(occurrence?.value.trim());
      expect(occurrence?.wordSpan?.startIndex).toBe(1);
    });

    it("phone, DNI, CUIT, card and date with sentence punctuation still emit", async () => {
      const cases: ReadonlyArray<{
        readonly tokens: ReadonlyArray<string>;
        readonly type: EntityType;
      }> = [
        { tokens: ["Tel:", "0221-4567890."], type: EntityType.Phone },
        { tokens: ["DNI:", "34.567.891."], type: EntityType.DNI },
        { tokens: ["CUIT:", "20-34567891-4."], type: EntityType.CUIT },
        { tokens: ["Tarjeta:", "4111111111111111."], type: EntityType.CreditCard },
        { tokens: ["Fecha:", "07/07/2026."], type: EntityType.Date },
      ];

      for (const { tokens, type } of cases) {
        const occurrence = await firstOccurrence(engine, ctx, tokens);
        expect(occurrence?.entityType, `tipo esperado: ${type}, tokens: ${tokens.join(" ")}`).toBe(
          type,
        );
      }
    });

    // Regex_Engine.md §14 nombra esta fila '"Tel:4567-8900" and
    // "4567-8900,4567-8901" still emit' — "4567-8900" es el ejemplo informal
    // de ADR-075 §5 y no matchea NINGÚN patrón de teléfono real: landline
    // exige "0" inicial, mobile exige 10 dígitos en grupos 2-4-4 (8 dígitos
    // no alcanza). Verificado contra el regex real (node -e), no es un
    // fixture válido — con ese número el test pasaría igual con la guarda
    // rota, porque nunca hay match que descartar. Se sustituye por el número
    // de línea telefónica que el propio ADR usa en Contexto §1/§2
    // ("0221-4567890"), que sí matchea `phone-landline-ar` y de verdad
    // ejercita la guarda. Erratum a corregir en el spec en un PR de docs.
    it('"Tel:0221-4567890" and "0221-4567890,0221-4567891" still emit', async () => {
      const colonNoSpace = await firstOccurrence(engine, ctx, ["Tel:0221-4567890"]);
      expect(colonNoSpace?.entityType).toBe(EntityType.Phone);

      const document = makeSinglePageDocument("doc-guard-comma", ["0221-4567890,0221-4567891"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(2);
      const phoneOccurrences = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => o.entityType === EntityType.Phone);
      expect(phoneOccurrences).toHaveLength(2);
    });

    it('"34.567.891/2024" still emits the DNI', async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["34.567.891/2024"]);
      expect(occurrence?.entityType).toBe(EntityType.DNI);
      expect(occurrence?.normalizedValue).toBe("34567891");
    });

    it("License and Plate are never touched by the run guard", async () => {
      const license = await firstOccurrence(engine, ctx, ["MP-12345"]);
      expect(license?.entityType).toBe(EntityType.License);

      const plate = await firstOccurrence(engine, ctx, ["AB123CD"]);
      expect(plate?.entityType).toBe(EntityType.Plate);
    });
  });

  describe("Multi-page aggregation", () => {
    it("aggregates occurrenceCount across pages and reports durationMs", async () => {
      const document = makeDocument("doc-multi-page", [
        makePage(0, ["DNI", "34.567.891"]),
        makeEmptyPage(1),
        makePage(2, ["CUIT", "20-34567891-4"]),
      ]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(2);
      expect(output.documentId).toBe("doc-multi-page");
      expect(typeof output.durationMs).toBe("number");
      expect(output.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("addPattern / removePattern", () => {
    it("re-adding a custom pattern with the same id replaces it", async () => {
      engine.addPattern({
        id: "dup",
        entityType: EntityType.Custom,
        pattern: /\bFOO\b/g,
        normalizer: (v: string) => v,
        maskFormat: "FOO",
      });
      engine.addPattern({
        id: "dup",
        entityType: EntityType.Custom,
        pattern: /\bBAR\b/g,
        normalizer: (v: string) => v,
        maskFormat: "BAR",
      });

      const document = makeSinglePageDocument("doc-dup-pattern", ["FOO", "BAR"]);
      const output = await engine.process({ document }, ctx);
      // Solo "BAR" quedó activo bajo el id "dup"; "FOO" ya no matchea.
      expect(output.occurrenceCount).toBe(1);
    });

    it("removePattern with unknown id is a no-op", () => {
      expect(() => engine.removePattern("does-not-exist")).not.toThrow();
    });

    it("init() resets custom patterns added in a previous session", async () => {
      engine.addPattern({
        id: "session-pattern",
        entityType: EntityType.Custom,
        pattern: /\bZZZ\b/g,
        normalizer: (v: string) => v,
        maskFormat: "ZZZ",
      });
      await engine.init(ctx);

      const document = makeSinglePageDocument("doc-reset", ["ZZZ"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });

  describe("Logging", () => {
    it("logs an info message when process() finishes", async () => {
      const infoSpy = vi.spyOn(ctx.logger, "info");
      const document = makeSinglePageDocument("doc-log", ["DNI", "34.567.891"]);
      await engine.process({ document }, ctx);
      expect(infoSpy).toHaveBeenCalled();
    });
  });

  describe("Defensive paths", () => {
    it("a pattern that can match an empty string does not loop infinitely and produces no occurrence", async () => {
      engine.addPattern({
        id: "empty-matcher",
        entityType: EntityType.Custom,
        pattern: /x*/g,
        normalizer: (v: string) => v,
        maskFormat: "X",
      });

      const document = makeSinglePageDocument("doc-empty-match-guard", ["abc"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });

    it("custom pattern that throws only on real text (passes addPattern's smoke test) is discarded during process()", async () => {
      // A diferencia del caso 8 (edge.test.ts), acá el patrón NO lanza contra
      // "" (pasa la validación de addPattern) pero SÍ lanza al ejecutarse
      // contra texto real — ejercita el catch de runCustomPatternWithBudget
      // dentro de process(), no el de addPattern.
      const conditionallyThrowingPattern = /foo/g;
      const originalExec = conditionallyThrowingPattern.exec.bind(conditionallyThrowingPattern);
      conditionallyThrowingPattern.exec = (str: string) => {
        if (str === "") return originalExec(str);
        throw new Error("boom-during-process");
      };

      expect(() =>
        engine.addPattern({
          id: "throws-on-real-text",
          entityType: EntityType.Custom,
          pattern: conditionallyThrowingPattern,
          normalizer: (v: string) => v,
          maskFormat: "X",
        }),
      ).not.toThrow();

      const warnSpy = vi.spyOn(ctx.logger, "warn");
      const document = makeSinglePageDocument("doc-throws-during-process", ["foo"]);
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("es inválido y se descarta"),
        expect.objectContaining({ patternId: "throws-on-real-text" }),
      );
    });
  });

  describe("findLiteral (ADR-061 §2)", () => {
    async function firstManualOccurrence(
      tokens: ReadonlyArray<string>,
      value: string,
    ): Promise<{
      readonly output: { occurrenceCount: number };
      readonly occurrence: EntityFound["occurrence"] | undefined;
    }> {
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const document = makeSinglePageDocument(`doc-${Math.random()}`, tokens);
      const output = await engine.findLiteral(
        { document, value, entityType: EntityType.Person },
        ctx,
      );
      const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
      return { output, occurrence: (call?.[2] as EntityFound | undefined)?.occurrence };
    }

    it("findLiteral matches case- and accent-insensitively", async () => {
      const { output, occurrence } = await firstManualOccurrence(
        ["Contacto:", "José", "Pérez"],
        "JOSE PEREZ",
      );
      expect(output.occurrenceCount).toBe(1);
      expect(occurrence?.value).toBe("José Pérez");
      expect(occurrence?.source).toBe("manual");
    });

    // ADR-058 §5 / ADR-061 §2: "matcheo sobre secuencias de Word contiguas de
    // la misma línea". makePage (test-helpers.ts) pone todas las palabras en
    // la misma banda vertical (y=100 fijo), que es exactamente el caso que
    // este test ejercita: un valor de varias palabras, todas en una línea.
    //
    // El rechazo de palabras en líneas DISTINTAS (sharesVerticalBand) tiene
    // su propio test más abajo: "findLiteral does NOT match a value whose
    // words fall on different lines".
    it("findLiteral matches a multi-word value over contiguous words of the same line", async () => {
      const { output, occurrence } = await firstManualOccurrence(
        ["El", "contrato", "lo", "firma", "María", "Fernanda", "López", "en", "Córdoba."],
        "María Fernanda López",
      );
      expect(output.occurrenceCount).toBe(1);
      expect(occurrence?.value).toBe("María Fernanda López");
      expect(occurrence?.wordSpan).toEqual({ startIndex: 4, endIndexExclusive: 7 });
    });

    // ADR-061 §2: limitación deliberada, no un bug. Protege contra
    // implementarla por accidente (búsqueda difusa) y contra romperla en
    // silencio — la búsqueda difusa de variantes queda anotada en
    // roadmap/Future_Ideas.md §5.1b.
    it('findLiteral does NOT match "J. Pérez" for "José Pérez"', async () => {
      const { output } = await firstManualOccurrence(["José", "Pérez", "firmó."], "J. Pérez");
      expect(output.occurrenceCount).toBe(0);
    });

    // ADR-061 §2 errata, caso 16 (§13): las palabras son contiguas en
    // Page.words pero caen en bandas Y disjuntas — sin el chequeo de
    // sharesVerticalBand esto daría un falso positivo (§13 caso 16).
    it("findLiteral does NOT match a value whose words fall on different lines", async () => {
      const words = [
        makeWord("José", 10, 0, 100), // banda Y [100, 112)
        makeWord("Pérez", 70, 0, 130), // banda Y [130, 142) — disjunta de la anterior
      ];
      const document = makeDocument("doc-different-lines", [makePageFromWords(0, words)]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.findLiteral(
        { document, value: "José Pérez", entityType: EntityType.Person },
        ctx,
      );

      expect(output.occurrenceCount).toBe(0);
      expect(busEmitSpy).not.toHaveBeenCalled();
    });

    // Caso 18 (§13): tras un match el barrido avanza el largo completo de la
    // secuencia — los solapamientos no se reportan.
    it("findLiteral does not report overlapping matches", async () => {
      const { output } = await firstManualOccurrence(["ana", "ana", "ana"], "ana ana");
      expect(output.occurrenceCount).toBe(1);
    });

    // ADR-061 §2, segunda errata (2026-08-15, hallazgo post-aprobación):
    // `Page.words` separa por whitespace (ADR-020 §1), así que un nombre
    // pegado a puntuación sin espacio ("Gorrister,") queda como un solo Word
    // con la coma adentro. Sin recortar el borde, una búsqueda de "Gorrister"
    // no encontraba estas ocurrencias — el gap que hacía que la lupa contara
    // menos apariciones que el pipeline de detección completo.
    it("findLiteral matches a word with trailing punctuation glued on (no space)", async () => {
      const { output, occurrence } = await firstManualOccurrence(
        ["El", "cuerpo", "de", "Gorrister,", "colgaba"],
        "Gorrister",
      );
      expect(output.occurrenceCount).toBe(1);
      expect(occurrence?.value).toBe("Gorrister,");
    });

    it("findLiteral matches a word with leading punctuation glued on (inverted exclamation)", async () => {
      const { output } = await firstManualOccurrence(
        ["¡Gorrister!", "gritó", "Ellen"],
        "Gorrister",
      );
      expect(output.occurrenceCount).toBe(1);
    });

    // Consistencia: el texto de un match con puntuación pegada ("Gorrister,")
    // tiene que poder volver a buscarse tal cual — es literalmente lo que
    // "Agregar como…" hace con `match.text` (`ui/Components.md` §5.4c). Sin
    // recortar también el token de búsqueda, buscar "Gorrister," no
    // encontraba ni a la palabra de la que salió.
    it("findLiteral finds a word by its own punctuated text (round-trip via searchText)", async () => {
      const { output } = await firstManualOccurrence(["Gorrister,", "dijo", "algo"], "Gorrister,");
      expect(output.occurrenceCount).toBe(1);
    });

    // Guarda contra sobre-recortar: el recorte es solo de BORDE. La
    // puntuación interna de un nombre no debe tocarse ni asumirse
    // equivalente a su ausencia.
    it("findLiteral does NOT treat internal punctuation as optional", async () => {
      const { output } = await firstManualOccurrence(["O'Brien", "firmó."], "OBrien");
      expect(output.occurrenceCount).toBe(0);
    });
  });

  describe("searchText (ADR-061 §8 errata)", () => {
    // Caso 21 (§13): comparten `collectPageTextMatches` — un solo matcher,
    // dos envoltorios. Si alguien las separa después, este test diverge.
    it("searchText and findLiteral find the same matches", async () => {
      const document = makeSinglePageDocument("doc-search-vs-find-literal", [
        "El",
        "contrato",
        "lo",
        "firma",
        "María",
        "Fernanda",
        "López",
        "en",
        "Córdoba",
      ]);

      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.findLiteral(
        { document, value: "María Fernanda López", entityType: EntityType.Person },
        ctx,
      );
      const occurrence = (
        busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND)?.[2] as
          | EntityFound
          | undefined
      )?.occurrence;

      const matches = engine.searchText({ document, query: "María Fernanda López" });

      expect(matches).toHaveLength(1);
      expect(matches[0]?.pageIndex).toBe(occurrence?.pageIndex);
      expect(matches[0]?.bbox).toEqual(occurrence?.bbox);
      expect(matches[0]?.wordSpan).toEqual(occurrence?.wordSpan);
    });

    // Caso 23 (§13): página ascendente y, dentro de cada página, orden de
    // lectura de Page.words — el orden sobre el que la lupa navega
    // "siguiente/anterior".
    it("searchText returns matches in document order", async () => {
      const document = makeDocument("doc-search-order", [
        makePage(0, ["Cliente:", "Ana", "Ana"]),
        makePage(1, ["Otra", "Ana", "más"]),
      ]);

      const matches = engine.searchText({ document, query: "Ana" });

      expect(matches.map((m) => m.pageIndex)).toEqual([0, 0, 1]);
      expect(matches.map((m) => m.wordSpan.startIndex)).toEqual([1, 2, 1]);
    });
  });

  describe("carátula judicial (ADR-092)", () => {
    /** Los valores emitidos como `Person`, en orden. */
    async function personas(tokens: ReadonlyArray<string>): Promise<string[]> {
      const document = makeSinglePageDocument(`doc-caratula-${tokens.join("-")}`, tokens);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const valores = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => o.entityType === EntityType.Person)
        .map((o) => o.value);
      busEmitSpy.mockRestore();
      return valores;
    }

    it("a judicial caption is detected as a person", async () => {
      await expect(
        personas(["Expediente", "caratulado:", "Pérez,", "Juan", "c/", "Empresa"]),
      ).resolves.toEqual(["Pérez, Juan"]);
      await expect(personas(["Autos:", "Rodríguez,", "Marta", "s/", "sucesión"])).resolves.toEqual([
        "Rodríguez, Marta",
      ]);
      await expect(personas(["Firmado:", "Albarracin,", "Rocio"])).resolves.toEqual([
        "Albarracin, Rocio",
      ]);
    });

    // Una palabra de cada lado (ADR-092 §1). Un segundo nombre de pila queda
    // fuera del match, y es deliberado: con un cuantificador goloso el patrón
    // se traga la palabra capitalizada que siga —medido, `"Albarracin, Rocio
    // Date"` sobre la firma de la pericia— y esa ocurrencia cruza al run
    // siguiente y hace desaparecer al grupo vecino.
    it("captures one given name, and leaves a second one to NER", async () => {
      await expect(
        personas(["perito", "a", "López,", "María", "Fernanda,", "quien", "acepta"]),
      ).resolves.toEqual(["López, María"]);
    });

    /*
     * La regresión concreta que fijó el límite de arriba: sin él, la
     * ocurrencia se estira sobre dos runs y Grouping descarta por
     * solapamiento la entidad de al lado (mismo mecanismo que ADR-088 §1).
     *
     * El `"Firmado:"` lo agregó ADR-103, que exige una marca de carátula
     * adyacente. **La aserción no se tocó**: lo que este test fija —que el
     * match NO se coma el `"Date:"` que sigue— se verifica igual. Lo único
     * que cambió es el contexto, y hacia uno **más** fiel: el caso original
     * salía de la firma de una pericia real, o sea que ahí decía "Firmado".
     */
    it("does not swallow a capitalized word that follows the given name", async () => {
      await expect(
        personas(["Firmado:", "Albarracin,", "Rocio", "Date:", "07/07/2026"]),
      ).resolves.toEqual(["Albarracin, Rocio"]);
    });

    // La compuerta del léxico. Sin ella el patrón matchea media Argentina:
    // medido, 7/10 contra 15/16 (ADR-092, Contexto §2).
    it("toponyms and legal references are not captions", async () => {
      const trampas: ReadonlyArray<ReadonlyArray<string>> = [
        ["oficina", "de", "San", "Miguel,", "Tucumán"],
        ["domicilio", "en", "Mar", "del", "Plata,", "Buenos", "Aires"],
        ["Notifíquese", "en", "La", "Plata,", "Buenos", "Aires"],
        ["conforme", "al", "Código", "Civil,", "Título", "III"],
        ["sede", "en", "Rivadavia", "455,", "Quilmes,", "Provincia"],
        // Ya está en el orden correcto: no es una carátula, y no por la
        // compuerta sino por la forma.
        ["El", "actor,", "Juan", "Pérez,", "promueve", "demanda"],
      ];
      for (const tokens of trampas) {
        await expect(personas(tokens), tokens.join(" ")).resolves.toEqual([]);
      }
    });

    // ADR-092 §2: el `normalizer` invierte, y eso es lo que las une. Sin la
    // inversión el documento anonimizado nombraría a la misma persona con dos
    // tokens distintos.
    it("the caption and the body name end up in the same group", async () => {
      const document = makeSinglePageDocument("doc-caratula-grupo", [
        "Caratulado:",
        "Pérez,",
        "Juan",
        "—",
        "el",
        "actor",
        "Juan",
        "Pérez",
        "promueve",
      ]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const normalizados = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => o.entityType === EntityType.Person)
        .map((o) => o.normalizedValue);
      busEmitSpy.mockRestore();

      // El patrón solo alcanza la carátula; lo que este test fija es que su
      // `normalizedValue` sea el del nombre en orden natural, que es la clave
      // por la que Grouping une el pase exacto.
      expect(normalizados).toEqual(["juan perez"]);
    });
  });

  describe("comparación por sub-token (ADR-089)", () => {
    /** Los `wordSpan.startIndex` de lo que emitió `findLiteral`, en orden. */
    async function findLiteralSpans(
      document: ReturnType<typeof makeSinglePageDocument>,
      value: string,
    ): Promise<number[]> {
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.findLiteral({ document, value, entityType: EntityType.Person }, ctx);
      const spans = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence.wordSpan?.startIndex ?? -1);
      busEmitSpy.mockRestore();
      return spans;
    }

    // ADR-089 §1, fila 2 de la tabla: la coma queda ADENTRO de la palabra
    // porque el PDF no puso espacio, y el recorte de borde de ADR-061 §2 no la
    // alcanzaba. El usuario no tiene forma de ver dónde el extractor puso el
    // límite de palabra, así que esto se sentía como "a veces anda".
    it("finds a name split by internal punctuation", () => {
      const document = makeSinglePageDocument("doc-interna", ["El", "actor", "Juan", "Pérez,Juan"]);

      const matches = engine.searchText({ document, query: "Juan Pérez" });

      expect(matches).toHaveLength(1);
      expect(matches[0]?.wordSpan.startIndex).toBe(2);
      expect(matches[0]?.wordSpan.endIndexExclusive).toBe(4);
    });

    // ADR-089 §1 fila 3 + §3: sale del propio repo — un grupo puede quedar con
    // un tramo de un identificador como canonicalValue y no encontrarse a sí
    // mismo. El bbox cubre la palabra ENTERA: tapar el tramo y dejar el dígito
    // verificador a la vista no protegería nada.
    it("finds a prefix of a longer identifier, in both entries, covering the whole word", async () => {
      const document = makeSinglePageDocument("doc-prefijo", ["CUIT", "20-12345678-9"]);

      const matches = engine.searchText({ document, query: "20-12345678" });
      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe("20-12345678-9");

      await expect(findLiteralSpans(document, "20-12345678")).resolves.toEqual([1]);
    });

    // ADR-089 §1: la limitación, en un test, para que sea conocida y no una
    // sorpresa. Es el mismo problema que el hallazgo §23c y se arregla en la
    // detección, no acá.
    it("does not find a name whose order is inverted in the document", () => {
      const document = makeSinglePageDocument("doc-invertido", ["Pérez,", "Juan"]);

      expect(engine.searchText({ document, query: "Juan Pérez" })).toEqual([]);
    });

    // ADR-089 §2: LA asimetría. La lupa solo resalta; "Agregar como…" barre el
    // documento entero y crea reemplazos reales (`ui/Components.md` §5.4c), así
    // que un prefijo ahí taparía cada palabra que empiece igual.
    it("searchText matches a prefix but findLiteral does not", async () => {
      const document = makeSinglePageDocument("doc-prefijo-asimetrico", ["Ana", "y", "Anabella"]);

      const matches = engine.searchText({ document, query: "Ana" });
      expect(matches.map((m) => m.text)).toEqual(["Ana", "Anabella"]);

      await expect(findLiteralSpans(document, "Ana")).resolves.toEqual([0]);
    });

    // ADR-089 §1: los dos lados se parten igual, así que la puntuación interna
    // de un apellido no cambia nada — es la no regresión de ADR-061 §2.
    it("still finds a name with internal punctuation by its own text", () => {
      const document = makeSinglePageDocument("doc-obrien", ["El", "perito", "O'Brien", "firmó"]);

      const matches = engine.searchText({ document, query: "O'Brien" });

      expect(matches).toHaveLength(1);
      expect(matches[0]?.text).toBe("O'Brien");
    });
  });
});
