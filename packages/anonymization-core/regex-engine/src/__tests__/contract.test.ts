import {
  DEFAULT_DETECTION_CONFIG,
  DetectionSource,
  EngineDisposedError,
  EngineEvents,
  EngineId,
  EngineNotInitializedError,
  EntityType,
  EventChannel,
  normalizeEntityValue,
  type EngineContext,
  type EntityFound,
  type Occurrence,
  type RegexFinished,
  type Unsubscribe,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as publicApi from "../index.js";
import { DEFAULT_PATTERNS_AR } from "../patterns/default-ar.js";
import { RegexEngine } from "../regex.engine.js";

import {
  createDetectionContext,
  createEngineContext,
  makeDocument,
  makePage,
  makePageFromWords,
  makeSinglePageDocument,
  makeSourcedPage,
  makeWord,
  processPage,
} from "./fixtures/test-helpers.js";

describe("RegexEngine — contract tests", () => {
  let engine: RegexEngine;
  let ctx: EngineContext;

  beforeEach(() => {
    engine = new RegexEngine();
    ctx = createEngineContext();
  });

  afterEach(async () => {
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("init() stores context and marks engine as initialized", async () => {
    await engine.init(ctx);
    expect(engine.id).toBe(EngineId.Regex);
    expect(engine["initialized"]).toBe(true);
    expect(engine["disposed"]).toBe(false);
  });

  it("init() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.init(ctx);
    expect(engine["initialized"]).toBe(true);
  });

  it("process() before init() throws EngineNotInitializedError", async () => {
    const document = makeSinglePageDocument("doc-1", ["Hola", "mundo."]);
    await expect(engine.process({ document }, ctx)).rejects.toThrow(EngineNotInitializedError);
  });

  it("process() after dispose() throws EngineDisposedError", async () => {
    await engine.init(ctx);
    await engine.dispose();
    const document = makeSinglePageDocument("doc-1", ["Hola"]);
    await expect(engine.process({ document }, ctx)).rejects.toThrow(EngineDisposedError);
  });

  it("emits ENTITY_FOUND per match", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-entities", [
      "DNI",
      "34.567.891",
      "email",
      "ana@example.com",
    ]);
    const output = await engine.process({ document }, ctx);

    expect(output.occurrenceCount).toBe(2);
    const entityFoundCalls = busEmitSpy.mock.calls.filter(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCalls).toHaveLength(2);
    expect(entityFoundCalls[0]?.[0]).toBe(EventChannel.Regex);
  });

  it("emits REGEX_FINISHED after all pages", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-finished", ["DNI", "34.567.891"]);
    const output = await engine.process({ document }, ctx);

    expect(busEmitSpy).toHaveBeenCalledWith(
      EventChannel.Regex,
      EngineEvents.REGEX_FINISHED,
      expect.objectContaining({
        documentId: "doc-finished",
        occurrenceCount: output.occurrenceCount,
      }),
    );
    // REGEX_FINISHED es la última emisión (todos los ENTITY_FOUND salen antes).
    const lastCall = busEmitSpy.mock.calls[busEmitSpy.mock.calls.length - 1];
    expect(lastCall?.[1]).toBe(EngineEvents.REGEX_FINISHED);
  });

  it('occurrence.source === "regex"', async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-source", ["DNI", "34.567.891"]);
    await engine.process({ document }, ctx);

    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    expect(entityFoundCall).toBeDefined();
    const payload = entityFoundCall?.[2] as EntityFound;
    expect(payload.occurrence.source).toBe(DetectionSource.Regex);
  });

  it("occurrence.confidence === 1.0", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-confidence", ["DNI", "34.567.891"]);
    await engine.process({ document }, ctx);

    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    const payload = entityFoundCall?.[2] as EntityFound;
    expect(payload.occurrence.confidence).toBe(1.0);
  });

  it("default email scanner keeps events, normalization and bbox", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-email-mapping", ["Juan.Perez@Example.COM"]);
    await engine.process({ document }, ctx);
    const entityFoundCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.ENTITY_FOUND,
    );
    const occurrence = (entityFoundCall?.[2] as EntityFound | undefined)?.occurrence;
    expect(occurrence).toMatchObject({
      value: "Juan.Perez@Example.COM",
      normalizedValue: "juan.perez@example.com",
      entityType: EntityType.Email,
      pageIndex: 0,
      source: "regex",
      confidence: 1,
      bbox: { x: 10, y: 100, width: "Juan.Perez@Example.COM".length * 6, height: 12 },
      wordSpan: { startIndex: 0, endIndexExclusive: 1 },
    });
    expect(entityFoundCall).toBeDefined();
  });

  it("RegexFinished payload matches RegexEngineOutput", async () => {
    await engine.init(ctx);
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = makeSinglePageDocument("doc-payload-shape", ["DNI", "34.567.891"]);
    const output = await engine.process({ document }, ctx);

    const finishedCall = busEmitSpy.mock.calls.find(
      ([, event]) => event === EngineEvents.REGEX_FINISHED,
    );
    const payload = finishedCall?.[2] as RegexFinished;
    expect(payload.documentId).toBe(output.documentId);
    expect(payload.occurrenceCount).toBe(output.occurrenceCount);
    expect(payload.durationMs).toBe(output.durationMs);
  });

  it("index exports only the public API of §6 and the custom-pattern API is retired", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "BASE_CATALOG",
      "DEFAULT_PATTERNS_AR",
      "RegexEngine",
      "RegexInvalidPatternError",
      "compareFormat",
      "getCatalog",
      "testFormat",
      "validateFormat",
    ]);
    // ADR-220 §7: los patrones del usuario con `RegExp` ya no existen.
    for (const retired of ["addPattern", "removePattern"]) {
      expect(retired in engine).toBe(false);
    }
  });

  it("dispose() clears state", async () => {
    await engine.init(ctx);
    await engine.dispose();
    expect(engine["initialized"]).toBe(false);
    expect(engine["disposed"]).toBe(true);
  });

  it("dispose() multiple times is safe", async () => {
    await engine.init(ctx);
    await engine.dispose();
    await expect(engine.dispose()).resolves.toBeUndefined();
  });

  it("engine never subscribes to the bus", async () => {
    const onSpy = vi.fn((): Unsubscribe => vi.fn());
    const onceSpy = vi.fn((): Unsubscribe => vi.fn());
    const busCtx = createEngineContext({
      bus: {
        on: onSpy,
        once: onceSpy,
        off: vi.fn(),
        emit: vi.fn(),
        emitAsync: vi.fn(() => Promise.resolve()),
      },
    });

    await engine.init(busCtx);
    const document = makeSinglePageDocument("doc-no-subscribe", ["Hola"]);
    await engine.process({ document }, busCtx);

    expect(onSpy).not.toHaveBeenCalled();
    expect(onceSpy).not.toHaveBeenCalled();
  });

  // ADR-074 §1: los tres invariantes que garantizan que fragmentar no puede
  // introducir una fuga. `bbox is the exact envelope of fragments, which
  // never overlap` en Regex_Engine.md §14.
  describe("fragments (ADR-074 §1)", () => {
    it("bbox is the exact envelope of fragments, which never overlap", async () => {
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      // phone-landline-ar partido en dos líneas: "0221" y "4567890".
      const words = [makeWord("0221", 10, 0, 100), makeWord("4567890", 10, 0, 130)];
      const page = makePageFromWords(0, words);
      const document = makeDocument("doc-fragments-invariant", [page]);
      await engine.process({ document }, ctx);

      const call = busEmitSpy.mock.calls.find(([, event]) => event === EngineEvents.ENTITY_FOUND);
      const occurrence = (call?.[2] as EntityFound | undefined)?.occurrence;
      expect(occurrence?.fragments).toHaveLength(2);
      const fragments = occurrence?.fragments ?? [];
      const bbox = occurrence?.bbox;
      expect(bbox).toBeDefined();

      // bbox es la envolvente exacta de fragments.
      const minX = Math.min(...fragments.map((f) => f.x));
      const minY = Math.min(...fragments.map((f) => f.y));
      const maxX = Math.max(...fragments.map((f) => f.x + f.width));
      const maxY = Math.max(...fragments.map((f) => f.y + f.height));
      expect(bbox).toEqual({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

      // Los fragmentos no se solapan verticalmente.
      for (let i = 0; i < fragments.length; i++) {
        for (let j = i + 1; j < fragments.length; j++) {
          const a = fragments[i]!;
          const b = fragments[j]!;
          const overlaps = a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlaps).toBe(false);
        }
      }

      // union(fragments) ⊆ bbox: ningún fragmento se sale de la envolvente.
      for (const fragment of fragments) {
        expect(fragment.x).toBeGreaterThanOrEqual(bbox!.x);
        expect(fragment.y).toBeGreaterThanOrEqual(bbox!.y);
        expect(fragment.x + fragment.width).toBeLessThanOrEqual(bbox!.x + bbox!.width);
        expect(fragment.y + fragment.height).toBeLessThanOrEqual(bbox!.y + bbox!.height);
      }
    });
  });

  describe("findLiteral (ADR-061 §1)", () => {
    it('findLiteral emits ENTITY_FOUND with source "manual" and correct bbox', async () => {
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const document = makeSinglePageDocument("doc-find-literal", ["Contacto:", "Ana", "Gómez"]);
      const output = await engine.findLiteral(
        { document, value: "Ana Gómez", entityType: EntityType.Person },
        ctx,
      );

      expect(output.occurrenceCount).toBe(1);
      const entityFoundCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.ENTITY_FOUND,
      );
      expect(entityFoundCalls).toHaveLength(1);
      expect(entityFoundCalls[0]?.[0]).toBe(EventChannel.Regex);

      const occurrence = (entityFoundCalls[0]?.[2] as EntityFound).occurrence;
      expect(occurrence.source).toBe(DetectionSource.Manual);
      expect(occurrence.confidence).toBe(1.0);
      expect(occurrence.entityType).toBe(EntityType.Person);
      expect(occurrence.value).toBe("Ana Gómez");
      // Bbox unión de "Ana" (x=74) y "Gómez" (x=102, width=30) — ver
      // makePage en test-helpers.ts para la aritmética de posiciones.
      expect(occurrence.bbox).toEqual({ x: 74, y: 100, width: 58, height: 12 });
      expect(occurrence.wordSpan).toEqual({ startIndex: 1, endIndexExclusive: 3 });
    });

    it("findLiteral emits no REGEX_FINISHED and does not touch the pattern registry", async () => {
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const document = makeSinglePageDocument("doc-find-literal-no-finish", ["María", "López"]);
      const planBefore = engine["plan"];

      await engine.findLiteral(
        { document, value: "María López", entityType: EntityType.Person },
        ctx,
      );

      const finishedCalls = busEmitSpy.mock.calls.filter(
        ([, event]) => event === EngineEvents.REGEX_FINISHED,
      );
      expect(finishedCalls).toHaveLength(0);
      // Misma referencia: findLiteral no reasigna la lista que corre ni los
      // formatos que init compiló (§1: no es una corrida de detección).
      expect(engine["plan"]).toBe(planBefore);
    });

    it("findLiteral before init() throws EngineNotInitializedError", async () => {
      const document = makeSinglePageDocument("doc-find-literal-no-init", ["Ana"]);
      await expect(
        engine.findLiteral({ document, value: "Ana", entityType: EntityType.Person }, ctx),
      ).rejects.toThrow(EngineNotInitializedError);
    });

    it("findLiteral after dispose() throws EngineDisposedError", async () => {
      await engine.init(ctx);
      await engine.dispose();
      const document = makeSinglePageDocument("doc-find-literal-disposed", ["Ana"]);
      await expect(
        engine.findLiteral({ document, value: "Ana", entityType: EntityType.Person }, ctx),
      ).rejects.toThrow(EngineDisposedError);
    });
  });

  describe("searchText (ADR-061 §8 errata)", () => {
    it("searchText emits no events at all", async () => {
      await engine.init(ctx);
      const busEmitSpy = vi.spyOn(ctx.bus, "emit");
      const document = makeSinglePageDocument("doc-search-text-no-events", [
        "Contacto:",
        "Ana",
        "Gómez",
      ]);

      const matches = engine.searchText({ document, query: "Ana Gómez" });

      // Con coincidencias de verdad: si esto emitiera ENTITY_FOUND, tipear
      // en la lupa crearía y fusionaría grupos en la sesión en vivo.
      expect(matches).toHaveLength(1);
      expect(busEmitSpy).not.toHaveBeenCalled();
    });

    it("searchText does not touch the pattern registry or any engine state", async () => {
      await engine.init(ctx);
      const document = makeSinglePageDocument("doc-search-text-no-state", ["María", "López"]);
      const planBefore = engine["plan"];

      const first = engine.searchText({ document, query: "María López" });
      const second = engine.searchText({ document, query: "María López" });

      expect(second).toEqual(first);
      // Misma referencia: searchText no reasigna la lista que corre ni los
      // formatos que init compiló.
      expect(engine["plan"]).toBe(planBefore);
    });
  });
  // Caso 35 (ADR-211): la segunda búsqueda no toca los emails con `@`.
  it("regular emails are unchanged by the Q search", async () => {
    await engine.init(ctx);
    const tokens = [
      "Escribir",
      "a",
      "juan@example.com,",
      "o",
      "a",
      "ana.lopez@example.org.",
      "contacto.",
      "nombre@example.net",
      "y",
      "Ana.Perez@Example.COM",
      "(info@x-y.co.uk)",
    ];

    // Lo que daría solo la búsqueda con `@`: la expresión de referencia de
    // ADR-181 sobre el texto de la página.
    const expected: Array<{ readonly value: string; readonly normalizedValue: string }> = [];
    const reference = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    let match: RegExpExecArray | null;
    while ((match = reference.exec(tokens.join(" "))) !== null) {
      expected.push({ value: match[0], normalizedValue: match[0].toLowerCase() });
    }
    expect(expected.map((e) => e.value)).toEqual([
      "juan@example.com",
      "ana.lopez@example.org",
      "nombre@example.net",
      "Ana.Perez@Example.COM",
      "info@x-y.co.uk",
    ]);

    const summarize = (occurrences: ReadonlyArray<Occurrence>) =>
      occurrences.map(
        ({ value, normalizedValue, entityType, bbox, wordSpan, maskFormat, source }) => ({
          value,
          normalizedValue,
          entityType,
          bbox,
          wordSpan,
          maskFormat,
          source,
        }),
      );

    const fromOcr = await processPage(
      engine,
      ctx,
      makeSourcedPage(
        0,
        tokens.map((text) => ({ text, source: "ocr" as const })),
      ),
    );
    const fromPdf = await processPage(
      engine,
      ctx,
      makeSourcedPage(
        0,
        tokens.map((text) => ({ text, source: "pdf" as const })),
      ),
    );

    for (const occurrences of [fromOcr, fromPdf]) {
      expect(
        occurrences.map((o) => ({ value: o.value, normalizedValue: o.normalizedValue })),
      ).toEqual(expected);
      expect(occurrences.every((o) => o.entityType === EntityType.Email)).toBe(true);
    }
    // Mismos spans, valores, orden y eventos en texto de OCR y de PDF.
    expect(summarize(fromOcr)).toEqual(summarize(fromPdf));
    // `palabra. nombre@dominio` no se extiende al tramo previo.
    expect(fromOcr.some((o) => o.value.includes(". "))).toBe(false);
  });

  // Caso 36 (§13, ADR-217): el contrato de salida del patrón de dirección con
  // palabra clave. No hay contrato nuevo: es una `Occurrence` de `Address` como
  // la de cualquier patrón, con la normalización que ya usa `ner-engine`.
  it("keyword address emits Address with regex source, full confidence and the shared normalization", async () => {
    await engine.init(ctx);
    const sentences = [
      "El imputado vive en (Av. Corrientes 1980), de esta ciudad",
      "El actor, con domicilio en Maipú 1434, torre 2",
      "CON DOMICILIO EN AVENIDA DEL MAR 450",
    ];

    for (const sentence of sentences) {
      const occurrences = await processPage(engine, ctx, makePage(0, sentence.split(" ")));
      expect(occurrences, sentence).toHaveLength(1);
      const occurrence = occurrences[0];
      expect(occurrence?.entityType).toBe(EntityType.Address);
      expect(occurrence?.source).toBe(DetectionSource.Regex);
      expect(occurrence?.confidence).toBe(1.0);
      expect(occurrence?.maskFormat).toBe("XXXXXX XXX");
      expect(occurrence?.value).toBeDefined();
      expect(occurrence?.normalizedValue).toBe(normalizeEntityValue(occurrence?.value ?? ""));
      expect(occurrence?.pageIndex).toBe(0);
      expect(occurrence?.wordSpan).toBeDefined();
    }

    // La identidad es la del tramo, sin la puntuación de borde ni la caja.
    const occurrences = await processPage(
      engine,
      ctx,
      makePage(0, "vive en Av. Corrientes 1980, hoy".split(" ")),
    );
    expect(occurrences[0]?.value).toBe("Av. Corrientes 1980");
    expect(occurrences[0]?.normalizedValue).toBe("av. corrientes 1980");
  });

  // ─── 1.1, F2: catálogo y colisiones (ADR-221, ADR-222) ───

  // Las páginas del snapshot de text-10p.pdf, que es la salida de la v1.16.
  const v116Pages = (): ReadonlyArray<ReadonlyArray<string>> => [
    "Contrato de servicios. Titular: Juan Pérez, DNI 34.567.891, CUIT 20-34567891-4.".split(" "),
    "Contacto: juan.perez@example.com o al +54 11 1234-5678.".split(" "),
    "Matrícula profesional MP-12345-6, patente ABC 123, vence 15/03/2030.".split(" "),
  ];
  const runPages = async (
    runCtx: EngineContext,
    pages: ReadonlyArray<ReadonlyArray<string>>,
  ): Promise<{
    readonly occurrences: ReadonlyArray<Occurrence>;
    readonly finished: RegexFinished | undefined;
  }> => {
    const runEngine = new RegexEngine();
    await runEngine.init(runCtx);
    const emitSpy = vi.spyOn(runCtx.bus, "emit");
    emitSpy.mockClear();
    await runEngine.process(
      {
        document: makeDocument(
          "doc-f2",
          pages.map((tokens, i) => makePage(i, tokens)),
        ),
      },
      runCtx,
    );
    await runEngine.dispose();
    return {
      occurrences: emitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
        .map(([, , payload]) => (payload as EntityFound).occurrence),
      finished: emitSpy.mock.calls
        .filter(([, event]) => event === EngineEvents.REGEX_FINISHED)
        .map(([, , payload]) => payload as RegexFinished)[0],
    };
  };

  // Caso 37.
  it("default detection config emits the same occurrences as v1.16 plus base format ids", async () => {
    // La lista que corre es exactamente la de la v1.16: los mismos quince
    // patrones, los mismos objetos y en el mismo orden.
    await engine.init(createDetectionContext(DEFAULT_DETECTION_CONFIG));
    const plan = engine["plan"];
    expect(plan.basePatterns).toHaveLength(DEFAULT_PATTERNS_AR.length);
    plan.basePatterns.forEach((pattern, index) => {
      expect(pattern).toBe(DEFAULT_PATTERNS_AR[index]);
    });
    expect(plan.userFormats).toEqual([]);
    expect(plan.skippedRefIds).toEqual([]);

    // Mismos spans, valores y eventos que el snapshot de la v1.16, más el id del patrón.
    const { occurrences, finished } = await runPages(
      createDetectionContext(DEFAULT_DETECTION_CONFIG),
      v116Pages(),
    );
    expect(
      occurrences.map((o) => [o.pageIndex, o.value, o.entityType, o.formatId, o.formatOrigin]),
    ).toEqual([
      [0, "34.567.891", EntityType.DNI, "dni-ar", "base"],
      [0, "20-34567891-4", EntityType.CUIT, "cuit-ar", "base"],
      [1, "juan.perez@example.com", EntityType.Email, "email", "base"],
      [1, "+54 11 1234-5678", EntityType.Phone, "phone-mobile-ar", "base"],
      [2, "MP-12345-6", EntityType.License, "license-ar", "base"],
      [2, "ABC 123", EntityType.Plate, "plate-vieja-ar", "base"],
      [2, "15/03/2030", EntityType.Date, "date-ar", "base"],
    ]);
    expect(finished?.occurrenceCount).toBe(7);
  });

  // Caso 52.
  it("every process occurrence carries formatId and formatOrigin, findLiteral none", async () => {
    const detectionCtx = createDetectionContext(DEFAULT_DETECTION_CONFIG);
    const { occurrences } = await runPages(detectionCtx, v116Pages());
    expect(occurrences.length).toBeGreaterThan(0);
    const patternIds = new Set(DEFAULT_PATTERNS_AR.map((p) => p.id));
    for (const occurrence of occurrences) {
      expect(occurrence.formatId !== undefined && patternIds.has(occurrence.formatId)).toBe(true);
      expect(occurrence.formatOrigin).toBe("base");
    }

    await engine.init(ctx);
    const literalEmit = vi.spyOn(ctx.bus, "emit");
    await engine.findLiteral(
      {
        document: makeSinglePageDocument("doc-literal-ids", ["Ana", "Gómez"]),
        value: "Ana Gómez",
        entityType: EntityType.Person,
      },
      ctx,
    );
    const manual = literalEmit.mock.calls
      .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
      .map(([, , payload]) => (payload as EntityFound).occurrence);
    expect(manual).toHaveLength(1);
    expect(manual[0]).not.toHaveProperty("formatId");
    expect(manual[0]).not.toHaveProperty("formatOrigin");
  });

  it("REGEX_FINISHED omits skippedFormats when every format ran", async () => {
    const { finished } = await runPages(
      createDetectionContext(DEFAULT_DETECTION_CONFIG),
      v116Pages(),
    );
    expect(finished).toBeDefined();
    // Ausente, no vacío (ausente ≡ ninguno).
    expect(finished).not.toHaveProperty("skippedFormats");
  });
});
