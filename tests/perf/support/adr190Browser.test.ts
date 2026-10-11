import { afterEach, describe, expect, it, vi } from "vitest";

import { installTransportObserver, type InitScriptPage } from "./adr190Browser.js";
import type { Capture } from "./adr190Dpi.js";

/**
 * Un `Worker` de juguete: guarda lo que se le manda y deja a la prueba "recibir" mensajes del worker.
 * El script de `installTransportObserver` se ejecuta tal cual (es el que corre en el navegador).
 */
class FakeWorker extends EventTarget {
  readonly sent: unknown[] = [];
  constructor(_url: string | URL, _options?: WorkerOptions) {
    super();
  }
  postMessage(message?: unknown): void {
    this.sent.push(message);
  }
  terminate(): void {}
}

function isFakeWorkerConstructor(value: unknown): value is typeof FakeWorker {
  if (typeof value !== "function") return false;
  const prototype: unknown = Reflect.get(value, "prototype");
  return typeof prototype === "object" && prototype !== null && prototype instanceof FakeWorker;
}

interface Observed {
  readonly capture: Capture;
}

async function install(
  options: Parameters<typeof installTransportObserver>[1],
): Promise<typeof FakeWorker> {
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
  await installTransportObserver(page, options);
  script?.();
  if (observedWorker === undefined) throw new Error("Observed Worker was not installed");
  return observedWorker;
}

function observed(): Observed {
  const state = globalThis.__adr190;
  if (state === undefined) throw new Error("ADR-190 observer unavailable");
  return state;
}

function runOrient(worker: FakeWorker, jobId: string): void {
  worker.postMessage({
    type: "RUN",
    jobType: "ocr-orient",
    jobId,
    payload: {
      documentId: "doc",
      pageIndex: 0,
      image: { widthPx: 10, heightPx: 20, format: "png", bytes: new ArrayBuffer(4) },
    },
  });
}

function complete(worker: FakeWorker, jobId: string, result: unknown): void {
  worker.dispatchEvent(
    Object.assign(new Event("message"), { data: { type: "COMPLETED", jobId, result } }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "__adr190");
});

describe("installTransportObserver: forceOrientationVerdict", () => {
  it("el host recibe el veredicto forzado como un veredicto válido, con el inkRatio medido", async () => {
    const Worker = await install({ forceOrientationVerdict: 180 });
    const worker = new Worker("ocr.js");
    // El listener del host se registra después del de la captura, como el del pool.
    const hostSaw: unknown[] = [];
    worker.addEventListener("message", (event) => {
      hostSaw.push((event as MessageEvent).data.result);
    });
    runOrient(worker, "orient-1");
    complete(worker, "orient-1", { orientation: 0, inkRatio: 0.0012, osdHadVerdict: false });

    expect(hostSaw).toEqual([{ orientation: 180, inkRatio: 0.0012, osdHadVerdict: true }]);
    const job = observed().capture.jobs[0];
    expect(job?.result).toEqual({ orientation: 180, inkRatio: 0.0012, osdHadVerdict: true });
    // Lo que devolvió el worker queda aparte.
    expect(job?.naturalResult).toEqual({ orientation: 0, inkRatio: 0.0012, osdHadVerdict: false });
  });

  it("fuerza solo la primera detección de cada página", async () => {
    const Worker = await install({ forceOrientationVerdict: 90 });
    const worker = new Worker("ocr.js");
    runOrient(worker, "orient-1");
    complete(worker, "orient-1", { orientation: 0, inkRatio: 0.5, osdHadVerdict: true });
    runOrient(worker, "orient-2");
    complete(worker, "orient-2", { orientation: 270, inkRatio: 0.5, osdHadVerdict: true });
    const [first, second] = observed().capture.jobs;
    expect(first?.result).toMatchObject({ orientation: 90 });
    expect(second?.result).toEqual({ orientation: 270, inkRatio: 0.5, osdHadVerdict: true });
    expect(second?.naturalResult).toBeUndefined();
  });

  it("sin la opción no toca el resultado ni deja un resultado natural", async () => {
    const Worker = await install({});
    const worker = new Worker("ocr.js");
    runOrient(worker, "orient-1");
    complete(worker, "orient-1", { orientation: 0, inkRatio: 0.0012, osdHadVerdict: false });
    const job = observed().capture.jobs[0];
    expect(job?.result).toEqual({ orientation: 0, inkRatio: 0.0012, osdHadVerdict: false });
    expect(job?.naturalResult).toBeUndefined();
  });

  it("no cambia el resultado de un reconocimiento ni el payload que recibe el worker", async () => {
    const Worker = await install({ forceOrientationVerdict: 270 });
    const worker = new Worker("ocr.js");
    worker.postMessage({
      type: "RUN",
      jobType: "ocr-page",
      jobId: "page-1",
      payload: {
        documentId: "doc",
        pageIndex: 0,
        dpi: 150,
        orientation: 90,
        image: { widthPx: 10, heightPx: 20, format: "png", bytes: new ArrayBuffer(4) },
      },
    });
    complete(worker, "page-1", { words: [], confidence: 0 });
    const job = observed().capture.jobs[0];
    expect(job?.result).toEqual({ words: [], confidence: 0 });
    expect(job?.naturalResult).toBeUndefined();
    expect(job?.dispatchedOrientation).toBe(90);
    expect((worker.sent[0] as { payload: { orientation: number } }).payload.orientation).toBe(90);
  });
});

function runPage(
  worker: FakeWorker,
  jobId: string,
  jobType: "ocr-orient" | "ocr-page",
  pageIndex: number,
  documentId = "doc",
): void {
  worker.postMessage({
    type: "RUN",
    jobType,
    jobId,
    payload: {
      documentId,
      pageIndex,
      dpi: 150,
      orientation: 0,
      image: { widthPx: 10, heightPx: 20, format: "png", bytes: new ArrayBuffer(4) },
    },
  });
}

describe("installTransportObserver: forceNoVerdict", () => {
  it("B: el host recibe «sin veredicto» (orientación 0) con la tinta medida, en TODAS las páginas", async () => {
    const Worker = await install({ forceNoVerdict: { raiseInkToThreshold: false } });
    const worker = new Worker("ocr.js");
    const hostSaw: unknown[] = [];
    worker.addEventListener("message", (event) => {
      hostSaw.push((event as MessageEvent).data.result);
    });
    runPage(worker, "o1", "ocr-orient", 0);
    complete(worker, "o1", { orientation: 270, inkRatio: 0.0012, osdHadVerdict: true });
    runPage(worker, "o2", "ocr-orient", 1);
    complete(worker, "o2", { orientation: 90, inkRatio: 0.2, osdHadVerdict: true });
    // Un segundo documento (la importación en caliente): también.
    runPage(worker, "o3", "ocr-orient", 0, "doc-2");
    complete(worker, "o3", { orientation: 0, inkRatio: 0.05, osdHadVerdict: true });

    expect(hostSaw).toEqual([
      { orientation: 0, inkRatio: 0.0012, osdHadVerdict: false },
      { orientation: 0, inkRatio: 0.2, osdHadVerdict: false },
      { orientation: 0, inkRatio: 0.05, osdHadVerdict: false },
    ]);
    const [first, second] = observed().capture.jobs;
    expect(first?.naturalResult).toEqual({
      orientation: 270,
      inkRatio: 0.0012,
      osdHadVerdict: true,
    });
    expect(second?.naturalResult).toEqual({ orientation: 90, inkRatio: 0.2, osdHadVerdict: true });
  });

  it("C: además sube la tinta al umbral solo cuando quedó debajo", async () => {
    const Worker = await install({ forceNoVerdict: { raiseInkToThreshold: true } });
    const worker = new Worker("ocr.js");
    runPage(worker, "o1", "ocr-orient", 0);
    complete(worker, "o1", { orientation: 0, inkRatio: 0.0005, osdHadVerdict: false });
    runPage(worker, "o2", "ocr-orient", 1);
    complete(worker, "o2", { orientation: 0, inkRatio: 0, osdHadVerdict: false });
    runPage(worker, "o3", "ocr-orient", 2);
    complete(worker, "o3", { orientation: 0, inkRatio: 0.002, osdHadVerdict: false });
    runPage(worker, "o4", "ocr-orient", 3);
    complete(worker, "o4", { orientation: 0, inkRatio: 0.13, osdHadVerdict: true });
    const results = observed().capture.jobs.map((job) => job.result);
    expect(results).toEqual([
      { orientation: 0, inkRatio: 0.002, osdHadVerdict: false },
      { orientation: 0, inkRatio: 0.002, osdHadVerdict: false },
      { orientation: 0, inkRatio: 0.002, osdHadVerdict: false },
      { orientation: 0, inkRatio: 0.13, osdHadVerdict: false },
    ]);
    // Lo natural queda aparte, también cuando no hubo nada que subir.
    expect(observed().capture.jobs[3]?.naturalResult).toEqual({
      orientation: 0,
      inkRatio: 0.13,
      osdHadVerdict: true,
    });
  });

  it("no toca los reconocimientos ni las fallas de la detección", async () => {
    const Worker = await install({ forceNoVerdict: { raiseInkToThreshold: true } });
    const worker = new Worker("ocr.js");
    runPage(worker, "p1", "ocr-page", 0);
    complete(worker, "p1", { words: [], confidence: 0 });
    runPage(worker, "o1", "ocr-orient", 0);
    worker.dispatchEvent(
      Object.assign(new Event("message"), {
        data: { type: "FAILED", jobId: "o1", error: { code: "OCR_TIMEOUT" } },
      }),
    );
    const [page, orient] = observed().capture.jobs;
    expect(page?.result).toEqual({ words: [], confidence: 0 });
    expect(page?.naturalResult).toBeUndefined();
    expect(orient?.terminal).toBe("FAILED");
    expect(orient?.naturalResult).toBeUndefined();
  });
});

describe("installTransportObserver: lightweightResults", () => {
  const words = [
    { text: "Perez", confidence: 0.9 },
    { text: "Juan", confidence: 0.4 },
    { text: "DNI", confidence: 0.95 },
  ];

  it("guarda de una lectura solo cantidades y un hash, sin las palabras", async () => {
    const Worker = await install({ lightweightResults: true });
    const worker = new Worker("ocr.js");
    runPage(worker, "p1", "ocr-page", 0);
    complete(worker, "p1", { words, confidence: 0.77 });
    const result = observed().capture.jobs[0]?.result as Record<string, unknown>;
    expect(result).toMatchObject({ wordCount: 3, reliableWordCount: 2, confidence: 0.77 });
    expect(result.key).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(result)).not.toContain("Perez");
    expect(Object.keys(result)).not.toContain("words");
  });

  it("el hash no depende del orden de las palabras y sí de su contenido", async () => {
    const Worker = await install({ lightweightResults: true });
    const worker = new Worker("ocr.js");
    runPage(worker, "p1", "ocr-page", 0);
    complete(worker, "p1", { words, confidence: 0.5 });
    runPage(worker, "p2", "ocr-page", 1);
    complete(worker, "p2", { words: [...words].reverse(), confidence: 0.5 });
    runPage(worker, "p3", "ocr-page", 2);
    complete(worker, "p3", {
      words: [...words.slice(0, 2), { text: "DNI", confidence: 0.96 }],
      confidence: 0.5,
    });
    const keys = observed().capture.jobs.map((job) => (job.result as { key: string }).key);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
  });

  it("sin la opción el resultado de un reconocimiento queda entero, como siempre", async () => {
    const Worker = await install({});
    const worker = new Worker("ocr.js");
    runPage(worker, "p1", "ocr-page", 0);
    complete(worker, "p1", { words, confidence: 0.77 });
    expect(observed().capture.jobs[0]?.result).toEqual({ words, confidence: 0.77 });
  });
});
