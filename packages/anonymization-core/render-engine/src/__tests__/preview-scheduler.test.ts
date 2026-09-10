/**
 * `PreviewRenderScheduler` (ADR-144 §2-§8) — tests de la clase en aislamiento,
 * sin pasar por `RenderEngine`/pdfjs. Los tests que ejercitan el mecanismo a
 * través de la API pública de `RenderEngine` (coalescencia real vía
 * `renderPage`, prioridad 70 vs 20, `mode: "full"` bypassea el scheduler,
 * limpieza en `unloadDocument`/`dispose`) viven en `unit.test.ts`/
 * `edge.test.ts` junto al resto de los casos de `Render_Engine.md` §13/§14.
 *
 * Patrón de discriminación (deferred manuales + `vi.waitFor` con timers
 * reales, nunca `vi.useFakeTimers`): mismo estilo que
 * `packages/anonymization-core/src/__tests__/unit.test.ts` (`waitForCapacity`)
 * y `ocr-engine/src/__tests__/unit.test.ts` (`LiveImageBudget`, ADR-143 §3/§6,
 * commit `bf6aa7f`).
 */
import { CancelledError } from "@anonly/shared";
import { describe, expect, it, vi } from "vitest";

import { PreviewRenderScheduler } from "../preview-scheduler.js";

import { createEngineContext } from "./fixtures/test-helpers.js";

/** Promesa controlable manualmente — mismo patrón "deferred" usado en ocr-engine. */
function createControlled<T>(): {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PreviewRenderScheduler", () => {
  it("coalesces concurrent schedule() calls for the same key into a single runJob dispatch, and every caller resolves with the same result", async () => {
    const scheduler = new PreviewRenderScheduler<{ value: string }>(5);
    const ctx = createEngineContext();

    const runJob = vi.fn(() => Promise.resolve({ value: "R1" }));
    const onSettle = vi.fn();

    const p1 = scheduler.schedule("k1", 20, ctx, runJob, onSettle);
    const p2 = scheduler.schedule("k1", 20, ctx, runJob, onSettle);
    const p3 = scheduler.schedule("k1", 20, ctx, runJob, onSettle);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(r1).toEqual({ value: "R1" });
    // Coalescencia real: un solo dispatch para las tres solicitudes (ADR-144 §3).
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("keeps independent entries for different keys — no coalescing across keys", async () => {
    const scheduler = new PreviewRenderScheduler<string>(5);
    const ctx = createEngineContext();
    const runJob = vi.fn((priority: number) => Promise.resolve(`ran-${priority}`));

    const a = await scheduler.schedule("doc1|0|original|preview|1|png", 20, ctx, runJob, () => {});
    const b = await scheduler.schedule("doc1|1|original|preview|1|png", 20, ctx, runJob, () => {});

    expect(a).toBe("ran-20");
    expect(b).toBe("ran-20");
    expect(runJob).toHaveBeenCalledTimes(2);
  });

  it("bumps priority to the max across coalesced calls (ADR-144 §7)", async () => {
    const scheduler = new PreviewRenderScheduler<{ priority: number }>(5);
    const ctx = createEngineContext();

    const control = createControlled<void>();
    let capturedPriority: number | undefined;
    const runJob = vi.fn((priority: number) => {
      capturedPriority = priority;
      return control.promise.then(() => ({ priority }));
    });

    // Primera solicitud: prioridad "no visible" (seed/flush mediado).
    const p1 = scheduler.schedule("k1", 20, ctx, runJob, () => {});
    // Coalesce antes de que runJob resuelva: prioridad "visible" (RENDER_REQUESTED).
    const p2 = scheduler.schedule("k1", 70, ctx, runJob, () => {});

    control.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(r2);
    expect(r1.priority).toBe(70); // Math.max(20, 70).
    expect(capturedPriority).toBe(70);
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("bounds in-flight dispatches to maxConcurrency, queueing the rest until a slot frees (ADR-144 §4)", async () => {
    const maxConcurrency = 2;
    const scheduler = new PreviewRenderScheduler<number>(maxConcurrency);
    const ctx = createEngineContext();

    const controls: Array<ReturnType<typeof createControlled<number>>> = [];
    let liveCount = 0;
    let maxLiveCount = 0;
    const runJob = vi.fn(() => {
      liveCount += 1;
      maxLiveCount = Math.max(maxLiveCount, liveCount);
      const control = createControlled<number>();
      controls.push(control);
      return control.promise.finally(() => {
        liveCount -= 1;
      });
    });

    const KEY_COUNT = 6;
    const promises = Array.from({ length: KEY_COUNT }, (_, i) =>
      scheduler.schedule(`k${i}`, 20, ctx, runJob, () => {}),
    );

    // Con maxConcurrency=2, solo 2 de los 6 despachos arrancan de entrada —
    // el resto queda esperando turno, sin haber tocado runJob todavía.
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(maxConcurrency));
    expect(maxLiveCount).toBe(maxConcurrency);
    expect(liveCount).toBe(maxConcurrency);

    // Libera de a uno; cada liberación abre lugar para exactamente un
    // despacho más (nunca más de `maxConcurrency` en vuelo a la vez).
    let resolvedSoFar = 0;
    while (resolvedSoFar < KEY_COUNT) {
      const control = controls[resolvedSoFar];
      expect(control).toBeDefined();
      control?.resolve(resolvedSoFar);
      resolvedSoFar += 1;
      const expectedTotal = Math.min(resolvedSoFar + maxConcurrency, KEY_COUNT);
      await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(expectedTotal));
    }

    await Promise.all(promises);
    expect(maxLiveCount).toBeLessThanOrEqual(maxConcurrency);
    expect(runJob).toHaveBeenCalledTimes(KEY_COUNT);
  });

  it("discards a result whose generation went stale during dispatch, without settling, and redispatches", async () => {
    const scheduler = new PreviewRenderScheduler<{ n: number }>(5);
    const ctx = createEngineContext();

    let call = 0;
    const control = createControlled<void>();
    const runJob = vi.fn(() => {
      call += 1;
      if (call === 1) {
        // Primer despacho: queda colgado hasta que el test lo libera.
        return control.promise.then(() => ({ n: 1 }));
      }
      return Promise.resolve({ n: 2 });
    });
    const onSettle = vi.fn();

    const first = scheduler.schedule("k1", 20, ctx, runJob, onSettle);

    // Coalesce ANTES de que el primer runJob resuelva: bumpea la generación.
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));
    const second = scheduler.schedule("k1", 20, ctx, runJob, onSettle);
    expect(second).toBe(first); // misma promesa compartida (ADR-144 §6).

    // Libera el primer despacho: su resultado (n: 1) llegó con la generación
    // vieja — se descarta sin asentar onSettle, y redespacha.
    control.resolve();

    const result = await first;
    expect(result).toEqual({ n: 2 }); // solo el redespacho (input fresco) se asienta.
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith({ n: 2 });
  });

  it("clearDocument rejects pending/in-flight entries under a documentId prefix with CancelledError and removes them", async () => {
    const scheduler = new PreviewRenderScheduler<string>(1);
    const ctx = createEngineContext();

    const controlA = createControlled<string>();
    const controlB = createControlled<string>();
    let calls = 0;
    const runJob = vi.fn(() => {
      calls += 1;
      return calls === 1 ? controlA.promise : controlB.promise;
    });

    // maxConcurrency=1: "doc1|0|..." arranca y ocupa el único slot;
    // "doc1|1|..." queda esperando turno (pendiente, sin despachar aún).
    const inFlight = scheduler.schedule("doc1|0|original|preview|1|png", 20, ctx, runJob, () => {});
    const pending = scheduler.schedule("doc1|1|original|preview|1|png", 20, ctx, runJob, () => {});
    // Entrada de otro documento: NO debe verse afectada.
    const otherDoc = scheduler.schedule("doc2|0|original|preview|1|png", 20, ctx, runJob, () => {});

    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));
    expect(scheduler["entries"].size).toBe(3);

    scheduler.clearDocument("doc1");

    await expect(inFlight).rejects.toThrow(CancelledError);
    await expect(pending).rejects.toThrow(CancelledError);

    // Invariante verificable (ADR-144 §8, "un descriptor que sobreviva a un
    // closeDocument es una fuga"): ninguna entrada con el prefijo "doc1|"
    // sigue en el Map interno.
    const remainingKeys = [...(scheduler["entries"] as Map<string, unknown>).keys()];
    expect(remainingKeys.every((k) => !k.startsWith("doc1|"))).toBe(true);
    expect(remainingKeys).toEqual(["doc2|0|original|preview|1|png"]);

    // El kernel "en vuelo" de doc1 termina en segundo plano después de la
    // baja: no debe volver a tocar una promesa ya rechazada (no-op).
    controlA.resolve("stale");
    await new Promise((resolve) => setTimeout(resolve, 20));

    controlB.resolve("doc2-result");
    await expect(otherDoc).resolves.toBe("doc2-result");
  });

  it("clear() does the same for every document, unconditionally (dispose)", async () => {
    const scheduler = new PreviewRenderScheduler<string>(5);
    const ctx = createEngineContext();
    const control = createControlled<string>();
    const runJob = vi.fn(() => control.promise);

    const p1 = scheduler.schedule("doc1|0|original|preview|1|png", 20, ctx, runJob, () => {});
    const p2 = scheduler.schedule("doc2|0|original|preview|1|png", 20, ctx, runJob, () => {});

    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(2));

    scheduler.clear();

    await expect(p1).rejects.toThrow(CancelledError);
    await expect(p2).rejects.toThrow(CancelledError);
    expect((scheduler["entries"] as Map<string, unknown>).size).toBe(0);

    control.resolve("stale");
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("wakes a reservation blocked waiting for a free slot when the signal aborts, instead of hanging forever", async () => {
    const scheduler = new PreviewRenderScheduler<string>(1);
    const abortController = new AbortController();
    const ctx = createEngineContext({ abortSignal: abortController.signal });

    const blockingControl = createControlled<string>();
    const runJob = vi.fn(() => blockingControl.promise);

    // Ocupa el único slot para siempre.
    const blocking = scheduler.schedule("k-blocking", 20, ctx, runJob, () => {});
    await vi.waitFor(() => expect(runJob).toHaveBeenCalledTimes(1));

    // Esta segunda clave nunca consigue slot — queda esperando la reserva.
    const waiting = scheduler.schedule("k-waiting", 20, ctx, runJob, () => {});

    abortController.abort();

    await expect(waiting).rejects.toThrow(CancelledError);
    // La entrada bloqueante sigue viva (su ctx propio no abortó) — separado
    // del abort de "k-waiting".
    expect((scheduler["entries"] as Map<string, unknown>).has("k-waiting")).toBe(false);

    blockingControl.resolve("done");
    await expect(blocking).resolves.toBe("done");
  });

  it("onSettle can be async and is awaited before resolving the shared promise", async () => {
    const scheduler = new PreviewRenderScheduler<string>(5);
    const ctx = createEngineContext();
    const runJob = vi.fn(() => Promise.resolve("value"));

    let settleFinished = false;
    const onSettle = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      settleFinished = true;
    });

    const result = await scheduler.schedule("k1", 20, ctx, runJob, onSettle);
    expect(result).toBe("value");
    expect(settleFinished).toBe(true);
  });

  it("propagates a runJob rejection (e.g. a checkpoint CancelledError) to the shared promise without special handling", async () => {
    const scheduler = new PreviewRenderScheduler<string>(5);
    const ctx = createEngineContext();
    const boom = new CancelledError("doc1");
    const runJob = vi.fn(() => Promise.reject(boom));
    const onSettle = vi.fn();

    await expect(scheduler.schedule("k1", 20, ctx, runJob, onSettle)).rejects.toBe(boom);
    expect(onSettle).not.toHaveBeenCalled();
    expect((scheduler["entries"] as Map<string, unknown>).has("k1")).toBe(false);
  });
});
