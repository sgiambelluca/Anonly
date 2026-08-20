/**
 * Tests contractuales de @anonly/event-system.
 *
 * Validan el contrato IEventBus de docs/core/Contracts.md §3.2
 * y las reglas de ADR-007-Event-Bus.md:
 * - on/once/off/emit/emitAsync
 * - tipado de eventos (compila)
 * - canales
 * - handlers no bloquean al emisor
 * - handlers que lanzan se reportan por el logger inyectado (requerido) y el bus continúa
 * - dispose libera todo; off()/unsubscribe tras dispose son no-op (ADR-019)
 * - no loops (no se auto-suscribe)
 */

import {
  EngineEvents,
  EventChannel,
  EntityType,
  PipelineStage,
  ReplacementMode,
  type ILogger,
} from "@anonly/shared";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createEventBus } from "../index.js";
import type { EventBus, EventBusOptions } from "../index.js";

function makeLogger(): ILogger & { calls: Array<{ level: string; msg: string }> } {
  const calls: Array<{ level: string; msg: string }> = [];
  return {
    debug(msg) {
      calls.push({ level: "debug", msg });
    },
    info(msg) {
      calls.push({ level: "info", msg });
    },
    warn(msg) {
      calls.push({ level: "warn", msg });
    },
    error(msg) {
      calls.push({ level: "error", msg });
    },
    calls,
  };
}

describe("@anonly/event-system — EventBus contracts", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = createEventBus({ logger: makeLogger() });
  });

  describe("on / emit", () => {
    it("emite a un handler suscrito", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
    });

    it("no emite a handlers de otro canal", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Ocr, EngineEvents.PAGE_PARSED, handler);
      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("no emite a handlers de otro evento del mismo canal", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.DOCUMENT_PARSED, handler);
      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("soporta múltiples handlers del mismo (channel, event)", () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, h1);
      bus.on(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, h2);
      bus.emit(EventChannel.Pipeline, EngineEvents.DOCUMENT_IMPORTED, {
        documentId: "d1",
        name: "test.pdf",
        sizeBytes: 100,
      });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("un handler puede ser suscrito a varios (channel, event)", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      bus.on(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, handler);
      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
      bus.emit(EventChannel.Ocr, EngineEvents.OCR_PAGE_FINISHED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 5,
        confidence: 0.9,
      });
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("on retorna Unsubscribe", () => {
    it("unsubscribe remueve el handler", () => {
      const handler = vi.fn();
      const unsubscribe = bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      unsubscribe();
      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("unsubscribe es idempotente", () => {
      const handler = vi.fn();
      const unsubscribe = bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      unsubscribe();
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe("off", () => {
    it("off remueve el handler", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      bus.off(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("off de handler no suscrito es no-op", () => {
      const handler = vi.fn();
      expect(() => bus.off(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler)).not.toThrow();
    });

    it("off limpia el set cuando queda vacío (libera memoria)", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      bus.off(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      expect(bus.subscriberCount(EventChannel.Pdf, EngineEvents.PAGE_PARSED)).toBe(0);
      expect(bus.channelCount()).toBe(0);
    });
  });

  describe("once", () => {
    it("once invoca al handler solo la primera vez", () => {
      const handler = vi.fn();
      bus.once(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, handler);
      bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, {
        documentId: "d1",
        groupCount: 3,
        conflictCount: 0,
      });
      bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, {
        documentId: "d1",
        groupCount: 3,
        conflictCount: 0,
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("once retorna unsubscribe que cancela antes del primer emit", () => {
      const handler = vi.fn();
      const unsubscribe = bus.once(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, handler);
      unsubscribe();
      bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_READY, {
        documentId: "d1",
        groupCount: 3,
        conflictCount: 0,
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("emitAsync", () => {
    it("emitAsync retorna Promise que resuelve", async () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      await expect(
        bus.emitAsync(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
          documentId: "d1",
          pageIndex: 0,
          wordCount: 10,
          requiresOCR: false,
        }),
      ).resolves.toBeUndefined();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Handlers que lanzan (ADR-007)", () => {
    it("handler que lanza no bloquea al emisor", () => {
      const goodHandler = vi.fn();
      const throwingHandler = vi.fn(() => {
        throw new Error("boom");
      });
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, throwingHandler);
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, goodHandler);
      expect(() =>
        bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
          documentId: "d1",
          pageIndex: 0,
          wordCount: 10,
          requiresOCR: false,
        }),
      ).not.toThrow();
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });

    it("handler que lanza se loguea con el logger inyectado", () => {
      const logger = makeLogger();
      const options: EventBusOptions = { logger };
      const b = createEventBus(options);
      b.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, () => {
        throw new Error("boom");
      });
      b.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
        documentId: "d1",
        pageIndex: 0,
        wordCount: 10,
        requiresOCR: false,
      });
      expect(logger.calls.some((c) => c.level === "error" && c.msg.includes("Handler"))).toBe(true);
    });
  });

  describe("unsubscribe durante iteración", () => {
    it("un handler que se auto-desuscribe durante emit no rompe la iteración", () => {
      const handler2 = vi.fn();
      const handler1 = vi.fn(function self() {
        bus.off(EventChannel.Pdf, EngineEvents.PAGE_PARSED, self);
      });
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler1);
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler2);
      expect(() =>
        bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
          documentId: "d1",
          pageIndex: 0,
          wordCount: 10,
          requiresOCR: false,
        }),
      ).not.toThrow();
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe("dispose", () => {
    it("dispose libera todos los handlers", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      bus.dispose();
      // No se puede emitir tras dispose
      expect(() =>
        bus.emit(EventChannel.Pdf, EngineEvents.PAGE_PARSED, {
          documentId: "d1",
          pageIndex: 0,
          wordCount: 10,
          requiresOCR: false,
        }),
      ).toThrow(/dispuesto/);
      expect(handler).not.toHaveBeenCalled();
    });

    it("dispose lanza si se llama dos veces", () => {
      expect(() => {
        bus.dispose();
        bus.dispose();
      }).toThrow(/dispuesto/);
    });

    it("isDisposed refleja el estado", () => {
      expect(bus.isDisposed()).toBe(false);
      bus.dispose();
      expect(bus.isDisposed()).toBe(true);
    });

    it("unsubscribe devuelto por on() es no-op después de dispose (no lanza)", () => {
      const unsubscribe = bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, vi.fn());
      bus.dispose();
      expect(() => unsubscribe()).not.toThrow();
    });

    it("off() después de dispose es no-op (no lanza)", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler);
      bus.dispose();
      expect(() => bus.off(EventChannel.Pdf, EngineEvents.PAGE_PARSED, handler)).not.toThrow();
    });
  });

  describe("No loops (ADR-007)", () => {
    it("emit dentro de un handler no causa recursión infinita", () => {
      let count = 0;
      const handler = vi.fn(() => {
        count++;
        if (count < 3) {
          bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, {
            documentId: "d1",
            stage: PipelineStage.Extracting,
            current: count,
            total: 10,
          });
        }
      });
      bus.on(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, handler);
      bus.emit(EventChannel.Pipeline, EngineEvents.PIPELINE_PROGRESS, {
        documentId: "d1",
        stage: PipelineStage.Extracting,
        current: 0,
        total: 10,
      });
      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe("subscriberCount / channelCount (utilidades para tests)", () => {
    it("subscriberCount devuelve 0 si no hay suscriptores", () => {
      expect(bus.subscriberCount(EventChannel.Pdf, EngineEvents.PAGE_PARSED)).toBe(0);
    });

    it("subscriberCount refleja suscriptores activos", () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, h1);
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, h2);
      expect(bus.subscriberCount(EventChannel.Pdf, EngineEvents.PAGE_PARSED)).toBe(2);
      bus.off(EventChannel.Pdf, EngineEvents.PAGE_PARSED, h1);
      expect(bus.subscriberCount(EventChannel.Pdf, EngineEvents.PAGE_PARSED)).toBe(1);
    });

    it("channelCount refleja canales activos", () => {
      expect(bus.channelCount()).toBe(0);
      bus.on(EventChannel.Pdf, EngineEvents.PAGE_PARSED, vi.fn());
      expect(bus.channelCount()).toBe(1);
      bus.on(EventChannel.Ocr, EngineEvents.OCR_STARTED, vi.fn());
      expect(bus.channelCount()).toBe(2);
    });
  });

  describe("Tipado de payloads (compila)", () => {
    it("payload correcto compila (test de tipo en runtime)", () => {
      const handler = vi.fn();
      bus.on(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, handler);
      bus.emit(EventChannel.Grouping, EngineEvents.ENTITY_GROUP_CREATED, {
        documentId: "d1",
        group: {
          id: "g1",
          type: EntityType.DNI,
          canonicalValue: "34.567.891",
          members: [],
          replacementMode: ReplacementMode.Placeholder,
          replacementValue: "[DNI 01]",
          indexInType: 1,
          enabled: true,
          aliases: ["34.567.891"],
          replacementValueUserSet: false,
          createdAt: 0,
          updatedAt: 0,
        },
      });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
