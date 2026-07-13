import {
  CancelledError,
  EngineDisposedError,
  EngineEvents,
  EntityType,
  InvalidInputError,
  type EngineContext,
  type EntityFound,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { RegexEngine } from "../regex.engine.js";
import { RegexInvalidPatternError } from "../regex.errors.js";

import {
  createEngineContext,
  makeDocument,
  makeEmptyPage,
  makePage,
  makeSinglePageDocument,
} from "./fixtures/test-helpers.js";

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

  // Caso 8 (§13): patrón custom con regex inválida.
  describe("Caso 8: patrón custom inválido", () => {
    it("custom invalid regex throws and is discarded", async () => {
      // RegExp instances no pueden ser sintácticamente inválidas en JS (ya se
      // compilaron al construirse); se simula un patrón que lanza al
      // ejecutarse — el escenario real detrás de "regex inválida" para un
      // objeto RegExp ya construido (ver nota en regex.engine.ts).
      const throwingPattern = /placeholder/g;
      throwingPattern.exec = () => {
        throw new Error("boom");
      };

      expect(() =>
        engine.addPattern({
          id: "bad-pattern",
          entityType: EntityType.Custom,
          pattern: throwingPattern,
          normalizer: (v: string) => v,
          maskFormat: "X",
        }),
      ).toThrow(RegexInvalidPatternError);

      const document = makeSinglePageDocument("doc-bad-pattern", ["algo", "cualquiera"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });

  // Caso 9 (§13): patrón custom con catastrophic backtracking.
  describe("Caso 9: patrón custom con timeout", () => {
    it("custom catastrophic regex times out and is discarded", async () => {
      engine.addPattern({
        id: "slow-pattern",
        entityType: EntityType.Custom,
        pattern: /a+/g,
        normalizer: (v: string) => v,
        maskFormat: "X",
      });

      // Simula tiempo transcurrido > 1000ms sin bloquear el test de verdad:
      // cada llamada a Date.now() avanza 2000ms respecto de la anterior, así
      // que el par (inicio, fin) que mide runCustomPatternWithBudget siempre
      // reporta un elapsed > CUSTOM_PATTERN_BUDGET_MS, sin depender del
      // número exacto de llamadas que haga process() alrededor.
      let counter = 0;
      const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => {
        const value = counter * 2000;
        counter++;
        return value;
      });

      const warnSpy = vi.spyOn(ctx.logger, "warn");
      const document = makeSinglePageDocument("doc-slow-pattern", ["aaaa"]);
      const output = await engine.process({ document }, ctx);

      expect(output.occurrenceCount).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("excedió el presupuesto"),
        expect.objectContaining({ patternId: "slow-pattern" }),
      );

      dateSpy.mockRestore();
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

  // No numerado en §13 (regla de §11: input null/undefined → InvalidInputError).
  describe("Null/undefined input", () => {
    it("throws InvalidInputError for null input", async () => {
      // @ts-expect-error — assert de runtime: §11 exige rechazar input null con InvalidInputError.
      await expect(engine.process(null, ctx)).rejects.toThrow(InvalidInputError);
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

  // No numerado en §13 (patrón custom cuyo checksum descarta el match, no
  // distinto de un patrón default — ejercita la rama checksumPassed=false
  // para patrones custom específicamente).
  describe("Custom pattern with failing checksum", () => {
    it("custom pattern match discarded when its checksum returns false", async () => {
      // "TICKET-12345" no colisiona con ningún patrón default (License y
      // Plate exigen 1-3 letras, no 6; los patrones numéricos exigen más
      // dígitos de los que "12345" aporta), así que el único candidato en
      // juego es el patrón custom, y su descarte por checksum debe dejar
      // occurrenceCount en 0 sin ningún "ganador" alternativo.
      engine.addPattern({
        id: "always-invalid",
        entityType: EntityType.Custom,
        pattern: /\bTICKET-\d{5}\b/g,
        checksum: () => false,
        normalizer: (v: string) => v,
        maskFormat: "TICKET-00000",
      });

      const document = makeSinglePageDocument("doc-custom-checksum-fail", ["TICKET-12345"]);
      const output = await engine.process({ document }, ctx);
      expect(output.occurrenceCount).toBe(0);
    });
  });
});
