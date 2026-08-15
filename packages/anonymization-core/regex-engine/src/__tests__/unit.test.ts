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
    it("contiene exactamente los 11 patrones default de Regex_Engine.md", () => {
      const ids = DEFAULT_PATTERNS_AR.map((p) => p.id).sort();
      expect(ids).toEqual(
        [
          "credit-card",
          "cuit-ar",
          "date-ar",
          "dni-ar",
          "email",
          "iban",
          "license-ar",
          "phone-landline-ar",
          "phone-mobile-ar",
          "plate-mercosur-ar",
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
      expect(byId.get("license-ar")).toBe("XX-XXXX-XX");
      // ADR-029 §2: plate-vieja-ar ("ABC 123") y plate-mercosur-ar ("AB 123 CD")
      // llevan cada una su propio maskFormat fiel a su forma real.
      expect(byId.get("plate-vieja-ar")).toBe("XXX XXX");
      expect(byId.get("plate-mercosur-ar")).toBe("XX XXX XX");
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

  describe("License", () => {
    it("professional license matches and normalizes", async () => {
      const occurrence = await firstOccurrence(engine, ctx, ["MP-12345-6"]);
      expect(occurrence?.entityType).toBe(EntityType.License);
      expect(occurrence?.normalizedValue).toBe("MP123456");
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
});
