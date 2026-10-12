import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { installTransportObserver, type InitScriptPage } from "./adr190Browser.js";
import { captureInPage, installInPage } from "./osdVerdictM3Collector.js";

type Handler = (payload: unknown) => void;
interface M3TestState {
  readonly unreadable: object;
  readonly entities: object;
}

function readM3State(): M3TestState {
  const state: unknown = Reflect.get(globalThis, "__anonlyM3");
  if (typeof state !== "object" || state === null) throw new Error("M3 state missing");
  return state as M3TestState;
}

function fakeCore(documents: Map<string, unknown>) {
  const handlers = new Map<string, Handler[]>();
  const core = {
    bus: {
      on(channel: string, event: string, handler: Handler): void {
        const key = `${channel}/${event}`;
        handlers.set(key, [...(handlers.get(key) ?? []), handler]);
      },
    },
    orchestrator: { documents },
  };
  const emit = (channel: string, event: string, payload: unknown): void => {
    for (const handler of handlers.get(`${channel}/${event}`) ?? []) handler(payload);
  };
  return { core, emit, handlerCount: (key: string) => handlers.get(key)?.length ?? 0 };
}

function job(overrides: Record<string, unknown>) {
  return {
    jobId: "j",
    jobType: "ocr-page",
    documentId: "doc-1",
    pageIndex: 0,
    startedAt: 0,
    finishedAt: 100,
    dpi: 150,
    orientation: 0,
    upscale: 1,
    terminal: "COMPLETED",
    result: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  // El estado de la página queda en `globalThis`: cada prueba empieza como una página nueva.
  Reflect.deleteProperty(globalThis, "__anonlyM3");
});

describe("osdVerdictM3Collector", () => {
  it("instala los oyentes una sola vez y reinicia el estado en cada importación", () => {
    const { core, emit, handlerCount } = fakeCore(new Map());
    vi.stubGlobal("__anonlyCore", core);
    installInPage();
    expect(handlerCount("ocr/OCR_PAGE_FINISHED")).toBe(1);
    expect(handlerCount("regex/ENTITY_FOUND")).toBe(1);
    expect(handlerCount("ner/ENTITY_FOUND")).toBe(1);
    emit("ocr", "OCR_PAGE_FINISHED", { pageIndex: 0, confidence: 0.9, unreadableInk: true });
    expect(readM3State().unreadable).toEqual({ 0: true });
    // Reinstalarlo (la importación en caliente) no duplica los oyentes y deja el estado en blanco.
    installInPage();
    expect(handlerCount("ocr/OCR_PAGE_FINISHED")).toBe(1);
    expect(readM3State().unreadable).toEqual({});
    emit("regex", "ENTITY_FOUND", {
      occurrence: { entityType: "DNI", pageIndex: 2, value: "secreto" },
    });
    emit("ner", "ENTITY_FOUND", {
      occurrence: { entityType: "PERSON", pageIndex: 2, value: "otro" },
    });
    emit("regex", "ENTITY_FOUND", { occurrence: { entityType: "DNI", pageIndex: 2 } });
    emit("regex", "ENTITY_FOUND", { occurrence: { pageIndex: 2 } });
    expect(readM3State().entities).toEqual({ 2: { DNI: 2, PERSON: 1 } });
  });

  it("sin el Core de pruebas no instala nada", () => {
    vi.stubGlobal("__anonlyCore", undefined);
    expect(() => installInPage()).toThrow("__anonlyCore ausente");
  });

  describe("captureInPage", () => {
    const words = [
      { text: "Perez", confidence: 0.9 },
      { text: "Juan", confidence: 0.4 },
    ];
    const setup = (jobs: unknown[]) => {
      const documents = new Map([
        [
          "doc-1",
          {
            pages: [
              { index: 0, words },
              { index: 1, words: [] },
            ],
          },
        ],
      ]);
      const { core, emit } = fakeCore(documents);
      vi.stubGlobal("__anonlyCore", core);
      vi.stubGlobal("__anonlyMemoryRun", { documentId: "doc-1" });
      vi.stubGlobal("__adr190", { capture: { jobs } });
      installInPage();
      return emit;
    };

    it("junta por página el resultado de orientación, los reconocimientos, lo entregado y lo observado", async () => {
      const emit = setup([
        job({
          jobId: "o0",
          jobType: "ocr-orient",
          startedAt: 1,
          result: { orientation: 0, osdHadVerdict: false, inkRatio: 0.002 },
          naturalResult: { orientation: 0, osdHadVerdict: false, inkRatio: 0.001 },
        }),
        job({
          jobId: "a0",
          startedAt: 10,
          dispatchedOrientation: 0,
          result: { wordCount: 2, reliableWordCount: 1, confidence: 0.6, key: "k0" },
        }),
        job({
          jobId: "a1",
          startedAt: 20,
          finishedAt: 50,
          dispatchedOrientation: 90,
          result: { wordCount: 3, reliableWordCount: 0, confidence: 0.1, key: "k1" },
        }),
        // De otro documento: no entra.
        job({ jobId: "x", documentId: "doc-0", startedAt: 5 }),
      ]);
      emit("ocr", "OCR_PAGE_FINISHED", { pageIndex: 0, confidence: 0.62 });
      emit("regex", "ENTITY_FOUND", {
        occurrence: { entityType: "DNI", pageIndex: 0, value: "no sale" },
      });

      const snapshot = await captureInPage();
      expect(snapshot.observer).toBe(true);
      expect(snapshot.ocrPageJobs).toBe(2);
      const [first, second] = snapshot.pages;
      expect(first).toMatchObject({
        pageIndex: 0,
        natural: { orientation: 0, osdHadVerdict: false, inkRatio: 0.001 },
        orientation: { orientation: 0, osdHadVerdict: false, inkRatio: 0.002 },
        confidence: 0.62,
        unreadableInk: false,
        entityCounts: { DNI: 1 },
      });
      expect(first?.attempts.map((a) => [a.order, a.angle, a.durationMs, a.key])).toEqual([
        [0, 0, 90, "k0"],
        [1, 90, 30, "k1"],
      ]);
      expect(first?.delivered).toMatchObject({ wordCount: 2, reliableWordCount: 1 });
      expect(first?.delivered?.textSha256).toBe(
        createHash("sha256").update("Perez\nJuan").digest("hex"),
      );
      expect(second).toMatchObject({
        natural: null,
        orientation: null,
        attempts: [],
        confidence: null,
      });
      expect(second?.delivered).toMatchObject({ wordCount: 0, reliableWordCount: 0 });
    });

    it("lo que sale no incluye ni las palabras ni los valores de las entidades", async () => {
      const emit = setup([
        job({
          jobId: "a0",
          result: { wordCount: 2, reliableWordCount: 1, confidence: 0.6, key: "k0" },
        }),
      ]);
      emit("regex", "ENTITY_FOUND", {
        occurrence: { entityType: "DNI", pageIndex: 0, value: "34567891" },
      });
      const json = JSON.stringify(await captureInPage());
      for (const secret of ["Perez", "Juan", "34567891"]) expect(json).not.toContain(secret);
    });

    it("sin observador de transporte lo dice y no tiene reconocimientos", async () => {
      setup([]);
      vi.stubGlobal("__adr190", undefined);
      const snapshot = await captureInPage();
      expect(snapshot.observer).toBe(false);
      expect(snapshot.ocrPageJobs).toBe(0);
      expect(snapshot.pages[0]?.attempts).toEqual([]);
    });

    it("sin documento de la corrida es un error, no un cero", async () => {
      setup([]);
      vi.stubGlobal("__anonlyMemoryRun", {});
      await expect(captureInPage()).rejects.toThrow(
        "el documento de la corrida no está disponible",
      );
    });

    it("el hash de lo entregado coincide con el que calcula el observador de transporte", async () => {
      // El observador (adr190Browser) y el colector calculan el mismo hash: así se empareja la lectura
      // entregada con su reconocimiento y se sabe en qué ángulo se leyó.
      class FakeWorker extends EventTarget {
        constructor(_url?: string) {
          super();
        }
        postMessage(_message?: unknown): void {}
        terminate(): void {}
      }
      function isFakeWorkerConstructor(value: unknown): value is typeof FakeWorker {
        if (typeof value !== "function") return false;
        const prototype: unknown = Reflect.get(value, "prototype");
        return (
          typeof prototype === "object" && prototype !== null && prototype instanceof FakeWorker
        );
      }
      vi.stubGlobal("Worker", FakeWorker);
      let script: (() => void) | undefined;
      let observedWorker: typeof FakeWorker | undefined;
      const page: InitScriptPage = {
        addInitScript(fn, arg) {
          if (typeof fn === "function")
            script = () => {
              Reflect.apply(fn, undefined, [arg]);
              const candidate: unknown = Reflect.get(globalThis, "Worker");
              if (isFakeWorkerConstructor(candidate)) observedWorker = candidate;
            };
          return Promise.resolve({
            dispose: () => Promise.resolve(),
            [Symbol.asyncDispose]: () => Promise.resolve(),
          });
        },
      };
      await installTransportObserver(page, { lightweightResults: true });
      script?.();
      if (observedWorker === undefined) throw new Error("Observed Worker was not installed");
      const worker = new observedWorker("ocr.js");
      worker.postMessage({
        type: "RUN",
        jobType: "ocr-page",
        jobId: "p1",
        payload: {
          documentId: "doc-1",
          pageIndex: 0,
          dpi: 150,
          orientation: 180,
          image: { widthPx: 1, heightPx: 1, format: "png", bytes: new ArrayBuffer(1) },
        },
      });
      worker.dispatchEvent(
        Object.assign(new Event("message"), {
          // Las mismas palabras que entrega el documento, en otro orden.
          data: {
            type: "COMPLETED",
            jobId: "p1",
            result: { words: [...words].reverse(), confidence: 0.6 },
          },
        }),
      );
      const documents = new Map([["doc-1", { pages: [{ index: 0, words }] }]]);
      const { core } = fakeCore(documents);
      vi.stubGlobal("__anonlyCore", core);
      vi.stubGlobal("__anonlyMemoryRun", { documentId: "doc-1" });
      installInPage();
      const snapshot = await captureInPage();
      const pageSnapshot = snapshot.pages[0];
      expect(pageSnapshot?.attempts[0]?.key).toBe(pageSnapshot?.delivered?.key);
      expect(pageSnapshot?.attempts[0]).toMatchObject({
        angle: 180,
        wordCount: 2,
        reliableWordCount: 1,
      });
    });
  });
});
