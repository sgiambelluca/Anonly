import {
  CancelledError,
  EngineDisposedError,
  EngineErrorCode,
  EngineEvents,
  EntityType,
  InvalidInputError,
  type EngineContext,
  type EntityFound,
  type EntityTypeId,
  type FormatDefinition,
  type RegexFinished,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { compileFormat, scanFormat } from "../formats/format-automaton.js";
import type * as formatDetect from "../formats/format-detect.js";
import { testFormat } from "../formats/format-validation.js";
import { RegexEngine } from "../regex.engine.js";
import { RegexInvalidPatternError } from "../regex.errors.js";

import {
  addressValuesOf,
  CBU_TYPE,
  createDetectionContext,
  createEngineContext,
  digits,
  fixedText,
  LEGAJO_TYPE,
  letters,
  makeDocument,
  makeFormat,
  separator,
  userFormatOccurrences,
  makeEmptyPage,
  makeOcrWord,
  makePage,
  makePageFromWords,
  makeSinglePageDocument,
  makeSourcedPage,
  processPage,
} from "./fixtures/test-helpers.js";

/*
 * Caso 48: el recorrido de un formato del generador deja pasar a la función
 * real y lanza solo cuando el test lo pide (una vez por página que lleva la
 * marca), sin una costura en el código de producción.
 */
const detectFault = vi.hoisted(() => ({
  marker: null as string | null,
  thrown: new Set<string>(),
}));
vi.mock("../formats/format-detect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof formatDetect>();
  return {
    ...actual,
    detectFormatSpans: (...args: Parameters<typeof actual.detectFormatSpans>) => {
      const [, text] = args;
      // Lanza una sola vez por página: solo el primer formato que la recorre.
      if (
        detectFault.marker !== null &&
        text.includes(detectFault.marker) &&
        !detectFault.thrown.has(text)
      ) {
        detectFault.thrown.add(text);
        throw new RangeError(`fallo sobre el texto: ${text}`);
      }
      return actual.detectFormatSpans(...args);
    },
  };
});

describe("RegexEngine — edge case tests", () => {
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

  // Caso 1 (§13): documento vacío (0 páginas).
  describe("Caso 1: documento vacío", () => {
    it("empty document returns 0 occurrences", async () => {
      const document = makeDocument("doc-empty", []);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(0);
      expect(output.documentId).toBe("doc-empty");
      // §13 caso 1: "retorna con occurrenceCount = 0 sin emitir nada".
      expect(busEmitSpy).not.toHaveBeenCalled();
    });
  });

  // Caso 2 (§13): página sin texto.
  describe("Caso 2: página sin texto", () => {
    it("textless page returns 0 occurrences", async () => {
      const document = makeDocument("doc-textless-page", [makeEmptyPage(0)]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(0);
      const entityFoundCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      expect(entityFoundCalls).toHaveLength(0);
      // La página está vacía, pero el documento tiene páginas: REGEX_FINISHED
      // sí se emite (a diferencia del caso 1, documento sin páginas).
      const finishedCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.REGEX_FINISHED,
      );
      expect(finishedCalls).toHaveLength(1);
    });
  });

  // Caso 4 (§13): CUIT con dígito verificador incorrecto.
  describe("Caso 4: CUIT inválido", () => {
    it("CUIT with invalid checksum is discarded", async () => {
      // Sin guiones a propósito: aísla el caso 4 (checksum inválido → 0
      // ocurrencias) del caso 10 (overlap DNI-dentro-de-CUIT). Con guiones,
      // el CUIT inválido deja expuesto un DNI de 8 dígitos válido en su
      // interior (ver unit.test.ts "CUIT inválido con guiones..."); sin
      // guiones, la corrida de 11 dígitos es homogénea y no expone ningún
      // sub-match \b-delimitado de otro patrón. Dígito verificador correcto
      // es 4 (ver unit.test.ts); acá se usa 3.
      const document = makeSinglePageDocument("doc-cuit-invalid", ["20345678913"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });

  // Caso 5 (§13): tarjeta con Luhn inválido.
  describe("Caso 5: tarjeta con Luhn inválido", () => {
    it("Credit card with invalid Luhn is discarded", async () => {
      const document = makeSinglePageDocument("doc-cc-invalid", ["4111111111111112"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });

  // Caso 6 (§13): email edge case.
  describe("Caso 6: email inválido (a@b.c)", () => {
    it("invalid email does not match", async () => {
      const document = makeSinglePageDocument("doc-email-invalid", ["a@b.c"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });

  // Caso 7 (§13): patente vieja vs Mercosur.
  describe("Caso 7: patente AR vieja vs Mercosur", () => {
    it("AR plate vieja and Mercosur both match as Plate", async () => {
      const document = makeSinglePageDocument("doc-plates", ["ABC", "123", "y", "AB", "123", "CD"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(2);
      const calls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      const occurrences = calls.map((c) => (c[2] as EntityFound).occurrence);
      expect(occurrences.every((o) => o.entityType === EntityType.Plate)).toBe(true);
      expect(occurrences.map((o) => o.value)).toEqual(["ABC 123", "AB 123 CD"]);
      // ADR-029 §2: cada variante lleva su propio maskFormat, fiel a su forma
      // real (no el fallback único que compartían antes de este PR).
      expect(occurrences.map((o) => o.maskFormat)).toEqual(["XXX XXX", "XX XXX XX"]);
    });
  });

  // Caso 10 (§13): overlap DNI dentro de CUIT.
  describe("Caso 10: DNI dentro de CUIT", () => {
    it("DNI inside CUIT only emits CUIT", async () => {
      const document = makeSinglePageDocument("doc-dni-in-cuit", ["CUIT:", "20-34567891-4"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(1);
      const calls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      expect(calls).toHaveLength(1);
      const occurrence = (calls[0]?.[2] as EntityFound).occurrence;
      expect(occurrence.entityType).toBe(EntityType.CUIT);
      expect(occurrence.value).toBe("20-34567891-4");
    });
  });

  // Caso 12 (§13): process llamado tras dispose.
  describe("Caso 12: process llamado tras dispose", () => {
    it("throws EngineDisposedError after dispose", async () => {
      await engine.dispose();
      const document = makeSinglePageDocument("doc-after-dispose", ["Hola"]);
      await expect(engine.process({ document }, ctx)).rejects.toThrow(EngineDisposedError);
    });
  });

  // Caso 19 (§13): findLiteral llamado tras dispose — mismo tratamiento que
  // process (caso 12).
  describe("Caso 19: findLiteral llamado tras dispose", () => {
    it("findLiteral throws EngineDisposedError after dispose", async () => {
      await engine.dispose();
      const document = makeSinglePageDocument("doc-find-literal-after-dispose", ["Ana"]);
      await expect(
        engine.findLiteral({ document, value: "Ana", entityType: EntityType.Person }, ctx),
      ).rejects.toThrow(EngineDisposedError);
    });
  });

  // No numerado en §13 (regla de §11: input null/undefined → InvalidInputError).
  describe("Null/undefined input", () => {
    it("throws InvalidInputError for null input", async () => {
      // @ts-expect-error — assert de runtime: §11 exige rechazar input null con InvalidInputError.
      await expect(engine.process(null, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("findLiteral throws InvalidInputError for null input", async () => {
      // @ts-expect-error — assert de runtime: mismo criterio que process() (§11).
      await expect(engine.findLiteral(null, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("searchText throws InvalidInputError synchronously for null input", () => {
      // @ts-expect-error — assert de runtime: mismo criterio que process()/findLiteral (§11).
      expect(() => engine.searchText(null)).toThrow(InvalidInputError);
    });

    it("throws InvalidInputError for undefined input", async () => {
      // @ts-expect-error — assert de runtime: §11 exige rechazar input undefined con InvalidInputError.
      await expect(engine.process(undefined, ctx)).rejects.toThrow(InvalidInputError);
    });
  });

  // No numerado en §13 (cancelación cooperativa, ver §12; SLA de timing
  // ("< 50ms") queda diferido a cancel.test.ts en Hito 11 — ver README).
  describe("Cancellation between pages", () => {
    it("throws CancelledError when aborted before processing starts", async () => {
      const abortController = new AbortController();
      const ctxWithAbort = createEngineContext({ abortSignal: abortController.signal });
      abortController.abort();

      await engine.init(ctxWithAbort);
      const document = makeSinglePageDocument("doc-cancelled", ["DNI", "34.567.891"]);
      await expect(engine.process({ document }, ctxWithAbort)).rejects.toThrow(CancelledError);
    });

    it("throws CancelledError when aborted between pages", async () => {
      const abortController = new AbortController();
      const ctxWithAbort = createEngineContext({ abortSignal: abortController.signal });

      const document = makeDocument("doc-cancel-mid", [
        makePage(0, ["DNI", "34.567.891"]),
        makePage(1, ["CUIT", "20-34567891-4"]),
        makePage(2, ["Email", "ana@example.com"]),
      ]);

      const busEmitSpy = vi.spyOn(ctxWithAbort.bus, "emit").mockImplementation((...args) => {
        const [, event] = args;
        if (event === EngineEvents.ENTITY_FOUND) {
          // Aborta apenas se detecta la primera ocurrencia (página 0), antes
          // de que el loop llegue a evaluar la página 1.
          abortController.abort();
        }
      });

      await engine.init(ctxWithAbort);
      await expect(engine.process({ document }, ctxWithAbort)).rejects.toThrow(CancelledError);
      expect(busEmitSpy).toHaveBeenCalled();
    });
  });

  // ADR-061 §6: valor ausente del documento → occurrenceCount: 0, sin
  // eventos, sin error. No es un fallo del Core que el usuario haya
  // escrito algo que no está.
  describe("findLiteral — valor ausente (ADR-061 §6)", () => {
    it("findLiteral with a value absent from the document returns 0 and emits nothing", async () => {
      const document = makeSinglePageDocument("doc-absent-value", [
        "Texto",
        "sin",
        "coincidencias.",
      ]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.findLiteral(
        { document, value: "Roberto Sánchez", entityType: EntityType.Person },
        ctx,
      );

      expect(output.occurrenceCount).toBe(0);
      expect(busEmitSpy).not.toHaveBeenCalled();
    });

    it("findLiteral with an empty or whitespace-only value returns 0 without error", async () => {
      const document = makeSinglePageDocument("doc-empty-value", ["Cualquier", "cosa"]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.findLiteral(
        { document, value: "   ", entityType: EntityType.Person },
        ctx,
      );

      expect(output.occurrenceCount).toBe(0);
      expect(busEmitSpy).not.toHaveBeenCalled();
    });
  });

  // ADR-061 §1: findLiteral opera sobre Page.words, que no distingue el
  // origen de la palabra — funciona igual sobre palabras de OCR.
  describe("findLiteral — palabras de OCR (ADR-061 §1)", () => {
    it("findLiteral works over OCR-sourced words", async () => {
      const words = [makeOcrWord("Lucía", 10, 0), makeOcrWord("Ibarra", 70, 0)];
      const document = makeDocument("doc-ocr-literal", [makePageFromWords(0, words)]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const output = await engine.findLiteral(
        { document, value: "LUCIA IBARRA", entityType: EntityType.Person },
        ctx,
      );

      expect(output.occurrenceCount).toBe(1);
      const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
      const occurrence = (call?.[2] as EntityFound).occurrence;
      expect(occurrence.source).toBe("manual");
      expect(occurrence.value).toBe("Lucía Ibarra");
    });
  });

  // No numerado en §14 (guarda de cancelación cooperativa entre páginas,
  // mismo criterio que process()/caso 11).
  describe("findLiteral — cancelación", () => {
    it("findLiteral throws CancelledError when aborted before the first page", async () => {
      const abortController = new AbortController();
      const ctxWithAbort = createEngineContext({ abortSignal: abortController.signal });
      abortController.abort();

      await engine.init(ctxWithAbort);
      const document = makeSinglePageDocument("doc-find-literal-cancelled", ["Ana", "Gómez"]);
      await expect(
        engine.findLiteral(
          { document, value: "Ana Gómez", entityType: EntityType.Person },
          ctxWithAbort,
        ),
      ).rejects.toThrow(CancelledError);
    });
  });

  // Caso 22 (§13): mismo criterio que el caso 14 de findLiteral.
  describe("searchText — query vacía (ADR-061 §8 errata)", () => {
    it("searchText with an empty or whitespace-only query returns an empty array", async () => {
      const document = makeSinglePageDocument("doc-search-text-empty-query", ["Cualquier", "cosa"]);
      expect(engine.searchText({ document, query: "   " })).toEqual([]);
      expect(engine.searchText({ document, query: "" })).toEqual([]);
    });

    // ADR-089 §1: con la comparación por sub-token, una consulta de solo
    // puntuación produce cero sub-tokens — el mismo camino corto que la
    // consulta vacía, sin recorrer el documento.
    it("searchText with a punctuation-only query returns an empty array", () => {
      const document = makeSinglePageDocument("doc-search-text-punct-query", ["Cualquier", "cosa"]);
      expect(engine.searchText({ document, query: ",.-" })).toEqual([]);
      expect(engine.searchText({ document, query: "«»" })).toEqual([]);
    });
  });

  // Caso 24 (§13): sincrónico, no promesa rechazada — a diferencia de
  // findLiteral (caso 19).
  describe("searchText — tras dispose (ADR-061 §8 errata)", () => {
    it("searchText throws EngineDisposedError synchronously after dispose", async () => {
      await engine.dispose();
      const document = makeSinglePageDocument("doc-search-text-after-dispose", ["Ana"]);
      expect(() => engine.searchText({ document, query: "Ana" })).toThrow(EngineDisposedError);
    });
  });

  /*
   * Caso 31 (§13): el residuo que ADR-092, Contexto §3 aceptaba — "Argentina"
   * ES un nombre de pila permitido en el registro de Buenos Aires, así que la
   * compuerta del léxico lo dejaba pasar.
   *
   * **ADR-103 lo cerró**, y este test se invierte con él. La razón por la que
   * se aceptaba era que el lookbehind que lo evita pierde "el Doctor Pérez,
   * Juan", y que un falso negativo pesa más que un falso positivo en una
   * herramienta de privacidad. Ese juicio se revisó: la clase de falso
   * positivo resultó mucho más grande (adverbios y enumeraciones) y una de
   * ellas **fusiona dos personas reales en una sola** — que no es un
   * destildado, es una fuga silenciosa.
   */
  describe("Caso 31: carátula — el residuo cerrado por ADR-103", () => {
    it('"Buenos Aires, Argentina" ya no emite: no hay marca de carátula cerca', async () => {
      const document = makeSinglePageDocument("doc-caratula-residuo", [
        "con",
        "domicilio",
        "en",
        "Buenos",
        "Aires,",
        "Argentina",
      ]);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const personas = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => o.entityType === EntityType.Person)
        .map((o) => o.value);
      busEmitSpy.mockRestore();

      expect(personas).toEqual([]);
    });
  });

  // Caso 27 (§13, ADR-075 §1): las dos limitaciones deliberadas del patrón
  // de fecha textual — asertadas para que no se implementen por accidente
  // ni se rompan en silencio (mismo criterio que "J. Pérez" de ADR-061 §2).
  describe("Caso 27: fecha textual — límites deliberados", () => {
    it('"julio de 2026" and "7 de julio de 26" do NOT match', async () => {
      const withoutDay = makeSinglePageDocument("doc-textual-date-no-day", ["julio", "de", "2026"]);
      expect((await engine.process({ document: withoutDay }, ctx)).occurrenceCount).toBe(0);

      const twoDigitYear = makeSinglePageDocument("doc-textual-date-2-digit-year", [
        "7",
        "de",
        "julio",
        "de",
        "26",
      ]);
      expect((await engine.process({ document: twoDigitYear }, ctx)).occurrenceCount).toBe(0);
    });

    it('"45 de julio de 2026" is discarded by validateDateRange', async () => {
      const document = makeSinglePageDocument("doc-textual-date-invalid", [
        "45",
        "de",
        "julio",
        "de",
        "2026",
      ]);
      expect((await engine.process({ document }, ctx)).occurrenceCount).toBe(0);
    });
  });

  // Caso 28 y 44 (§13, ADR-075 §2/§4/§5, ADR-220 §2): la guarda de corrida
  // también alcanza a los formatos del generador, y el residuo aceptado queda
  // asertado como tal.
  describe("Caso 28: guarda de corrida — formato del generador y residuo aceptado", () => {
    it("a user format is subject to the run guard too", async () => {
      const formatCtx = createDetectionContext({
        userTypes: [CBU_TYPE],
        userFormats: [
          makeFormat(1, CBU_TYPE.id, [digits(2), separator(["-"]), digits(6)]),
          makeFormat(2, CBU_TYPE.id, [digits(5)]),
        ],
      });
      await engine.init(formatCtx);

      // Caso 44: un tramo de un número de expediente no se emite.
      const expediente = await processPage(
        engine,
        formatCtx,
        makePage(0, ["PP-13-00-000000-24/00"]),
      );
      expect(expediente.filter((o) => o.entityType === CBU_TYPE.id)).toHaveLength(0);

      // El tramo numérico de un identificador con letras tampoco.
      const identifier = await processPage(engine, formatCtx, makePage(0, ["EXP-12345"]));
      expect(identifier.filter((o) => o.entityType === CBU_TYPE.id)).toHaveLength(0);

      // Con la corrida sin letras sí se emite (la guarda no es una fuga).
      const clean = await processPage(engine, formatCtx, makePage(0, ["Ref", "12345."]));
      expect(clean.map((o) => o.value)).toEqual(["12345"]);
    });

    // Ver la nota de unit.test.ts junto al test de guarda equivalente:
    // "Tel.4567-8900" (ADR-075 §5, texto literal) no matchea ningún patrón
    // de teléfono real por sí solo — nunca hay match que descartar, así que
    // esa forma exacta no ejercita la guarda. Se usa acá el número de
    // Contexto §1/§2 del mismo ADR ("0221-4567890"), que sí matchea
    // `phone-landline-ar` y donde el "." pegado de verdad hace que la guarda
    // lo descarte.
    it('"Tel.0221-4567890" does not emit (accepted residue)', async () => {
      const document = makeSinglePageDocument("doc-guard-residual", ["Tel.0221-4567890"]);
      expect((await engine.process({ document }, ctx)).occurrenceCount).toBe(0);
    });
  });

  // Caso 33 (§13, ADR-096): las trampas duras contra las que se midieron los
  // cuatro patrones nuevos/reescritos. Ninguna debe emitir License, Plate,
  // IBAN ni Phone — es la mitad de la medición que protege contra convertir
  // un patrón más laxo en una fuga sobre referencias legales/administrativas.
  describe("Caso 33: trampas duras (ADR-096) — ninguna emite License/Plate/IBAN/Phone", () => {
    const trampas: ReadonlyArray<{ readonly nombre: string; readonly tokens: string[] }> = [
      { nombre: "Ley 24.240", tokens: ["Ley", "24.240"] },
      { nombre: "Art. 1234", tokens: ["Art.", "1234"] },
      { nombre: "CP B1900ABC", tokens: ["CP", "B1900ABC"] },
      { nombre: "Resolución 45/2024", tokens: ["Resolución", "45/2024"] },
      { nombre: "Foja 1234", tokens: ["Foja", "1234"] },
      { nombre: "N° 123456", tokens: ["N°", "123456"] },
      { nombre: "Decreto 1023/2001", tokens: ["Decreto", "1023/2001"] },
    ];

    const watchedTypes = new Set<EntityTypeId>([
      EntityType.License,
      EntityType.Plate,
      EntityType.IBAN,
      EntityType.Phone,
    ]);

    it.each(trampas)("$nombre no emite License, Plate, IBAN ni Phone", async ({ tokens }) => {
      const document = makeSinglePageDocument(`doc-trampa-dura-${tokens.join("-")}`, tokens);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      await engine.process({ document }, ctx);
      const watchedOccurrences = busEmitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence)
        .filter((o) => watchedTypes.has(o.entityType));
      expect(watchedOccurrences, tokens.join(" ")).toHaveLength(0);
    });
  });
  // Caso 35 (ADR-211): el email leído con `Q` en texto de OCR.
  describe("Caso 35: email leído con Q (ADR-211)", () => {
    const emailValues = async (tokens: ReadonlyArray<string>): Promise<string[]> => {
      const occurrences = await processPage(engine, ctx, makeSourcedPage(0, tokens));
      return occurrences.filter((o) => o.entityType === EntityType.Email).map((o) => o.value);
    };

    it("email read with Q requires the strict lowercase shape", async () => {
      // Marcas y nombres con mayúsculas, y una `Q` sin letra o dígito a cada
      // lado: ninguna coincide.
      const noMatch: ReadonlyArray<ReadonlyArray<string>> = [
        ["ProQuest.com"],
        ["BanQ.com.ar"],
        ["JUAN.PEREZQGMAIL.COM"],
        ["JuanQgmail.com"],
        ["juanQGmail.com"],
        ["juanQgmail.COM"],
        ["-Qexample.org"],
        ["juanQ.example.org"],
        ["Qexample.org"],
        ["juan", "Qexample.org"],
        ["juanQ", "example.org"],
        ["juanQexample"],
        ["juanQexample.c"],
        ["juanQexample.com1"],
        ["juanQexample.com_"],
      ];
      for (const tokens of noMatch) {
        expect(await emailValues(tokens), tokens.join(" ")).toEqual([]);
      }

      expect(await emailValues(["juanQgmail.com"])).toEqual(["juanQgmail.com"]);
      // Dígitos, y los signos del nombre y del dominio, sí.
      expect(await emailValues(["j.u-a_n+9Qgm-ail9.co.uk"])).toEqual(["j.u-a_n+9Qgm-ail9.co.uk"]);
    });

    it("email read with Q includes up to two dot-space name segments", async () => {
      expect(await emailValues(["contacto.", "estudioQexample.org"])).toEqual([
        "contacto. estudioQexample.org",
      ]);
      expect(await emailValues(["info.", "contacto.", "estudioQexample.org"])).toEqual([
        "info. contacto. estudioQexample.org",
      ]);
      // Un tercer tramo queda afuera: entran los dos más cercanos a la `Q`.
      expect(await emailValues(["uno.", "dos.", "tres.", "estudioQexample.org"])).toEqual([
        "dos. tres. estudioQexample.org",
      ]);
      // Dos espacios, o un espacio sin punto, no extienden.
      expect(await emailValues(["contacto.", "", "estudioQexample.org"])).toEqual([
        "estudioQexample.org",
      ]);
      expect(await emailValues(["contacto", "estudioQexample.org"])).toEqual([
        "estudioQexample.org",
      ]);
      // Un punto sin espacio no necesita tramo: ya es parte del nombre.
      expect(await emailValues(["contacto.estudioQexample.org"])).toEqual([
        "contacto.estudioQexample.org",
      ]);
    });

    it("email read with Q yields to an overlapping regular email", async () => {
      // La forma con `Q` coincide con la parte inicial de un email con `@`:
      // gana el de la `@`, completo y sin el tramo previo.
      const occurrences = await processPage(
        engine,
        ctx,
        makeSourcedPage(0, ["contacto.", "estudioQexample.org@example.net"]),
      );
      expect(occurrences.map((o) => o.value)).toEqual(["estudioQexample.org@example.net"]);
      expect(occurrences[0]?.normalizedValue).toBe("estudioqexample.org@example.net");

      // Aun cuando el match con `Q` (con sus dos tramos previos) sea más
      // largo que el email con `@` que pisa su final: el de la `@` gana, y no
      // por tamaño. Sin el descarte explícito ganaría el más largo.
      const longerRead = await processPage(
        engine,
        ctx,
        makeSourcedPage(0, ["info.", "contacto.", "aQb.co@x.io"]),
      );
      expect(longerRead.map((o) => o.value)).toEqual(["aQb.co@x.io"]);

      // Sin superposición, conviven y salen en orden de lectura.
      const both = await processPage(
        engine,
        ctx,
        makeSourcedPage(0, ["juanQexample.com", "ana@example.com"]),
      );
      expect(both.map((o) => [o.value, o.normalizedValue])).toEqual([
        ["juanQexample.com", "juan@example.com"],
        ["ana@example.com", "ana@example.com"],
      ]);
    });
  });

  /*
   * Caso 36 (§13, ADR-217): dirección con palabra clave. Los límites del
   * patrón: qué nombres toma, dónde frena, qué no es una altura, qué no
   * emite, y el costo de tapar de más que el mantenedor aceptó.
   */
  describe("Caso 36: dirección con palabra clave — límites (ADR-217)", () => {
    it("keyword address takes multi-word, date-like and numbered street names", async () => {
      const cases: ReadonlyArray<readonly [string, string]> = [
        [
          "Vive en Av. Presidente Roque Sáenz Peña 1234 desde ayer",
          "Av. Presidente Roque Sáenz Peña 1234",
        ],
        [
          // Seis palabras: el tope.
          "Vive en la calle Fray Justo Santa María de Oro 2745 desde ayer",
          "calle Fray Justo Santa María de Oro 2745",
        ],
        ["Vive en la avenida del Mar 450 desde ayer", "avenida del Mar 450"],
        ["Vive en la calle 25 de Mayo 350 desde ayer", "calle 25 de Mayo 350"],
        ["Vive en la calle 1° de Mayo 480 desde ayer", "calle 1° de Mayo 480"],
        ["Fijó domicilio en 12 de Octubre 1575 a estos efectos", "12 de Octubre 1575"],
        ["Vive en la calle 50 N° 889 desde ayer", "calle 50 N° 889"],
        ["Vive en la calle 7 número 1240 desde ayer", "calle 7 número 1240"],
        ["Vive en Av. O'Higgins 250 desde ayer", "Av. O'Higgins 250"],
      ];
      for (const [sentence, expectedValue] of cases) {
        expect(await addressValuesOf(engine, ctx, sentence), sentence).toEqual([expectedValue]);
      }

      // Un nombre de siete palabras no coincide: pasa del tope.
      const sevenWords = "Vive en la calle Doctor Juan Bautista Alberdi Sur Este Norte 100 hoy";
      expect(await addressValuesOf(engine, ctx, sevenWords)).toEqual([]);
    });

    it("keyword address stops at the first street number", async () => {
      expect(
        await addressValuesOf(engine, ctx, "Con domicilio en Maipú 1434, torre 2, piso 8 de aquí"),
      ).toEqual(["Maipú 1434"]);
      expect(
        await addressValuesOf(engine, ctx, "Vive en calle Lavalle 385, piso 3 de aquí"),
      ).toEqual(["calle Lavalle 385"]);
    });

    it("keyword address requires capitalized name words", async () => {
      const notAddresses = [
        "La calle estuvo cortada 3 horas por la marcha.",
        "Los vecinos de la avenida reclamaron 15 veces.",
        "El pasaje costó 4500 pesos según el recibo.",
        "Trabaja en la calle desde 1998 como vendedor.",
        "La diagonal del terreno mide 120 metros.",
        "Sobre la avenida circulaban 2 camiones.",
        "su domicilio en 2019 ni después",
        "El cambio de domicilio en 30 días",
      ];
      for (const sentence of notAddresses) {
        expect(await addressValuesOf(engine, ctx, sentence), sentence).toEqual([]);
      }
    });

    // Costo aceptado de ADR-217 («Lo que se tapa de más»), fijado en un test
    // para que sea conocido: en mayúsculas nada distingue un verbo de un
    // nombre de calle. Si este test cambia, cambia una decisión del mantenedor.
    it("keyword address over-covers a common-noun street word in all-caps text", async () => {
      expect(await addressValuesOf(engine, ctx, "LA CALLE ESTUVO CORTADA 3 HORAS")).toEqual([
        "CALLE ESTUVO CORTADA 3",
      ]);
      expect(
        await addressValuesOf(engine, ctx, "DOMICILIO PROCESAL EN LA CALLE TUCUMÁN 1650"),
      ).toEqual(["LA CALLE TUCUMÁN 1650"]);
      expect(await addressValuesOf(engine, ctx, "SU DOMICILIO EN 2019 NI DESPUÉS")).toEqual([]);
    });

    it("keyword address needs a street number", async () => {
      const withoutNumber = [
        "Av. Corrientes y Maipú",
        "calle Lavalle esquina Callao",
        "calle Balcarce sin número",
        "calle 13 entre 44 y 45",
        "ruta 205 kilómetro 54",
      ];
      for (const sentence of withoutNumber) {
        expect(await addressValuesOf(engine, ctx, sentence), sentence).toEqual([]);
      }
    });

    it("keyword address number follows the NER street number shape", async () => {
      // Los seis conectores, con y sin espacio entre el conector y el número.
      const connectors = ["N°", "Nº", "No.", "nro.", "nro", "número", "numero", "al"];
      for (const connector of connectors) {
        const spaced = `calle Mitre ${connector} 100`;
        expect(await addressValuesOf(engine, ctx, spaced), spaced).toEqual([spaced]);
      }
      expect(await addressValuesOf(engine, ctx, "calle Mitre N°100")).toEqual([
        "calle Mitre N°100",
      ]);
      // Hasta cinco dígitos.
      expect(await addressValuesOf(engine, ctx, "calle Mitre 12345 hoy")).toEqual([
        "calle Mitre 12345",
      ]);

      // Un número que continúa como fecha, importe o rango no es una altura.
      const notHeights = [
        "calle Mitre 1005/2 hoy",
        "calle Mitre 100/2 hoy",
        "calle Mitre 100.5 hoy",
        "calle Mitre 1.234 hoy",
        "calle Mitre 100,5 hoy",
        "calle Mitre 100-5 hoy",
        "calle Mitre 100‐5 hoy",
        "calle Mitre 100‑5 hoy",
        "calle Mitre 100–5 hoy",
        "calle Mitre 100—5 hoy",
        "calle Mitre 123456 hoy",
      ];
      for (const sentence of notHeights) {
        expect(await addressValuesOf(engine, ctx, sentence), sentence).toEqual([]);
      }

      // La puntuación sin dígito detrás no continúa el número.
      expect(await addressValuesOf(engine, ctx, "calle Mitre 100, hoy")).toEqual([
        "calle Mitre 100",
      ]);
      expect(await addressValuesOf(engine, ctx, "calle Mitre 100. Hoy")).toEqual([
        "calle Mitre 100",
      ]);
    });

    it("keyword address does not start inside a word", async () => {
      // La palabra de vía tiene que empezar palabra y ser seguida por un espacio.
      expect(await addressValuesOf(engine, ctx, "Bocacalle Mitre 100")).toEqual([]);
      expect(await addressValuesOf(engine, ctx, "Pasajero Mitre 100")).toEqual([]);
      // Lo mismo vale para la palabra de domicilio (ADR-217 §1).
      expect(await addressValuesOf(engine, ctx, "subdomicilio en Mitre 100")).toEqual([]);
      expect(await addressValuesOf(engine, ctx, "casita en Mitre 100")).toEqual([]);
    });

    it("a plate inside a keyword address yields to the address", async () => {
      const inside = await processPage(
        engine,
        ctx,
        makePage(0, "CON DOMICILIO EN AVENIDA DEL MAR 450".split(" ")),
      );
      expect(inside.map((o) => [o.entityType, o.value])).toEqual([
        [EntityType.Address, "AVENIDA DEL MAR 450"],
      ]);

      // Sin la palabra clave la patente se emite como siempre.
      const outside = await processPage(engine, ctx, makePage(0, "EL DOMINIO MAR 450".split(" ")));
      expect(outside.map((o) => [o.entityType, o.value])).toEqual([[EntityType.Plate, "MAR 450"]]);
    });
  });

  // ─── 1.1, F1: el generador de formatos (ADR-220) ───

  describe("Formatos del generador — bordes, linealidad y descarte", () => {
    const values = async (format: FormatDefinition, text: string): Promise<ReadonlyArray<string>> =>
      (await userFormatOccurrences([format], text)).map((occurrence) => occurrence.value);

    it("user format matches only at alphanumeric boundaries", async () => {
      // Con cinco dígitos, para que ningún formato base coincida con el mismo tramo.
      const format = makeFormat(1, CBU_TYPE.id, [digits(5)]);

      for (const text of ["X12345", "12345Y", "123456", "é12345", "12345ñ", "7_12345"]) {
        // Los dos primeros y los acentuados no tienen borde; "7_12345" sí lo
        // tiene (el guion bajo no es letra ni dígito) y se emite.
        const expected = text === "7_12345" ? ["12345"] : [];
        expect(await values(format, text), text).toEqual(expected);
      }
      expect(await values(format, "(12345)")).toEqual(["12345"]);
      expect(await values(format, "12345.")).toEqual(["12345"]);
      expect(await values(format, "12345")).toEqual(["12345"]);

      // El borde es parte del recorrido, no un filtro posterior: "12345678A"
      // con ocho dígitos no da "12345678".
      const eight = makeFormat(2, CBU_TYPE.id, [digits(8)]);
      expect(testFormat(eight, "12345678A")).toEqual([]);
      expect(testFormat(eight, "(12345678)")).toEqual([{ start: 1, end: 9 }]);
      expect(testFormat(eight, "12345678.")).toEqual([{ start: 0, end: 8 }]);
    });

    it("user format with adjacent variable pieces runs in linear time", () => {
      // Ocho piezas `digit 1..8` pegadas: con `RegExp` dispararía retroceso
      // catastrófico. Se cuentan los pasos del autómata, no el reloj.
      const compiled = compileFormat(
        makeFormat(
          1,
          CBU_TYPE.id,
          Array.from({ length: 8 }, () => digits(1, 8)),
        ),
      );

      const stepsOver = (text: string): number => {
        const stats = { steps: 0 };
        scanFormat(compiled, text, stats);
        return stats.steps;
      };

      // Una página de puros dígitos: ningún borde, ningún match.
      const run = stepsOver("1".repeat(100_000));
      expect(run).toBeLessThanOrEqual(100_000 * compiled.stateCount);

      // Palabras de ocho dígitos: duplicar el texto no cuadruplica el trabajo.
      const words = (count: number): string => "12345678 ".repeat(count);
      const small = stepsOver(words(5_000));
      const large = stepsOver(words(10_000));
      expect(small).toBeGreaterThan(0);
      expect(large / small).toBeLessThanOrEqual(2.2);
      expect(large).toBeLessThanOrEqual(words(10_000).length * compiled.stateCount);

      // Un texto que casi matchea en cada posición (la entrada adversaria de
      // un backtracking): corridas de 65 dígitos, que ninguna variante cubre.
      const nearMiss = (count: number): string => `${"1".repeat(65)} `.repeat(count);
      expect(stepsOver(nearMiss(400)) / stepsOver(nearMiss(200))).toBeLessThanOrEqual(2.2);
    });

    it("an invalid user format at init is skipped and reported", async () => {
      const valid = makeFormat(3, CBU_TYPE.id, [digits(5)]);
      const withoutChars = makeFormat(1, CBU_TYPE.id, [fixedText("ABC")]);
      const unknownType = makeFormat(2, "user:00000000-0000-4000-8000-00000000ffff", [digits(5)]);
      const formatCtx = createDetectionContext({
        userTypes: [CBU_TYPE],
        userFormats: [withoutChars, unknownType, valid],
      });
      const warnSpy = vi.spyOn(formatCtx.logger, "warn");
      const failing = new RegexEngine();

      // No lanza hacia el caller: se descartan y siguen los demás.
      await expect(failing.init(formatCtx)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          code: EngineErrorCode.REGEX_INVALID_PATTERN,
          formatId: withoutChars.id,
          issues: ["variant_without_chars"],
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          code: EngineErrorCode.REGEX_INVALID_PATTERN,
          formatId: unknownType.id,
          issues: ["type_unknown"],
        }),
      );

      const occurrences = await processPage(failing, formatCtx, makePage(0, ["ABC", "12345"]));
      expect(occurrences.map((o) => [o.value, o.formatId])).toEqual([["12345", valid.id]]);

      // Los dos descartes figuran en skippedFormats con todas las páginas, en el
      // orden de la configuración (ADR-220 §6).
      const emitSpy = vi.spyOn(formatCtx.bus, "emit");
      emitSpy.mockClear();
      const pages = [makePage(0, ["ABC", "12345"]), makePage(1, ["12345"]), makePage(2, ["ABC"])];
      await failing.process({ document: makeDocument("doc-47", pages) }, formatCtx);
      const finished = emitSpy.mock.calls.find(
        ([, event]) => event === EngineEvents.REGEX_FINISHED,
      )?.[2] as RegexFinished | undefined;
      expect(finished?.skippedFormats).toEqual([
        { formatId: withoutChars.id, pageIndices: [0, 1, 2] },
        { formatId: unknownType.id, pageIndices: [0, 1, 2] },
      ]);

      // El error que se reporta es el de ADR-220 §6.
      const error = new RegexInvalidPatternError(withoutChars.id, "variant_without_chars");
      expect(error.code).toBe(EngineErrorCode.REGEX_INVALID_PATTERN);
      expect(error.retryable).toBe(false);
      await failing.dispose();
    });

    it("two user formats with the same name both run", async () => {
      // `existingFormats` va vacío al init: el nombre es para la interfaz.
      const first = makeFormat(1, CBU_TYPE.id, [digits(5)], { name: "Igual" });
      const second = makeFormat(2, LEGAJO_TYPE.id, [letters(4)], { name: "igual" });
      const occurrences = await userFormatOccurrences([first, second], "12345 abcd");
      expect(occurrences.map((o) => [o.value, o.formatId])).toEqual([
        ["12345", first.id],
        ["abcd", second.id],
      ]);
    });

    it("user format character classes, Unicode folding and line-crossing separators", async () => {
      const classes = (charClass: "letter" | "upper" | "lower" | "alnum", text: string) =>
        values(makeFormat(1, CBU_TYPE.id, [{ kind: "chars", charClass, min: 3, max: 3 }]), text);
      expect(await classes("upper", "ÁBC abc Abc")).toEqual(["ÁBC"]);
      expect(await classes("lower", "ÁBC abc Abc ñoñ")).toEqual(["abc", "ñoñ"]);
      expect(await classes("letter", "ÁBC 123 ab1")).toEqual(["ÁBC"]);
      expect(await classes("alnum", "a1ñ 12 ab_")).toEqual(["a1ñ"]);
      // Un dígito que no es ASCII no es `digit`.
      expect(await values(makeFormat(1, CBU_TYPE.id, [digits(3)]), "١٢٣ 123")).toEqual(["123"]);
      // Un carácter fuera del plano básico cuenta como una letra.
      expect(await classes("letter", "𝐀𝐁𝐂 x")).toEqual(["𝐀𝐁𝐂"]);

      // El texto fijo pliega mayúsculas y tildes, en los dos lados.
      const folded = makeFormat(2, CBU_TYPE.id, [fixedText("Expedición "), digits(3)]);
      const fold = await userFormatOccurrences([folded], "EXPEDICION 123");
      expect(fold.map((o) => o.value)).toEqual(["EXPEDICION 123"]);

      // Un espacio del generador cruza un salto de línea (ADR-074).
      const crossing = makeFormat(3, CBU_TYPE.id, [digits(4), separator([" "]), digits(4)]);
      const page = makePage(0, ["1234\n5678"]);
      const engine2 = new RegexEngine();
      const crossCtx = createDetectionContext({
        userTypes: [CBU_TYPE],
        userFormats: [crossing],
      });
      await engine2.init(crossCtx);
      const crossed = await processPage(engine2, crossCtx, page);
      expect(crossed.map((o) => o.value)).toEqual(["1234\n5678"]);
      await engine2.dispose();

      // Contexto con dos puntos, con espacios y con varias palabras; una palabra
      // que no empieza en un borde no cuenta.
      const contextual = makeFormat(4, CBU_TYPE.id, [digits(5)], {
        contextBefore: ["Cuenta", "N° de cuenta"],
      });
      expect(await values(contextual, "cuenta : 12345")).toEqual(["12345"]);
      expect(await values(contextual, "N° de cuenta:12345")).toEqual(["12345"]);
      expect(await values(contextual, "Cuenta: 12345")).toEqual(["12345"]);
      expect(await values(contextual, "Micuenta: 12345")).toEqual([]);
      expect(await values(contextual, "Cuenta; 12345")).toEqual([]);
      expect(await values(contextual, "12345")).toEqual([]);
    });
  });

  // ─── 1.1, F2: catálogo, referencias y fallos (ADR-220 §6, ADR-221 §7) ───

  describe("Formatos salteados y REGEX_FINISHED.skippedFormats", () => {
    /** Corre `process` y devuelve el payload de `REGEX_FINISHED` y las ocurrencias. */
    const runDocument = async (
      detection: Parameters<typeof createDetectionContext>[0],
      pages: ReadonlyArray<ReadonlyArray<string>>,
    ) => {
      const runEngine = new RegexEngine();
      const runCtx = createDetectionContext(detection);
      const warnSpy = vi.spyOn(runCtx.logger, "warn");
      const emitSpy = vi.spyOn(runCtx.bus, "emit");
      await runEngine.init(runCtx);
      await runEngine.process(
        {
          document: makeDocument(
            "doc-skipped",
            pages.map((tokens, i) => makePage(i, tokens)),
          ),
        },
        runCtx,
      );
      await runEngine.dispose();
      const finished = emitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.REGEX_FINISHED)
        .map(([, , payload]) => payload as RegexFinished);
      const occurrences = emitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence);
      return { finished: finished[0], occurrences, warnSpy };
    };

    afterEach(() => {
      detectFault.marker = null;
      detectFault.thrown.clear();
    });

    // Caso 39: la copia rota se descarta y el original corre.
    it("an invalid edited copy does not replace its base format", async () => {
      const brokenCopy = makeFormat(1, EntityType.DNI, [fixedText("DNI")], { basedOn: "dni-ar" });
      const { finished, occurrences, warnSpy } = await runDocument({ userFormats: [brokenCopy] }, [
        ["DNI", "34.567.891"],
        ["sin", "datos"],
      ]);
      expect(occurrences.map((o) => [o.value, o.formatId, o.formatOrigin])).toEqual([
        ["34.567.891", "dni-ar", "base"],
      ]);
      expect(finished?.skippedFormats).toEqual([{ formatId: brokenCopy.id, pageIndices: [0, 1] }]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          code: EngineErrorCode.REGEX_INVALID_PATTERN,
          formatId: brokenCopy.id,
        }),
      );
    });

    // Caso 48.
    it("a user format that throws on a page is skipped on that page and reported without page text", async () => {
      const failing = makeFormat(1, CBU_TYPE.id, [digits(5)]);
      const healthy = makeFormat(2, LEGAJO_TYPE.id, [letters(4)]);
      detectFault.marker = "MARCA3";
      const pages: ReadonlyArray<ReadonlyArray<string>> = [
        ["12345", "abcd"],
        ["12345", "abcd"],
        ["12345", "abcd"],
        ["12345", "abcd", "MARCA3", "34.567.891"],
        ["12345", "abcd"],
      ];
      const { finished, occurrences, warnSpy } = await runDocument(
        { userTypes: [CBU_TYPE, LEGAJO_TYPE], userFormats: [failing, healthy] },
        pages,
      );

      const onPage = (pageIndex: number) =>
        occurrences.filter((o) => o.pageIndex === pageIndex).map((o) => o.formatId);
      // Ese formato no emite en esa página; los demás sí; y sigue en las siguientes.
      expect(onPage(3)).toEqual([healthy.id, "dni-ar"]);
      expect(onPage(2)).toEqual([failing.id, healthy.id]);
      expect(onPage(4)).toEqual([failing.id, healthy.id]);
      expect(finished?.skippedFormats).toEqual([{ formatId: failing.id, pageIndices: [3] }]);

      // El warn lleva el id, la página y el name del error: ni message ni stack, ni code.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [, metadata] = warnSpy.mock.calls[0] ?? [];
      expect(metadata).toEqual({ formatId: failing.id, pageIndex: 3, errorName: "RangeError" });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("MARCA3");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("fallo sobre el texto");
    });

    // Caso 51.
    it("a catalog reference is skipped in 1.1", async () => {
      const ref = {
        id: "ref:7b0f6d5e-2f3a-4c1d-9a8b-0c1d2e3f4a5b",
        country: "AR" as const,
        catalogFormatId: "dni-ar",
        enabled: true,
      };
      const off = { ...ref, id: "ref:7b0f6d5e-2f3a-4c1d-9a8b-0c1d2e3f4a5c", enabled: false };
      const { finished, occurrences, warnSpy } = await runDocument({ catalogRefs: [ref, off] }, [
        ["DNI", "34.567.891"],
        ["nada"],
      ]);
      // El análisis sigue: el catálogo base detecta como siempre.
      expect(occurrences.map((o) => o.formatId)).toEqual(["dni-ar"]);
      // Solo la referencia prendida figura, con todas las páginas.
      expect(finished?.skippedFormats).toEqual([{ formatId: ref.id, pageIndices: [0, 1] }]);
      // El warn lleva el id de la referencia y no lleva code.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [, metadata] = warnSpy.mock.calls[0] ?? [];
      expect(metadata).toEqual({ formatId: ref.id });
    });

    it("skippedFormats lists references first, then user formats, each with ascending pages", async () => {
      const broken = makeFormat(1, CBU_TYPE.id, [fixedText("X")]);
      const failing = makeFormat(2, CBU_TYPE.id, [digits(5)]);
      const ref = {
        id: "ref:7b0f6d5e-2f3a-4c1d-9a8b-0c1d2e3f4a5b",
        country: "AR" as const,
        catalogFormatId: "dni-ar",
        enabled: true,
      };
      detectFault.marker = "MARCA";
      const { finished } = await runDocument(
        { userTypes: [CBU_TYPE], userFormats: [broken, failing], catalogRefs: [ref] },
        [["MARCA"], ["x"], ["MARCA", "y"]],
      );
      expect(finished?.skippedFormats).toEqual([
        { formatId: ref.id, pageIndices: [0, 1, 2] },
        { formatId: broken.id, pageIndices: [0, 1, 2] },
        { formatId: failing.id, pageIndices: [0, 2] },
      ]);
    });
  });
});
