/**
 * Snapshot de grupos para "text-10p.pdf" (Grouping_Engine.md §14).
 *
 * `tests/fixtures/text-10p.pdf` no existe todavía como PDF real en el repo, y
 * Grouping Engine no depende de pdf-engine (§5: dependencias prohibidas) — no
 * procesa el documento, solo consume `ENTITY_FOUND`. Se construye el mismo
 * tipo de contenido conocido (DNI, CUIT, email, teléfono, persona,
 * organización, fecha) que regex-engine/ner-engine ya usan en sus propios
 * snapshots in-memory (mismo criterio, ver
 * regex-engine/src/__tests__/snapshot.test.ts y
 * ner-engine/src/__tests__/snapshot.test.ts), simulando el stream combinado
 * de `ENTITY_FOUND` que ambos motores emitirían para ese contenido —
 * incluyendo el mismo DNI detectado dos veces con y sin puntos (alias).
 */
import {
  DetectionSource,
  EngineEvents,
  EntityType,
  EventChannel,
  type EngineContext,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { GroupingEngine } from "../grouping.engine.js";

import { createEngineContext, makeBBox, makeOccurrence } from "./fixtures/test-helpers.js";

describe("GroupingEngine — snapshot", () => {
  let engine: GroupingEngine;
  let ctx: EngineContext;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_234_567_890_000);
    engine = new GroupingEngine();
    ctx = createEngineContext();
    await engine.init(ctx);
    engine.startSession("snapshot-doc");
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (!engine["disposed"]) {
      await engine.dispose();
    }
  });

  it("snapshot of groups for text-10p.pdf stable", () => {
    const occurrences = [
      makeOccurrence({
        id: "occ-dni-1",
        entityType: EntityType.DNI,
        source: DetectionSource.Regex,
        value: "34.567.891",
        normalizedValue: "34567891",
        pageIndex: 0,
        bbox: makeBBox(150, 100, 80, 12),
      }),
      makeOccurrence({
        id: "occ-person-1",
        entityType: EntityType.Person,
        source: DetectionSource.NER,
        confidence: 0.95,
        value: "Juan Pérez",
        normalizedValue: "juan pérez",
        pageIndex: 0,
        bbox: makeBBox(10, 100, 90, 12),
      }),
      makeOccurrence({
        id: "occ-cuit-1",
        entityType: EntityType.CUIT,
        source: DetectionSource.Regex,
        value: "20-34567891-4",
        normalizedValue: "20345678914",
        pageIndex: 0,
        bbox: makeBBox(250, 100, 110, 12),
      }),
      makeOccurrence({
        id: "occ-dni-2",
        entityType: EntityType.DNI,
        source: DetectionSource.Regex,
        value: "34567891",
        normalizedValue: "34567891",
        pageIndex: 0,
        bbox: makeBBox(150, 130, 70, 12),
      }),
      makeOccurrence({
        id: "occ-email-1",
        entityType: EntityType.Email,
        source: DetectionSource.Regex,
        value: "juan.perez@example.com",
        normalizedValue: "juan.perez@example.com",
        pageIndex: 1,
        bbox: makeBBox(10, 50, 180, 12),
      }),
      makeOccurrence({
        id: "occ-phone-1",
        entityType: EntityType.Phone,
        source: DetectionSource.Regex,
        value: "+54 11 1234-5678",
        normalizedValue: "+541112345678",
        pageIndex: 1,
        bbox: makeBBox(10, 80, 140, 12),
      }),
      makeOccurrence({
        id: "occ-org-1",
        entityType: EntityType.Organization,
        source: DetectionSource.NER,
        confidence: 0.9,
        value: "Empresa S.A.",
        normalizedValue: "empresa s.a.",
        pageIndex: 1,
        bbox: makeBBox(10, 110, 100, 12),
      }),
      makeOccurrence({
        id: "occ-date-1",
        entityType: EntityType.Date,
        source: DetectionSource.Regex,
        value: "15/03/2022",
        normalizedValue: "2022-03-15",
        pageIndex: 1,
        bbox: makeBBox(10, 140, 80, 12),
      }),
    ];

    for (const occurrence of occurrences) {
      const channel =
        occurrence.source === DetectionSource.NER ? EventChannel.Ner : EventChannel.Regex;
      ctx.bus.emit(channel, EngineEvents.ENTITY_FOUND, { documentId: "snapshot-doc", occurrence });
    }
    ctx.bus.emit(EventChannel.Regex, EngineEvents.REGEX_FINISHED, {
      documentId: "snapshot-doc",
      occurrenceCount: 6,
      durationMs: 5,
    });
    ctx.bus.emit(EventChannel.Ner, EngineEvents.NER_FINISHED, {
      documentId: "snapshot-doc",
      occurrenceCount: 2,
      durationMs: 5,
    });

    const snapshot = engine.getSnapshot("snapshot-doc");
    expect(snapshot.groups.length).toBeGreaterThan(0);

    // `id` (grupo) es un UUID v4 aleatorio: se excluye del snapshot, mismo
    // criterio que regex-engine/ner-engine con `occurrence.id`.
    const groups = [...snapshot.groups]
      .sort((a, b) => a.type.localeCompare(b.type) || a.indexInType - b.indexInType)
      .map(({ id: _id, ...rest }) => rest);

    expect({
      groupCount: snapshot.groups.length,
      conflictCount: snapshot.conflicts.length,
      groups,
    }).toMatchSnapshot();
  });
});
