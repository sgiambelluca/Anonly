/**
 * `displaySampler.ts` — qué está MOSTRANDO cada canvas de página, no solo qué se dibujó
 * (ADR-213, enmienda: al pasar a Anonimizado nunca se muestra la imagen original).
 *
 * El registro de dibujos de `pagePixels.ts` anota cada `drawImage`. Pero cuando el visor
 * sostiene una imagen al conmutar, el canvas conserva sus píxeles sin dibujar nada nuevo:
 * el canvas pasa a llamarse «Página N, anonimizado» mostrando todavía la imagen original, y
 * ningún `drawImage` lo delata. Este muestreador cubre ese hueco:
 *
 * - un init script anota, por canvas, el `blob:` de su ÚLTIMA imagen dibujada (y lo borra si
 *   el canvas se rellena o se limpia: el estado de carga);
 * - un bucle de `requestAnimationFrame` registra cada cambio de (rótulo, imagen mostrada).
 *
 * Un registro con el rótulo «anonimizado» y un `src` que `renderTap.previewBlobsOf` dice que
 * es una imagen del lado original es, literalmente, la original bajo la pestaña Anonimizado.
 * Va ANTES de `openApp`.
 */

import type { Page } from "@playwright/test";

export interface DisplayRecord {
  /** `aria-label` del canvas en ese momento (`Página N, original|anonimizado`). */
  readonly label: string;
  /** El `blob:` de la imagen que el canvas muestra, o `""` si está vacío o en estado de carga. */
  readonly src: string;
  /** `performance.now()` del cuadro en que se vio el cambio. */
  readonly at: number;
}

const LOG_NAME = "__anonlyDisplayLog";

export async function installDisplaySampler(page: Page): Promise<void> {
  await page.addInitScript((logName: string) => {
    const lastSource = new WeakMap<HTMLCanvasElement, string>();
    const proto = CanvasRenderingContext2D.prototype;

    function isPageCanvas(canvas: HTMLCanvasElement): boolean {
      return (canvas.getAttribute("aria-label") ?? "").startsWith("Página ");
    }

    const drawImage = proto.drawImage as (this: CanvasRenderingContext2D, ...a: unknown[]) => void;
    proto.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]): void {
      const image = args[0];
      if (image instanceof HTMLImageElement && isPageCanvas(this.canvas)) {
        lastSource.set(this.canvas, image.currentSrc || image.src);
      }
      drawImage.apply(this, args);
    } as typeof proto.drawImage;

    for (const name of ["fillRect", "clearRect"] as const) {
      const wrapped = proto[name] as (this: CanvasRenderingContext2D, ...a: number[]) => void;
      proto[name] = function (this: CanvasRenderingContext2D, ...args: number[]): void {
        if (isPageCanvas(this.canvas)) lastSource.set(this.canvas, "");
        wrapped.apply(this, args);
      } as typeof proto.fillRect;
    }

    const log: DisplayRecord[] = [];
    Object.defineProperty(window, logName, { value: log });
    const lastKey = new Map<HTMLCanvasElement, string>();

    function tick(): void {
      for (const canvas of document.querySelectorAll<HTMLCanvasElement>("canvas")) {
        if (!isPageCanvas(canvas)) continue;
        const label = canvas.getAttribute("aria-label") ?? "";
        const src = lastSource.get(canvas) ?? "";
        const key = `${label}|${src}`;
        if (lastKey.get(canvas) === key) continue;
        lastKey.set(canvas, key);
        log.push({ label, src, at: performance.now() });
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, LOG_NAME);
}

/** Cuántos cambios hay registrados; sirve de marca para `displayedSince`. */
export async function displayLogLength(page: Page): Promise<number> {
  return page.evaluate(
    (name) => (window as unknown as Record<string, DisplayRecord[]>)[name]?.length ?? 0,
    LOG_NAME,
  );
}

/** Los cambios de lo mostrado posteriores a la marca `from`, de las páginas con ese rótulo. */
export async function displayedSince(
  page: Page,
  from: number,
  label: string,
): Promise<ReadonlyArray<DisplayRecord>> {
  return page.evaluate(
    (args) =>
      ((window as unknown as Record<string, DisplayRecord[]>)[args.name] ?? [])
        .slice(args.from)
        .filter((record) => record.label === args.label),
    { name: LOG_NAME, from, label },
  );
}
