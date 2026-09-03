/**
 * ADR-128 — el esqueleto del entry-point de un worker.
 *
 * **Estos tests no existían para ningún motor**, y ese es el punto: lo que la
 * factory absorbe es el mapeo de errores que cruzan la frontera, la
 * cancelación por `signalId` y la limpieza del `Map` — lo más sensible del
 * transporte, escrito cinco veces, y ejercitado solo por los escenarios E2E.
 * Cada motor tenía su propia suite con su propio doble del kernel, y ninguna
 * miraba esto.
 *
 * El `self` del entorno `node` de Vitest se stubea con lo mínimo que la
 * factory toca: `postMessage` y `addEventListener`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { CancelledError, InvalidInputError, WorkerCrashedError } from "../errors.js";
import type { WorkerInbound, WorkerOutbound } from "../interfaces.js";
import { startWorkerEntry, type WorkerEntryDefinition } from "../worker-entry.js";

interface Harness {
  /** Todo lo que el worker posteó al host, en orden. */
  readonly posted: WorkerOutbound[];
  /** Las transfer lists de cada `postMessage`, alineadas con `posted`. */
  readonly transfers: (readonly Transferable[] | undefined)[];
  /** Simula un mensaje del host hacia el worker. */
  send(message: WorkerInbound): void;
}

function install(definition: Partial<WorkerEntryDefinition> = {}): Harness {
  const posted: WorkerOutbound[] = [];
  const transfers: (readonly Transferable[] | undefined)[] = [];
  let listener: ((ev: MessageEvent<WorkerInbound>) => void) | undefined;

  vi.stubGlobal("self", {
    postMessage: (message: WorkerOutbound, options?: { transfer?: Transferable[] }) => {
      posted.push(message);
      transfers.push(options?.transfer);
    },
    addEventListener: (_type: string, fn: (ev: MessageEvent<WorkerInbound>) => void) => {
      listener = fn;
    },
  });

  startWorkerEntry({
    workerId: "test",
    jobType: "ocr-page",
    capabilities: { maxPageBatchSize: 8 },
    run: () => Promise.resolve("ok"),
    ...definition,
  });

  return {
    posted,
    transfers,
    send(message) {
      listener?.({ data: message } as MessageEvent<WorkerInbound>);
    },
  };
}

function run(jobType: WorkerInbound extends never ? never : string = "ocr-page"): WorkerInbound {
  return { type: "RUN", jobId: "j1", signalId: "j1", jobType: jobType as never, payload: { a: 1 } };
}

/** Deja correr las microtareas que `handleRun` encadena. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("startWorkerEntry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("ciclo de vida", () => {
    it("postea READY apenas se instala, sin esperar INIT", () => {
      const h = install();
      expect(h.posted).toHaveLength(1);
      expect(h.posted[0]).toMatchObject({ type: "READY", capabilities: { maxPageBatchSize: 8 } });
    });

    /*
     * `pdf-engine` corre el motor real del otro lado y no puede decirse listo
     * antes de que `engine.init()` termine. Los otros cuatro corren un kernel
     * sin init y postean el READY de una.
     */
    it("con `ready`, el READY eager espera a que resuelva", async () => {
      let resolveReady: (() => void) | undefined;
      const h = install({
        ready: new Promise<void>((resolve) => {
          resolveReady = resolve;
        }),
      });

      expect(h.posted).toHaveLength(0);
      resolveReady?.();
      await flush();
      expect(h.posted).toHaveLength(1);
      expect(h.posted[0]).toMatchObject({ type: "READY" });
    });

    it("le pone al workerId el prefijo del motor y un sufijo propio", () => {
      const a = install();
      vi.unstubAllGlobals();
      const b = install();
      const idA = (a.posted[0] as { workerId: string }).workerId;
      const idB = (b.posted[0] as { workerId: string }).workerId;
      expect(idA).toMatch(/^test-worker-/);
      expect(idA).not.toBe(idB);
    });

    it("adopta la config de INIT y vuelve a postear READY", () => {
      const applyConfig = vi.fn();
      const h = install({ applyConfig });
      h.send({ type: "INIT", config: { workerPool: {} } });

      expect(applyConfig).toHaveBeenCalledWith({ workerPool: {} });
      expect(h.posted.filter((m) => m.type === "READY")).toHaveLength(2);
    });

    /*
     * La divergencia de ciclo de vida que la factory absorbe sin caso
     * especial: `pdf-engine` no puede decir READY hasta que su `engine.init()`
     * resuelve, porque su worker corre el motor real.
     */
    it("con un applyConfig asíncrono, el READY espera a que resuelva", async () => {
      let resolveInit: (() => void) | undefined;
      const h = install({
        applyConfig: () =>
          new Promise<void>((resolve) => {
            resolveInit = resolve;
          }),
      });
      h.send({ type: "INIT", config: null });

      expect(h.posted.filter((m) => m.type === "READY")).toHaveLength(1); // solo el eager
      resolveInit?.();
      await flush();
      expect(h.posted.filter((m) => m.type === "READY")).toHaveLength(2);
    });

    it("invoca dispose en DISPOSE, y tolera no tenerlo", () => {
      const dispose = vi.fn();
      const h = install({ dispose });
      h.send({ type: "DISPOSE" });
      expect(dispose).toHaveBeenCalledOnce();

      vi.unstubAllGlobals();
      const sinDispose = install();
      expect(() => sinDispose.send({ type: "DISPOSE" })).not.toThrow();
    });
  });

  describe("RUN", () => {
    it("rechaza un jobType que este worker no acepta, sin correr nada", async () => {
      const runFn = vi.fn();
      const h = install({ run: runFn });
      h.send(run("render-page"));
      await flush();

      expect(runFn).not.toHaveBeenCalled();
      const failed = h.posted.find((m) => m.type === "FAILED");
      expect(failed).toMatchObject({ type: "FAILED", jobId: "j1" });
      expect(JSON.stringify(failed)).toContain("render-page");
    });

    it("pasa el payload crudo y devuelve COMPLETED con el resultado", async () => {
      const runFn = vi.fn().mockResolvedValue({ words: [] });
      const h = install({ run: runFn });
      h.send(run());
      await flush();

      expect(runFn.mock.calls[0]?.[0]).toEqual({ a: 1 });
      expect(h.posted.at(-1)).toEqual({ type: "COMPLETED", jobId: "j1", result: { words: [] } });
    });

    it("expone progress(), que es como ner-engine reporta la carga del modelo", async () => {
      const h = install({
        run: (_payload, ctx) => {
          ctx.progress(0.5, { phase: "download" });
          return Promise.resolve(null);
        },
      });
      h.send(run());
      await flush();

      expect(h.posted).toContainEqual({
        type: "PROGRESS",
        jobId: "j1",
        progress: 0.5,
        partial: { phase: "download" },
      });
    });
  });

  describe("errores que cruzan la frontera", () => {
    it("CancelledError sale como CANCELLED, no como FAILED", async () => {
      const h = install({ run: () => Promise.reject(new CancelledError("doc-1")) });
      h.send(run());
      await flush();

      expect(h.posted.at(-1)).toEqual({ type: "CANCELLED", jobId: "j1", signalId: "j1" });
    });

    it("un EngineError sale serializado, conservando su code y su retryable", async () => {
      const crashed = new WorkerCrashedError("el slot 0 murió");
      const h = install({ run: () => Promise.reject(crashed) });
      h.send(run());
      await flush();

      const last = h.posted.at(-1) as {
        type: string;
        error: { code: string; message: string; retryable: boolean };
      };
      expect(last.type).toBe("FAILED");
      expect(last.error.code).toBe(crashed.code);
      expect(last.error.message).toContain("el slot 0 murió");
      // `retryable` es lo que el pool mira para decidir si reintenta: si se
      // pierde al cruzar, un crash recuperable deja de recuperarse.
      expect(last.error.retryable).toBe(crashed.retryable);
    });

    /*
     * El caso que más barato sería perder al copiar el bloque a mano: un throw
     * que no es `EngineError` no tiene `serialize()`, y sin este envoltorio el
     * host recibiría un mensaje vacío o un error de serialización en vez del
     * motivo real.
     */
    it("un throw que no es EngineError se envuelve conservando el mensaje", async () => {
      const h = install({ run: () => Promise.reject(new TypeError("undefined no es función")) });
      h.send(run());
      await flush();

      const last = h.posted.at(-1) as { type: string; error: { code: string; message: string } };
      expect(last.type).toBe("FAILED");
      expect(last.error.code).toBe(new InvalidInputError("x").code);
      expect(last.error.message).toContain("undefined no es función");
    });

    it("un throw que no es Error tampoco pierde su motivo", async () => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- el caso es justamente que no sea un Error
      const h = install({ run: () => Promise.reject("string suelto") });
      h.send(run());
      await flush();

      expect(JSON.stringify(h.posted.at(-1))).toContain("string suelto");
    });
  });

  describe("cancelación", () => {
    it("CANCEL aborta el signal del job en vuelo", async () => {
      let seen: AbortSignal | undefined;
      const h = install({
        run: (_payload, ctx) => {
          seen = ctx.abortSignal;
          return new Promise(() => {
            /* nunca resuelve: el job queda en vuelo */
          });
        },
      });
      h.send(run());
      await flush();

      expect(seen?.aborted).toBe(false);
      h.send({ type: "CANCEL", jobId: "j1", signalId: "j1" });
      expect(seen?.aborted).toBe(true);
    });

    /*
     * `export-engine` descarta ahí su `PDFDocument` parcial (ADR-047 §4). Sin
     * este punto de enganche, migrarlo perdería el descarte en silencio: el
     * export cancelado dejaría el documento a medias y el job siguiente le
     * apendearía encima.
     */
    it("invoca onCancel además de abortar, incluso sin job en vuelo", () => {
      const onCancel = vi.fn();
      const h = install({ onCancel });

      h.send({ type: "CANCEL", jobId: "desconocido", signalId: "desconocido" });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("CANCEL con un signalId desconocido no lanza", () => {
      const h = install();
      expect(() => h.send({ type: "CANCEL", jobId: "x", signalId: "x" })).not.toThrow();
    });

    /*
     * La limpieza del `Map` es lo que evita que un worker de vida larga
     * acumule un `AbortController` por job para siempre. Se prueba por su
     * efecto observable: tras terminar, el `CANCEL` de ese job ya no aborta a
     * nadie — en particular, no al job siguiente que reuse el `signalId`.
     */
    it("borra el controller del Map termine como termine el job", async () => {
      const signals: AbortSignal[] = [];
      const h = install({
        run: (_payload, ctx) => {
          signals.push(ctx.abortSignal);
          return signals.length === 1 ? Promise.reject(new Error("falla")) : Promise.resolve("ok");
        },
      });

      h.send(run());
      await flush();
      h.send({ type: "CANCEL", jobId: "j1", signalId: "j1" }); // el job 1 ya terminó

      h.send(run());
      await flush();
      expect(signals[1]?.aborted).toBe(false);
      expect(h.posted.at(-1)).toMatchObject({ type: "COMPLETED", result: "ok" });
    });
  });

  describe("transferencia", () => {
    it("manda en la transfer list lo que declara transferablesOf", async () => {
      const buffer = new ArrayBuffer(8);
      const h = install({
        run: () => Promise.resolve(buffer),
        transferablesOf: (result) => (result instanceof ArrayBuffer ? [result] : []),
      });
      h.send(run());
      await flush();

      expect(h.transfers.at(-1)).toEqual([buffer]);
    });

    it("sin transferablesOf, o con lista vacía, postea sin opciones (clona)", async () => {
      const h = install({ run: () => Promise.resolve({ sin: "transferibles" }) });
      h.send(run());
      await flush();

      expect(h.transfers.at(-1)).toBeUndefined();
    });
  });
});
