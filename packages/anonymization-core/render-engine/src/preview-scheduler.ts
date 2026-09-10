/**
 * @anonly/render-engine — `PreviewRenderScheduler` (ADR-144 §2-§8).
 *
 * Wiring interno de `RenderEngine`, NO exportado desde `index.ts` (mismo
 * criterio que `RenderJobPool`/`RenderDispatchParams` en `render.engine.ts`,
 * su nota 7 de cabecera). Resuelve D-08 del plan de campaña de hardening:
 * `Orchestrator.seedAnonymizedPreview` dispara un `renderPage` por página sin
 * esperar, y `WorkerPool.enqueue` acepta encolar de más aunque emita
 * `WORKER_POOL_SATURATED`. El trabajo PESADO de un preview pasa por acá,
 * acotado a `renderPoolSize` despachos simultáneos — el registro del input
 * autoritativo (`rememberInput`) NO pasa por acá: sigue corriendo sincrónico
 * en `RenderEngine#renderPageInternal`, antes de programar nada (ADR-144 §1).
 *
 * Solo `mode: "preview"` pasa por este planificador (ADR-144 §2, Decisión):
 * `mode: "full"` (export) despacha inmediato con prioridad 1000, fuera de
 * este archivo — nunca se coalesce ni se demora.
 *
 * Mecánica (ADR-144 §3-§6):
 * - Coalescencia por clave: una solicitud nueva sobre una clave con trabajo
 *   pendiente NO dispara nada nuevo — bumpea la generación y el máximo de
 *   prioridad, y devuelve la MISMA promesa compartida (§3).
 * - El trabajo real (`runJob`) se invoca con la prioridad VIGENTE en ese
 *   momento (la coalescida por `Math.max`), para que un redespacho por una
 *   solicitud más urgente use la prioridad nueva al hablar con el kernel. Si
 *   al resolver la generación cambió (alguien coalesció una solicitud más
 *   nueva mientras corría), el resultado se descarta sin cachear/emitir y se
 *   redespacha — `runJob` es responsable de leer su propio input fresco en
 *   cada invocación (ADR-144 §5); este planificador no retiene ningún input.
 * - `onSettle` es el ÚNICO punto donde se cachea/emite: corre una sola vez,
 *   solo si la generación no quedó vieja durante el despacho, antes de
 *   resolver la promesa compartida (§6).
 * - La generación de referencia (`myGeneration`) se captura DESPUÉS de
 *   reservar el slot de concurrencia, no antes: un `await` siempre cede el
 *   turno al menos un microtask aunque el slot esté libre de entrada, y una
 *   ráfaga de `schedule()` SÍNCRONOS sobre la misma clave (coalescencia
 *   real, sin ninguna espera genuina de por medio) alcanza a bumpear la
 *   generación antes de que la reserva del primer despacho retome.
 *   Capturarla antes de reservar (lectura más literal de "el cupo se
 *   reserva antes de despachar") haría que ese primer despacho, que nunca
 *   llegó a correr con datos obsoletos, se descartara igual como "viejo" —
 *   dos despachos reales para una ráfaga que debía coalescer en uno solo,
 *   justo el caso que motiva el ADR. Capturarla después de la reserva sigue
 *   detectando el caso que sí importa (una generación que cambia mientras
 *   `runJob` está GENUINAMENTE en vuelo, ver el test de generación vieja);
 *   ver el comentario puntual en `runDispatchLoop`.
 * - Concurrencia acotada por un semáforo simple (`reserve`/`release`),
 *   calcado del patrón de `LiveImageBudget` (`ocr-engine/src/ocr.engine.ts`,
 *   ADR-143 §3/§6, commit `bf6aa7f`): reserva cancelable que se despierta con
 *   `ctx.abortSignal` vía polling + listener de `abort`, nunca una espera
 *   ciega sin salida. No se reusa `LiveImageBudget` en sí (paquetes de motor
 *   distintos, P-1 prohíbe importar entre ellos) ni
 *   `WorkerPool.waitForCapacity` (mide la cola INTERNA del pool, no
 *   despachos de este planificador) — es un contador entero de slots, no un
 *   presupuesto de bytes.
 *
 * Baja de documento (ADR-144 §8): `clearDocument`/`clear` rechazan
 * (`CancelledError`) y borran toda entrada pendiente o en vuelo de
 * inmediato, SIN esperar ningún despacho en curso — no hay forma de cancelar
 * a mitad de camino un `pool.dispatch` ya en curso sin una señal nueva que
 * el ADR no pide ("Consecuencias", §8). El loop de despacho, al resolver o
 * rechazar, revalida por IDENTIDAD que su entrada sigue siendo la vigente en
 * el Map antes de tocar `resolve`/`reject`: si ya no está —borrada por
 * `clearDocument`/`clear`, o reemplazada por una entrada nueva de la misma
 * clave tras un `schedule()` posterior— es un no-op: el resultado del kernel
 * en vuelo se tira sin efectos observables y sin volver a tocar una promesa
 * que ya puede estar asentada.
 */

import { CancelledError, type EngineContext } from "@anonly/shared";

// Mismo paso de polling que `LiveImageBudget` (ocr-engine) y
// `WorkerPool.waitForCapacity` (05_Worker_Architecture.md §6.3) — no es una
// medición propia, es consistencia de estilo. Constante propia porque los
// paquetes de motor no se importan entre sí (P-1): no se reusa la de
// `ocr-engine`.
const SCHEDULER_POLL_INTERVAL_MS = 10;

interface SchedulerEntry<T> {
  generation: number;
  priority: number;
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (err: unknown) => void;
}

/**
 * Promesa diferida sin `!` (prohibido en producción por
 * `@typescript-eslint/no-non-null-assertion`, `eslint.config.js`): los
 * valores iniciales son no-ops tipados que el executor de `Promise`
 * sobreescribe SINCRÓNICAMENTE antes de que `new Promise(...)` retorne, así
 * que ya son las funciones reales para cuando esta función devuelve.
 */
function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (err: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class PreviewRenderScheduler<T> {
  private readonly entries = new Map<string, SchedulerEntry<T>>();
  private activeCount = 0;

  constructor(private readonly maxConcurrency: number) {}

  /**
   * Coalesce-o-programa un trabajo de preview bajo `key` (ADR-144 §3: clave
   * construida por el caller, SOLO para `mode: "preview"`).
   *
   * - `runJob(currentPriority)`: la "cola pesada" — cache check + dispatch al
   *   kernel, SIN cachear ni emitir (eso es responsabilidad de `onSettle`).
   *   Se invoca con la prioridad vigente de la entrada (la coalescida por
   *   `Math.max`); se re-invoca en cada redespacho por generación vieja, y
   *   cada invocación debe leer su propio input fresco (ADR-144 §5) — este
   *   planificador no retiene ningún input entre invocaciones.
   * - `onSettle(result)`: corre UNA sola vez, solo si la generación no quedó
   *   vieja durante el despacho — es el único punto donde cachear/emitir.
   *   Puede ser async (`Promise<void>`); se espera antes de resolver la
   *   promesa compartida.
   */
  schedule(
    key: string,
    priority: number,
    ctx: EngineContext,
    runJob: (currentPriority: number) => Promise<T>,
    onSettle: (result: T) => Promise<void> | void,
  ): Promise<T> {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      // ADR-144 §3: una solicitud nueva sobre una clave con trabajo
      // pendiente REEMPLAZA el descriptor (bump de generación + prioridad
      // máxima) y devuelve la MISMA promesa — no dispara nada nuevo.
      existing.generation += 1;
      existing.priority = Math.max(existing.priority, priority);
      return existing.promise;
    }

    const deferred = createDeferred<T>();
    const entry: SchedulerEntry<T> = {
      generation: 0,
      priority,
      promise: deferred.promise,
      resolve: deferred.resolve,
      reject: deferred.reject,
    };
    this.entries.set(key, entry);

    // Fire-and-forget: `schedule` no espera el despacho (ADR-144 §2, "lo que
    // espera es liviano"). El loop nunca deja una excepción sin manejar: todo
    // camino de salida pasa por `entry.resolve`/`entry.reject`.
    void this.runDispatchLoop(key, entry, ctx, runJob, onSettle);

    return entry.promise;
  }

  private async runDispatchLoop(
    key: string,
    entry: SchedulerEntry<T>,
    ctx: EngineContext,
    runJob: (currentPriority: number) => Promise<T>,
    onSettle: (result: T) => Promise<void> | void,
  ): Promise<void> {
    for (;;) {
      try {
        // ADR-144 §4: el cupo se reserva ANTES de despachar, nunca se
        // comprueba-y-después-se-toma.
        await this.reserve(ctx.abortSignal, key);
      } catch (err) {
        this.settleRejected(key, entry, err);
        return;
      }

      // Capturada DESPUÉS de reservar el slot, no antes: `await` cede el
      // turno al menos un microtask aunque el slot esté libre de entrada, y
      // una ráfaga de `schedule()` síncronos sobre la misma clave (coalesce
      // real, sin ninguna espera genuina) alcanza a bumpear la generación
      // ANTES de que esta continuación retome — capturarla antes de reservar
      // haría que ese primer despacho se descartara como "viejo" sin haber
      // corrido de verdad, produciendo dos despachos reales donde el
      // objetivo del ADR (un solo dispatch para una ráfaga coalescida) exige
      // uno. Capturarla acá sigue detectando el caso que SÍ importa: una
      // generación que cambia mientras `runJob` está genuinamente en vuelo.
      const myGeneration = entry.generation;

      let result: T;
      try {
        result = await runJob(entry.priority);
      } catch (err) {
        this.release();
        this.settleRejected(key, entry, err);
        return;
      }
      this.release();

      if (this.entries.get(key) !== entry) {
        // ADR-144 §8: la entrada fue invalidada (clearDocument/clear)
        // mientras el kernel corría en vuelo, o ya fue reemplazada por una
        // entrada nueva de la misma clave — no-op deliberado: el resultado
        // se tira sin cachear/emitir y sin tocar una promesa que no es la
        // vigente (puede estar ya asentada).
        return;
      }

      if (entry.generation !== myGeneration) {
        // ADR-144 §5: alguien coalesció una solicitud nueva mientras corría
        // este despacho — el resultado quedó viejo. Se descarta sin cachear
        // ni emitir, y se redespacha desde arriba: `runJob` lee su input
        // fresco por sí solo, no hace falta pasarle nada nuevo acá.
        continue;
      }

      // ADR-144 §6: único punto donde se cachea/emite — la generación
      // coincide, este es el trabajo que efectivamente corrió para la clave.
      this.entries.delete(key);
      await onSettle(result);
      entry.resolve(result);
      return;
    }
  }

  private settleRejected(key: string, entry: SchedulerEntry<T>, err: unknown): void {
    // Mismo chequeo por identidad que el camino de éxito — ver el comentario
    // en `runDispatchLoop`. Sin esto, un `reject` tardío (p. ej. la reserva
    // de slot cancelada por `ctx.abortSignal` después de que `clearDocument`
    // ya la rechazó) tocaría una promesa ya asentada.
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    entry.reject(err);
  }

  /**
   * Baja de un documento (ADR-144 §8): toda entrada `key` con prefijo
   * `${documentId}|` se rechaza con `CancelledError` y se borra del Map DE
   * INMEDIATO, sin esperar ningún despacho en vuelo — el loop correspondiente
   * lo detecta por identidad al resolver/rechazar (ver `runDispatchLoop`/
   * `settleRejected`) y no vuelve a tocar la promesa.
   */
  clearDocument(documentId: string): void {
    const prefix = `${documentId}|`;
    for (const [key, entry] of [...this.entries]) {
      if (!key.startsWith(prefix)) continue;
      this.entries.delete(key);
      entry.reject(new CancelledError(key));
    }
  }

  /** `dispose()` (ADR-144 §8): mismo criterio que `clearDocument`, sin filtro de prefijo. */
  clear(): void {
    for (const [key, entry] of [...this.entries]) {
      this.entries.delete(key);
      entry.reject(new CancelledError(key));
    }
  }

  // ─── Semáforo de despachos en vuelo (ADR-144 §4) — mismo patrón que
  // `LiveImageBudget` (ocr-engine/src/ocr.engine.ts, ADR-143 §3/§6): reserva
  // cancelable, sin polling ciego sin salida. Acá es un contador entero de
  // slots en vez de un presupuesto de bytes. ───

  private async reserve(signal: AbortSignal, jobId: string): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new CancelledError(jobId);
      if (this.activeCount < this.maxConcurrency) {
        this.activeCount += 1;
        return;
      }
      await this.waitForChangeOrAbort(signal);
    }
  }

  private release(): void {
    this.activeCount -= 1;
  }

  private waitForChangeOrAbort(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, SCHEDULER_POLL_INTERVAL_MS);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
