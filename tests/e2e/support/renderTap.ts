/**
 * `renderTap.ts` — observa y, si hace falta, enlentece el render del visor desde el
 * test, sin tocar el producto (ADR-213).
 *
 * - **`startRenderTap`** se suscribe, vía `window.__anonlyCore.bus` (el build `VITE_E2E`
 *   lo expone, `core-adapter/index.ts`), a `RENDER_REQUESTED` (canal `ui`) y a
 *   `PREVIEW_UPDATED` (canal `render`) y guarda cada uno con su instante. Sirve para
 *   contar qué lado pidió el visor y cuándo llegó cada imagen, también la del lado que
 *   no se ve (que no deja ningún dibujo).
 * - **`installWorkerMessageDelay`** envuelve los listeners de `message` de los `Worker`
 *   para entregarlos `window.__anonlyWorkerDelayMs` milisegundos tarde. Con el valor en
 *   0 (el de arranque) no cambia nada. Sirve para que una imagen que el visor espera
 *   llegue más tarde que el tope de la espera (ADR-213 §4) sin tocar el motor ni el
 *   cliente: es lo mismo que un render lento. Va ANTES de `openApp`.
 */

import type { Page } from "@playwright/test";

export interface RenderRequestRecord {
  readonly kind: "original" | "anonymized";
  readonly mode: "preview" | "full";
  readonly scale: number | null;
  readonly pageIndices: ReadonlyArray<number>;
  /** `performance.now()` de la página al emitirse. */
  readonly at: number;
}

export interface PreviewArrivalRecord {
  readonly kind: "original" | "anonymized";
  readonly pageIndex: number;
  /** El `blob:` de la imagen que trajo el evento: identifica de qué lado salió lo que se dibuja. */
  readonly blobUrl: string;
  readonly at: number;
}

const REQUESTS_NAME = "__anonlyRenderRequests";
const ARRIVALS_NAME = "__anonlyPreviewArrivals";
const DELAY_NAME = "__anonlyWorkerDelayMs";

/** Registra el retardo de los mensajes de worker. Va ANTES de `openApp`. */
export async function installWorkerMessageDelay(page: Page): Promise<void> {
  await page.addInitScript((delayName: string) => {
    const scope = window as unknown as Record<string, number>;
    scope[delayName] = 0;
    const proto = Worker.prototype;
    const original = proto.addEventListener as (
      this: Worker,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => void;
    proto.addEventListener = function (
      this: Worker,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (type !== "message") {
        original.call(this, type, listener, options);
        return;
      }
      const wrapped = (event: Event): void => {
        const delay = scope[delayName] ?? 0;
        const call = (): void => {
          if (typeof listener === "function") listener.call(this, event);
          else listener.handleEvent(event);
        };
        if (delay > 0) window.setTimeout(call, delay);
        else call();
      };
      original.call(this, type, wrapped, options);
    } as typeof proto.addEventListener;
  }, DELAY_NAME);
}

/** Cuánto se atrasan, desde ahora, los mensajes de los workers (0 = sin atraso). */
export async function setWorkerMessageDelay(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate(
    (args) => {
      (window as unknown as Record<string, number>)[args.name] = args.milliseconds;
    },
    { name: DELAY_NAME, milliseconds },
  );
}

/** Se suscribe al bus del Core. Va DESPUÉS de `openApp` (el Core ya existe). */
export async function startRenderTap(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __anonlyCore?: unknown }).__anonlyCore !== undefined,
  );
  await page.evaluate(
    (names) => {
      type Bus = {
        on(channel: string, event: string, callback: (payload: unknown) => void): void;
      };
      const scope = window as unknown as Record<string, unknown> & {
        __anonlyCore?: { bus: Bus };
      };
      if (scope[names.requests] !== undefined) return;
      const requests: unknown[] = [];
      const arrivals: unknown[] = [];
      scope[names.requests] = requests;
      scope[names.arrivals] = arrivals;
      scope.__anonlyCore?.bus.on("ui", "RENDER_REQUESTED", (payload) => {
        const p = payload as {
          kind: string;
          mode: string;
          scale?: number;
          pageIndices: number[];
        };
        requests.push({
          kind: p.kind,
          mode: p.mode,
          scale: p.scale ?? null,
          pageIndices: [...p.pageIndices],
          at: performance.now(),
        });
      });
      scope.__anonlyCore?.bus.on("render", "PREVIEW_UPDATED", (payload) => {
        const p = payload as { kind: string; pageIndex: number; canvasBlobUrl: string };
        arrivals.push({
          kind: p.kind,
          pageIndex: p.pageIndex,
          blobUrl: p.canvasBlobUrl,
          at: performance.now(),
        });
      });
    },
    { requests: REQUESTS_NAME, arrivals: ARRIVALS_NAME },
  );
}

export async function renderRequestCount(page: Page): Promise<number> {
  return page.evaluate(
    (name) => (window as unknown as Record<string, unknown[]>)[name]?.length ?? 0,
    REQUESTS_NAME,
  );
}

/** Los `RENDER_REQUESTED` posteriores a la marca `from` (de `renderRequestCount`). */
export async function renderRequestsSince(
  page: Page,
  from: number,
): Promise<ReadonlyArray<RenderRequestRecord>> {
  return page.evaluate(
    (args) =>
      ((window as unknown as Record<string, unknown[]>)[args.name] ?? []).slice(
        args.from,
      ) as RenderRequestRecord[],
    { name: REQUESTS_NAME, from },
  );
}

/** Los `PREVIEW_UPDATED` (de cualquier lado) posteriores al instante `since`. */
export async function previewArrivalsSince(
  page: Page,
  since: number,
): Promise<ReadonlyArray<PreviewArrivalRecord>> {
  return page.evaluate(
    (args) =>
      ((window as unknown as Record<string, PreviewArrivalRecord[]>)[args.name] ?? []).filter(
        (arrival) => arrival.at >= args.since,
      ),
    { name: ARRIVALS_NAME, since },
  );
}

/**
 * Los `blob:` de TODAS las imágenes que el motor entregó para ese `kind`. Un dibujo cuyo
 * `src` está acá es una imagen de ese lado, sea cual sea el rótulo del canvas donde cayó
 * (una original y una anonimizada a la misma escala miden lo mismo).
 */
export async function previewBlobsOf(
  page: Page,
  kind: "original" | "anonymized",
): Promise<ReadonlySet<string>> {
  const arrivals = await previewArrivalsSince(page, 0);
  return new Set(arrivals.filter((arrival) => arrival.kind === kind).map((a) => a.blobUrl));
}

/** `performance.now()` de la página: la misma base de tiempo que los registros. */
export async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}
