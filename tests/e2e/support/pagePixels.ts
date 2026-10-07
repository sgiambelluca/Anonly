/**
 * `pagePixels.ts` — lee los píxeles EXACTOS que el render entregó al visor, para
 * comparar la vista Original con la Anonimizada a la misma escala (ADR-210).
 *
 * **Por qué no se lee el `<canvas>` del DOM.** El `PageCanvas` del visor dibuja la
 * imagen del preview (un PNG de `595 × zoom` píxeles de ancho para una página
 * A4 de 595 pt) sobre un canvas de `computePageWidth(800 × zoom)` píxeles: el
 * `drawImage` re-escala, y un píxel del canvas ya no es un píxel del render.
 * Con la imagen re-muestreada no se puede afirmar «idénticos píxel a píxel».
 *
 * Lo que se hace en su lugar: un init script envuelve
 * `CanvasRenderingContext2D.prototype.drawImage` y, cuando el destino es el
 * canvas de una página del visor (`aria-label` «Página N, original|anonimizado»)
 * y la fuente es la imagen decodificada del preview, guarda una copia de sus
 * píxeles en su tamaño natural (`getImageData` sobre un canvas aparte del mismo
 * tamaño: sin re-escala). Es lo mismo que el visor muestra, byte por byte. El
 * preview es PNG (sin pérdida), así que la copia coincide con lo que el kernel
 * pintó. El init script no cambia lo que se dibuja: llama al `drawImage` real.
 *
 * Las copias se indexan por `«aria-label»@«ancho natural»`: dos escalas de la
 * misma vista (100 % y 130 %) conviven sin pisarse, y las dos vistas a la misma
 * escala tienen exactamente el mismo tamaño en píxeles.
 *
 * La comparación corre dentro del browser (`page.evaluate`) para no pasar
 * millones de bytes por el puente de Playwright.
 */

import type { Page } from "@playwright/test";

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShotInfo {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

export interface ShiftSearchResult {
  /** Desplazamientos (en píxeles) con CERO diferencias en los cuatro canales. */
  readonly exactShifts: ReadonlyArray<number>;
  /** El mejor candidato inexacto, para dejarlo en el mensaje si no hay exacto. */
  readonly bestInexact: { readonly shift: number; readonly mismatches: number } | null;
  readonly regionPixels: number;
}

export interface RegionMismatch {
  readonly mismatches: number;
  readonly regionPixels: number;
  /** Primeras diferencias (hasta 5), para el diagnóstico. */
  readonly samples: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly original: readonly [number, number, number, number];
    readonly anonymized: readonly [number, number, number, number];
  }>;
}

interface StoredShot {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

type ShotStore = Map<string, StoredShot>;

const STORE_NAME = "__anonlyPageShots";
const LOG_NAME = "__anonlyPageDraws";

/** Registra la captura. Va ANTES de `openApp`, que recarga con el init script puesto. */
export async function installPageImageCapture(page: Page): Promise<void> {
  await page.addInitScript(
    ({ storeName, logName }: { storeName: string; logName: string }) => {
      const store: ShotStore = new Map();
      Object.defineProperty(window, storeName, { value: store });
      const drawLog: DrawRecord[] = [];
      Object.defineProperty(window, logName, { value: drawLog });
      type DrawImage = (
        this: CanvasRenderingContext2D,
        image: CanvasImageSource,
        ...r: number[]
      ) => void;
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.drawImage as DrawImage;

      function capture(context: CanvasRenderingContext2D, image: CanvasImageSource): void {
        if (!(image instanceof HTMLImageElement)) return;
        const label = context.canvas.getAttribute("aria-label");
        if (label === null || !label.startsWith("Página ")) return;
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (width === 0 || height === 0) return;
        drawLog.push({ label, width, canvasWidth: context.canvas.width });
        const copy = document.createElement("canvas");
        copy.width = width;
        copy.height = height;
        const copyContext = copy.getContext("2d", { willReadFrequently: true });
        if (copyContext === null) return;
        original.call(copyContext, image, 0, 0);
        const { data } = copyContext.getImageData(0, 0, width, height);
        store.set(`${label}@${width}`, { width, height, data });
      }

      proto.drawImage = function (
        this: CanvasRenderingContext2D,
        image: CanvasImageSource,
        ...rest: number[]
      ): void {
        capture(this, image);
        original.call(this, image, ...rest);
      };
    },
    { storeName: STORE_NAME, logName: LOG_NAME },
  );
}

/** Cada vez que el visor dibuja una imagen de página, en orden (para saber qué se MUESTRA ahora). */
export interface DrawRecord {
  readonly label: string;
  /** Ancho natural de la imagen dibujada: `595 × escala` con la que se renderizó. */
  readonly width: number;
  /** Ancho del canvas del visor en ese momento (`pageLayout.ts`: depende del zoom). */
  readonly canvasWidth: number;
}

/** Cuántos dibujos hay registrados; sirve de marca para `drawsSince`. */
export async function drawLogLength(page: Page): Promise<number> {
  return page.evaluate(
    (logName: string) => (window as unknown as Record<string, DrawRecord[]>)[logName]?.length ?? 0,
    LOG_NAME,
  );
}

/** Los dibujos posteriores a la marca `from` (de `drawLogLength`), de la página con ese rótulo. */
export async function drawsSince(
  page: Page,
  from: number,
  labelPrefix: string,
): Promise<ReadonlyArray<DrawRecord>> {
  return page.evaluate(
    (args) =>
      ((window as unknown as Record<string, DrawRecord[]>)[args.logName] ?? [])
        .slice(args.from)
        .filter((draw) => draw.label.startsWith(args.labelPrefix)),
    { logName: LOG_NAME, from, labelPrefix },
  );
}

/** El ancho natural de la última imagen dibujada con ese rótulo (lo que el visor muestra), o `null`. */
export async function lastDrawnWidth(page: Page, labelPrefix: string): Promise<number | null> {
  return page.evaluate(
    (args) => {
      const log = (window as unknown as Record<string, DrawRecord[]>)[args.logName] ?? [];
      for (let index = log.length - 1; index >= 0; index -= 1) {
        const draw = log[index];
        if (draw !== undefined && draw.label.startsWith(args.labelPrefix)) return draw.width;
      }
      return null;
    },
    { logName: LOG_NAME, labelPrefix },
  );
}

/** Las copias disponibles, para esperar con `expect.poll` a que llegue la escala pedida. */
export async function listPageShots(page: Page): Promise<ReadonlyArray<ShotInfo>> {
  return page.evaluate((storeName: string) => {
    const store = (window as unknown as Record<string, ShotStore>)[storeName];
    if (store === undefined) return [];
    return [...store.entries()].map(([key, shot]) => ({
      key,
      width: shot.width,
      height: shot.height,
    }));
  }, STORE_NAME);
}

/**
 * Busca el corrimiento horizontal entero `d` (0..`maxShift`) tal que la región
 * `rect` de la copia ORIGINAL es idéntica, en los cuatro canales, a `rect`
 * corrida `d` píxeles a la derecha en la copia ANONIMIZADA. No hay tolerancia:
 * un candidato con una sola diferencia no cuenta.
 */
export async function findExactShift(
  page: Page,
  originalKey: string,
  anonymizedKey: string,
  rect: PixelRect,
  maxShift: number,
): Promise<ShiftSearchResult> {
  return page.evaluate(
    (args) => {
      const store = (window as unknown as Record<string, ShotStore>)[args.storeName];
      const original = store?.get(args.originalKey);
      const anonymized = store?.get(args.anonymizedKey);
      if (original === undefined || anonymized === undefined)
        throw new Error("copia de página ausente");
      const { rect, maxShift } = args;
      const exact: number[] = [];
      let best: { shift: number; mismatches: number } | null = null;
      for (let shift = 0; shift <= maxShift; shift += 1) {
        if (rect.x + rect.width + shift > anonymized.width) break;
        let mismatches = 0;
        for (let row = rect.y; row < rect.y + rect.height; row += 1) {
          for (let column = rect.x; column < rect.x + rect.width; column += 1) {
            const from = (row * original.width + column) * 4;
            const to = (row * anonymized.width + column + shift) * 4;
            if (
              original.data[from] !== anonymized.data[to] ||
              original.data[from + 1] !== anonymized.data[to + 1] ||
              original.data[from + 2] !== anonymized.data[to + 2] ||
              original.data[from + 3] !== anonymized.data[to + 3]
            )
              mismatches += 1;
          }
        }
        if (mismatches === 0) exact.push(shift);
        else if (best === null || mismatches < best.mismatches) best = { shift, mismatches };
      }
      return {
        exactShifts: exact,
        bestInexact: best,
        regionPixels: rect.width * rect.height,
      };
    },
    { storeName: STORE_NAME, originalKey, anonymizedKey, rect, maxShift },
  );
}

/** Diferencias entre `rect` de la original y `rect` corrida `shift` en la anonimizada. */
export async function compareShiftedRegion(
  page: Page,
  originalKey: string,
  anonymizedKey: string,
  rect: PixelRect,
  shift: number,
): Promise<RegionMismatch> {
  return page.evaluate(
    (args) => {
      const store = (window as unknown as Record<string, ShotStore>)[args.storeName];
      const original = store?.get(args.originalKey);
      const anonymized = store?.get(args.anonymizedKey);
      if (original === undefined || anonymized === undefined)
        throw new Error("copia de página ausente");
      const { rect, shift } = args;
      let mismatches = 0;
      const samples: Array<{
        x: number;
        y: number;
        original: [number, number, number, number];
        anonymized: [number, number, number, number];
      }> = [];
      for (let row = rect.y; row < rect.y + rect.height; row += 1) {
        for (let column = rect.x; column < rect.x + rect.width; column += 1) {
          const from = (row * original.width + column) * 4;
          const to = (row * anonymized.width + column + shift) * 4;
          const a: [number, number, number, number] = [
            original.data[from] ?? 0,
            original.data[from + 1] ?? 0,
            original.data[from + 2] ?? 0,
            original.data[from + 3] ?? 0,
          ];
          const b: [number, number, number, number] = [
            anonymized.data[to] ?? 0,
            anonymized.data[to + 1] ?? 0,
            anonymized.data[to + 2] ?? 0,
            anonymized.data[to + 3] ?? 0,
          ];
          if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) {
            mismatches += 1;
            if (samples.length < 5) samples.push({ x: column, y: row, original: a, anonymized: b });
          }
        }
      }
      return { mismatches, regionPixels: rect.width * rect.height, samples };
    },
    { storeName: STORE_NAME, originalKey, anonymizedKey, rect, shift },
  );
}

/**
 * Cuántos píxeles de `rect` (en la copia ANONIMIZADA) son distintos del fondo
 * `[255,255,255]`: la tinta que hay ahí. Sirve para comprobar que la etiqueta se
 * dibujó donde estaba el dato.
 */
export async function countInkPixels(
  page: Page,
  key: string,
  rect: PixelRect,
  threshold = 200,
): Promise<number> {
  return page.evaluate(
    (args) => {
      const store = (window as unknown as Record<string, ShotStore>)[args.storeName];
      const shot = store?.get(args.key);
      if (shot === undefined) throw new Error("copia de página ausente");
      let ink = 0;
      for (let row = args.rect.y; row < args.rect.y + args.rect.height; row += 1) {
        for (let column = args.rect.x; column < args.rect.x + args.rect.width; column += 1) {
          const at = (row * shot.width + column) * 4;
          const luma =
            ((shot.data[at] ?? 255) + (shot.data[at + 1] ?? 255) + (shot.data[at + 2] ?? 255)) / 3;
          if (luma < args.threshold) ink += 1;
        }
      }
      return ink;
    },
    { storeName: STORE_NAME, key, rect, threshold },
  );
}

/** Guarda una copia como PNG (data URL base64), para el diagnóstico y las capturas. */
export async function pageShotToPngBase64(page: Page, key: string): Promise<string> {
  return page.evaluate(
    async (args) => {
      const store = (window as unknown as Record<string, ShotStore>)[args.storeName];
      const shot = store?.get(args.key);
      if (shot === undefined) throw new Error("copia de página ausente");
      const canvas = document.createElement("canvas");
      canvas.width = shot.width;
      canvas.height = shot.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("sin contexto 2D");
      context.putImageData(
        new ImageData(new Uint8ClampedArray(shot.data), shot.width, shot.height),
        0,
        0,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("toBlob"))),
          "image/png",
        );
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { storeName: STORE_NAME, key },
  );
}
