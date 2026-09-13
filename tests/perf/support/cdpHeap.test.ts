/**
 * `cdpHeap.test.ts` — cubre `classifyTargets`, la parte de `cdpHeap.ts`
 * (ADR-159 §2) que no depende de una conexión CDP real: dado un snapshot de
 * targets ya leídos, decide qué es cada uno por estructura (padre/hijos e
 * igualdad de `url` entre hermanos).
 *
 * Las formas de los fixtures no son inventadas: reproducen el árbol que
 * `tests/perf/support/__cdp_probe.mts` (borrado, no forma parte del PR)
 * midió corriendo la app real contra el perfil P2 — ver el docstring de
 * `cdpHeap.ts` para la evidencia. La conexión CDP en sí (descubrir el
 * puerto, el WebSocket, el auto-attach recursivo) se verifica corriendo
 * `pnpm test:perf`, no con un mock acá: mockear el WebSocket probaría que el
 * parser entiende los mensajes que YO le doy, no que el protocolo real
 * funciona — exactamente el tipo de instrumento que "mide mal sin tirar
 * error" que esta campaña ya se tropezó tres veces.
 */
import { describe, expect, it } from "vitest";

import { classifyTargets, type RawTargetHeapReading } from "./cdpHeap.js";

function target(
  overrides: Partial<RawTargetHeapReading> & Pick<RawTargetHeapReading, "sessionId">,
): RawTargetHeapReading {
  return {
    parentSessionId: undefined,
    type: "worker",
    url: "app://local/assets/entry-XXXX.js",
    attachedAtMs: 0,
    usedSizeBytes: 1_000_000,
    totalSizeBytes: 2_000_000,
    embedderHeapUsedSizeBytes: 100_000,
    backingStorageSizeBytes: 100_000,
    readError: undefined,
    ...overrides,
  };
}

describe("classifyTargets", () => {
  it("etiqueta la página como main cuando es el único root", () => {
    const [main] = classifyTargets([
      target({ sessionId: "page", type: "page", url: "app://local/index.html" }),
    ]);
    expect(main?.label).toBe("main");
  });

  it("etiqueta un worker con dos hijos de url blob: DISTINTA como ocr, y ordena lstm antes que osd", () => {
    // Reproduce ocr-engine/src/worker/kernel.ts: ensureWorkerLoaded (LSTM)
    // se crea antes que ensureOsdWorkerLoaded (OSD) dentro de la misma
    // kernelRecognize — cada createWorker() envuelve su script en un blob
    // NUEVO (workerBlobURL: true, default de tesseract.js), así que las dos
    // urls hijas son distintas entre sí.
    const samples = classifyTargets([
      target({ sessionId: "page", type: "page", url: "app://local/index.html" }),
      target({ sessionId: "ocr1", parentSessionId: "page", attachedAtMs: 100 }),
      target({
        sessionId: "ocr1-lstm",
        parentSessionId: "ocr1",
        url: "blob:app://local/aaaa",
        attachedAtMs: 200,
      }),
      target({
        sessionId: "ocr1-osd",
        parentSessionId: "ocr1",
        url: "blob:app://local/bbbb",
        attachedAtMs: 300,
      }),
    ]);
    const byId = new Map(samples.map((s) => [s.sessionId, s]));
    expect(byId.get("ocr1")?.label).toBe("ocr-worker-1");
    expect(byId.get("ocr1-lstm")?.label).toBe("ocr-worker-1/tesseract-lstm");
    expect(byId.get("ocr1-osd")?.label).toBe("ocr-worker-1/tesseract-osd");
  });

  it("etiqueta un worker con varios hijos que COMPARTEN la misma url blob: como thread-pool, no como ocr", () => {
    // Reproduce el pool de pthreads de onnxruntime-web que arma ner-engine
    // cuando su backend WASM habilita hilos: un único script compilado,
    // reusado por todo el pool — a diferencia de tesseract.js, que crea un
    // blob nuevo por createWorker(). Es justo el caso que un conteo fijo de
    // "2 hijos = ocr" clasificaría mal si el pool tuviera 2 hilos.
    const samples = classifyTargets([
      target({ sessionId: "page", type: "page", url: "app://local/index.html" }),
      target({ sessionId: "ner1", parentSessionId: "page", attachedAtMs: 100 }),
      target({
        sessionId: "ner1-t0",
        parentSessionId: "ner1",
        url: "blob:app://local/shared",
        attachedAtMs: 200,
      }),
      target({
        sessionId: "ner1-t1",
        parentSessionId: "ner1",
        url: "blob:app://local/shared",
        attachedAtMs: 210,
      }),
      target({
        sessionId: "ner1-t2",
        parentSessionId: "ner1",
        url: "blob:app://local/shared",
        attachedAtMs: 220,
      }),
    ]);
    const byId = new Map(samples.map((s) => [s.sessionId, s]));
    expect(byId.get("ner1")?.label).toBe("thread-pool-worker-1");
    expect(byId.get("ner1-t0")?.label).toBe("thread-pool-worker-1/thread-0");
    expect(byId.get("ner1-t1")?.label).toBe("thread-pool-worker-1/thread-1");
    expect(byId.get("ner1-t2")?.label).toBe("thread-pool-worker-1/thread-2");
  });

  it("etiqueta un worker sin hijos como leaf-worker, numerado por orden de aparición", () => {
    const samples = classifyTargets([
      target({ sessionId: "page", type: "page", url: "app://local/index.html" }),
      target({ sessionId: "pdf1", parentSessionId: "page", attachedAtMs: 50 }),
      target({ sessionId: "render1", parentSessionId: "page", attachedAtMs: 100 }),
    ]);
    const byId = new Map(samples.map((s) => [s.sessionId, s]));
    expect(byId.get("pdf1")?.label).toBe("leaf-worker-1");
    expect(byId.get("render1")?.label).toBe("leaf-worker-2");
  });

  it("clasifica un ocr worker con un solo hijo (LSTM creado, OSD todavía no) como ocr, no como leaf", () => {
    // Estado transitorio real: `ensureWorkerLoaded` (LSTM) ya resolvió,
    // `ensureOsdWorkerLoaded` (OSD) todavía no corrió. Con un único hijo la
    // regla "urls hijas distintas entre sí" es trivialmente cierta.
    const samples = classifyTargets([
      target({ sessionId: "page", type: "page", url: "app://local/index.html" }),
      target({ sessionId: "ocr1", parentSessionId: "page", attachedAtMs: 100 }),
      target({
        sessionId: "ocr1-lstm",
        parentSessionId: "ocr1",
        url: "blob:app://local/aaaa",
        attachedAtMs: 200,
      }),
    ]);
    const byId = new Map(samples.map((s) => [s.sessionId, s]));
    expect(byId.get("ocr1")?.label).toBe("ocr-worker-1");
    expect(byId.get("ocr1-lstm")?.label).toBe("ocr-worker-1/tesseract-lstm");
  });

  it("conserva el error de lectura de heap sin que afecte la clasificación", () => {
    const samples = classifyTargets([
      target({ sessionId: "page", type: "page", url: "app://local/index.html" }),
      target({
        sessionId: "ocr1",
        parentSessionId: "page",
        attachedAtMs: 100,
        usedSizeBytes: undefined,
        totalSizeBytes: undefined,
        readError: "Session with given id not found. (CDP -32001)",
      }),
    ]);
    const ocr = samples.find((s) => s.sessionId === "ocr1");
    expect(ocr?.label).toBe("leaf-worker-1");
    expect(ocr?.readError).toBe("Session with given id not found. (CDP -32001)");
  });

  it("numera main-N cuando hay más de un root en el mismo snapshot (defensivo, no se observó en la práctica)", () => {
    const samples = classifyTargets([
      target({ sessionId: "page-a", type: "page", url: "app://local/index.html" }),
      target({ sessionId: "page-b", type: "page", url: "app://local/other.html" }),
    ]);
    const byId = new Map(samples.map((s) => [s.sessionId, s]));
    expect(byId.get("page-a")?.label).toBe("main-1");
    expect(byId.get("page-b")?.label).toBe("main-2");
  });
});
