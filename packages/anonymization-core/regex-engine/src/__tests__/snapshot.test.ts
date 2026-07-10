import { EngineEvents, type Document, type EngineContext, type EntityFound } from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { RegexEngine } from "../regex.engine.js";

import { createEngineContext, makeDocument, makePage } from "./fixtures/test-helpers.js";

/*
 * No existe (todavía) tests/fixtures/text-10p.pdf en el repo, y este motor
 * no depende de pdf-engine ni de pdfjs-dist (Regex_Engine.md §5:
 * dependencias prohibidas). Se construye un `Document` equivalente en
 * memoria con contenido conocido (DNIs, CUITs, emails, teléfonos AR) — igual
 * criterio que pdf-engine/src/__tests__/snapshot.test.ts para su fixture
 * determinista in-memory.
 */
function buildSnapshotDocument(): Document {
  return makeDocument("snapshot-doc", [
    makePage(0, [
      "Contrato",
      "de",
      "servicios.",
      "Titular:",
      "Juan",
      "Pérez,",
      "DNI",
      "34.567.891,",
      "CUIT",
      "20-34567891-4.",
    ]),
    makePage(1, ["Contacto:", "juan.perez@example.com", "o", "al", "+54", "11", "1234-5678."]),
    makePage(2, [
      "Matrícula",
      "profesional",
      "MP-12345-6,",
      "patente",
      "ABC",
      "123,",
      "vence",
      "15/03/2030.",
    ]),
  ]);
}

describe("RegexEngine — snapshot", () => {
  let engine: RegexEngine;
  let ctx: EngineContext;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234_567_890_000);
    engine = new RegexEngine();
    ctx = createEngineContext();
    await engine.init(ctx);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("snapshot of occurrences for text-10p.pdf stable", async () => {
    const busEmitSpy = vi.spyOn(ctx.bus, "emit");
    const document = buildSnapshotDocument();
    const output = await engine.process({ document }, ctx);

    // `id` es un UUID v4 aleatorio (no determinista): se excluye del
    // snapshot, igual que se excluyen los campos no deterministas en otros
    // snapshots del repo.
    const occurrences = busEmitSpy.mock.calls
      .filter(([, event]) => event === EngineEvents.ENTITY_FOUND)
      .map((call) => {
        const { occurrence } = call[2] as EntityFound;
        const { id: _id, ...rest } = occurrence;
        return rest;
      });

    expect(output.occurrenceCount).toBeGreaterThan(0);
    expect({ output, occurrences }).toMatchSnapshot();
  });
});
