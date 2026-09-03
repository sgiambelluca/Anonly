// ADR-128: el esqueleto del `worker/entry.ts` de un motor, en un solo lugar.
//
// Estaba escrito cinco veces (`Duplicacion_De_Logica.md` §1) y ya había
// divergido: la firma de `post()` no era la misma en los cinco. Lo que se
// copiaba es lo más sensible del transporte —el mapeo de errores que cruzan la
// frontera, la cancelación por `signalId` y la limpieza del `Map`—, y es
// también lo que ninguna suite unitaria ejercita: los `entry.ts` solo corren
// de verdad en los escenarios E2E.
//
// **Este módulo no importa nada de Web Workers.** Referencia `self` dentro del
// cuerpo de las funciones, nunca a nivel de módulo, así que importar
// `@anonly/shared` desde el hilo principal no ejecuta nada de esto. Es lo que
// permite que viva en un paquete que se bundlea a producción.

import type { WorkerJobType } from "./enums.js";
import { CancelledError, EngineError, InvalidInputError } from "./errors.js";
import type { Serializable, WorkerInbound, WorkerOutbound } from "./interfaces.js";
import type { WorkerCapabilities } from "./types.js";

/**
 * Postea un mensaje al host desde dentro del Worker.
 *
 * Válvula para lo que vive **fuera** del ciclo de un job (ADR-128 §2): hoy su
 * único caller legítimo es el puente de `EVENT`/`LOG` de `pdf-engine`, que se
 * arma una vez en `INIT` porque ese worker corre el motor real y ese motor
 * emite y loguea. Cualquier otro uso hay que mirarlo con desconfianza: lo que
 * pertenece a un job sale por el `ctx` de `run`.
 */
export function postWorkerMessage(
  message: WorkerOutbound,
  transfer?: ReadonlyArray<Transferable>,
): void {
  // Forma `StructuredSerializeOptions` y no la posicional `(message, [])`:
  // con `lib: ["DOM", "WebWorker"]` (tsconfig.base) el overload posicional de
  // `Window` gana y no acepta una transfer list. La copia mutable es porque
  // `StructuredSerializeOptions.transfer` es `Transferable[]`, no readonly.
  if (transfer !== undefined && transfer.length > 0) {
    self.postMessage(message, { transfer: [...transfer] });
  } else {
    self.postMessage(message);
  }
}

/** Lo único que un job necesita del transporte. */
export interface WorkerJobContext {
  /** Se aborta cuando el host manda `CANCEL` con el `signalId` de este job. */
  readonly abortSignal: AbortSignal;
  readonly jobId: string;
  /**
   * Postea `PROGRESS` para este job. Lo usa `ner-engine` desde su kernel.
   *
   * Declarada como **propiedad de función** y no como método: un método suelto
   * dispara `@typescript-eslint/unbound-method` en cada consumidor que lo pase
   * por referencia (`onProgress: ctx.progress`), que es justamente como se
   * quiere usar. El cierre que la factory construye no depende de `this`.
   */
  readonly progress: (progress: number, partial?: Serializable) => void;
}

export interface WorkerEntryDefinition {
  /** Prefijo del `workerId`; la factory le agrega el sufijo aleatorio. */
  readonly workerId: string;
  /** El único `jobType` que este worker acepta; cualquier otro se rechaza. */
  readonly jobType: WorkerJobType;
  readonly capabilities: WorkerCapabilities;
  /**
   * Adopta la config que llega por `INIT`. **Puede devolver una promesa**: el
   * `READY` se postea recién cuando resuelve, que es lo que necesita
   * `pdf-engine` para esperar a su `engine.init()` sin un caso especial.
   */
  readonly applyConfig?: (config: unknown) => void | Promise<void>;
  /** El trabajo. `payload` es `unknown` a nivel de transporte (ADR-019). */
  readonly run: (payload: unknown, ctx: WorkerJobContext) => Promise<unknown>;
  /** Libera lo que el worker retenga. Se invoca en `DISPOSE`. */
  readonly dispose?: () => void;
  /**
   * Qué transferir junto al `COMPLETED`, mirando el resultado. Devolver `[]`
   * —o no declararla— clona, que es el default seguro: transferir de más
   * lanza.
   */
  readonly transferablesOf?: (result: unknown) => ReadonlyArray<Transferable>;
}

/**
 * Instala el ciclo de vida completo del entry-point de un worker de motor y
 * postea el `READY` eager.
 *
 * El `READY` eager existe porque `WorkerPool` no manda `INIT` con la config
 * real todavía y `RUN` ya se encola sin esperarlo (gap conocido, ADR-036 §2).
 * Si el `INIT` llega, se re-adopta la config y se postea `READY` de nuevo.
 */
export function startWorkerEntry(definition: WorkerEntryDefinition): void {
  const workerId = `${definition.workerId}-worker-${Math.random().toString(36).slice(2)}`;

  /**
   * Un `AbortController` por job en curso, indexado por `signalId`
   * (`=== jobId`, ver `worker-pool.ts#dispatchRemote`).
   */
  const jobControllers = new Map<string, AbortController>();

  function postReady(): void {
    postWorkerMessage({ type: "READY", workerId, capabilities: definition.capabilities });
  }

  async function handleRun(message: Extract<WorkerInbound, { type: "RUN" }>): Promise<void> {
    const { jobId, signalId, jobType, payload } = message;

    if (jobType !== definition.jobType) {
      postWorkerMessage({
        type: "FAILED",
        jobId,
        error: new InvalidInputError(
          `${definition.workerId}Worker no soporta jobType '${jobType}'.`,
          { jobType },
        ).serialize(),
      });
      return;
    }

    const controller = new AbortController();
    jobControllers.set(signalId, controller);

    try {
      const result = await definition.run(payload, {
        abortSignal: controller.signal,
        jobId,
        progress(progress, partial) {
          postWorkerMessage({ type: "PROGRESS", jobId, progress, partial });
        },
      });
      // ADR-042: `COMPLETED.result` es `unknown` a nivel de transporte — el
      // host-bridge de cada motor afina el tipo concreto que produjo.
      postWorkerMessage({ type: "COMPLETED", jobId, result }, definition.transferablesOf?.(result));
    } catch (err: unknown) {
      if (err instanceof CancelledError) {
        postWorkerMessage({ type: "CANCELLED", jobId, signalId });
      } else if (err instanceof EngineError) {
        postWorkerMessage({ type: "FAILED", jobId, error: err.serialize() });
      } else {
        // Un throw que no es `EngineError` no puede perder su mensaje al
        // cruzar: se envuelve conservándolo.
        const reason = err instanceof Error ? err.message : String(err);
        postWorkerMessage({
          type: "FAILED",
          jobId,
          error: new InvalidInputError(reason).serialize(),
        });
      }
    } finally {
      jobControllers.delete(signalId);
    }
  }

  self.addEventListener("message", (ev: MessageEvent<WorkerInbound>) => {
    const message = ev.data;
    switch (message.type) {
      case "INIT": {
        const applied = definition.applyConfig?.(message.config);
        if (applied instanceof Promise) {
          void applied.then(postReady);
        } else {
          postReady();
        }
        break;
      }
      case "RUN":
        void handleRun(message);
        break;
      case "CANCEL":
        jobControllers.get(message.signalId)?.abort();
        break;
      case "DISPOSE":
        definition.dispose?.();
        break;
    }
  });

  postReady();
}
