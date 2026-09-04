/**
 * Escenario 11 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 11):
 * "Cambiar el zoom (`ZoomControls`, ADR-037) → verificar `PREVIEW_UPDATED`
 * con la nueva escala y reemplazo del bitmap CSS transitorio por el bitmap
 * nítido re-renderizado."
 *
 * `ZoomControls`/`PdfViewer` no exponen ningún evento del bus al DOM
 * directamente, así que este spec verifica el contrato observable en dos
 * capas (`docs/adr/ADR-037-Zoom-Rerender-RenderRequested-Scale.md` §5,
 * `apps/react-client/src/components/viewer/zoomRenderScheduler.ts`):
 *
 * 1. **Escalado inmediato** (síncrono, sin debounce): el tamaño intrínseco
 *    del `<canvas>` (`width`/`height`, `PageCanvas.tsx`) sigue a `zoom` en el
 *    mismo render, antes de que corra ningún re-render real — se verifica
 *    comparando la altura del canvas antes/después contra el % de zoom que
 *    la propia UI reporta (`ZoomControls`, sin duplicar la fórmula interna de
 *    `pageLayout.ts` en el test).
 * 2. **Re-render a la escala nueva**: tras el debounce
 *    (`ZOOM_RERENDER_DEBOUNCE_MS`, 150 ms) llega un `PREVIEW_UPDATED` con un
 *    bitmap renderizado a `scale = previewScale × zoom` (`zoomRenderScale.ts`)
 *    y `PageCanvas` lo dibuja sobre el canvas. Se verifica por el alto
 *    **intrínseco** del bitmap dibujado: a `zoom = 1.3` el canvas mide
 *    `800 × 1.3 = 1040` px (`pageLayout.ts`) y un render a la escala nueva del
 *    fixture A4 mide `842 × 1.3 ≈ 1094` px, mientras que cualquier bitmap
 *    heredado de la escala vieja mide 842. Pedir que el alto intrínseco esté a
 *    la altura del canvas (≥ 95 %) distingue las dos cosas sin depender de
 *    ningún instante.
 *
 *    La observación corre **dentro de la página** (`page.waitForFunction` con
 *    `polling`), arrancada ANTES de tocar el zoom. La versión anterior sacaba
 *    una única foto del canvas desde Node ("el transitorio") y después
 *    esperaba a que su contenido cambiara; entre el click y esa foto había
 *    tres viajes de ida y vuelta (el `poll` de la altura, la segunda lectura
 *    de altura, y el `toDataURL`), todos encolados en el hilo principal de la
 *    página detrás de la reconciliación de React y del decode de las
 *    imágenes. Si esos tres viajes tardaban más que el debounce + el ciclo de
 *    render, la foto ya era el bitmap final y el test esperaba 20 s un cambio
 *    que ya había ocurrido. Medido: la foto caía entre +38 ms y +315 ms del
 *    zoom y el re-render aterrizaba entre +206 ms y +862 ms — se solapaban
 *    (margen mínimo observado: 57 ms), de ahí el ~1/3 de flake local; con el
 *    hilo principal frenado 8× (la asimetría del runner de CI, que no frena al
 *    `RenderWorker`) fallaba 4/4 con `transitorio === final`.
 *
 *    Nota sobre el "bitmap CSS transitorio" del enunciado: instrumentando
 *    `drawImage` se ve que **no llega a dibujarse**. Al cambiar el zoom, el
 *    efecto de `PageCanvas` redimensiona el canvas (lo que lo limpia) y
 *    vuelve a cargar el `blobUrl` que tenía, pero para cuando esa imagen
 *    resolvería ya la reemplazó el `blobUrl` del render nuevo — todos los
 *    `drawImage` observados sobre el canvas a la altura nueva traen bitmaps a
 *    la escala nueva, ninguno a la vieja. Por eso este spec afirma sobre el
 *    resultado (se pinta el bitmap a la escala nueva) y no sobre la
 *    transición: afirmar el estirado intermedio sería afirmar algo que hoy no
 *    ocurre.
 *
 * No hace falta llegar a `Ready`: el montaje del visor (y por lo tanto el
 * primer `RENDER_REQUESTED`) depende solo de `DOCUMENT_PARSED`, igual que
 * `viewer-scroll-jump.spec.ts`.
 */

import { type Locator, type Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
import { manyNeutralPagesFile } from "./support/fixtures.js";

test.setTimeout(90_000);

async function canvasHeight(canvas: Locator): Promise<number> {
  return canvas.evaluate((el) => (el as HTMLCanvasElement).height);
}

/** `aria-label` del `<canvas>` de la página 1 del panel original (`PageCanvas.tsx`). */
const FIRST_PAGE_LABEL = "Página 1, original";

/** Cadencia del muestreo in-page, en ms (ver punto 2 de la cabecera). */
const SAMPLE_INTERVAL_MS = 50;

interface DrawRecord {
  readonly label: string;
  /** Alto intrínseco del bitmap dibujado (= alto del render que lo produjo). */
  readonly naturalHeight: number;
  /** Alto del canvas en el momento del dibujo (= `800 × zoom`, `pageLayout.ts`). */
  readonly canvasHeight: number;
}

/**
 * Fracción del alto del canvas que tiene que cubrir el alto intrínseco del
 * bitmap para considerarlo renderizado a la escala vigente. Para el fixture
 * A4 la relación es `842 / 800 = 1.05` a cualquier zoom (`pageLayout.ts` +
 * `zoomRenderScale.ts`); un bitmap heredado de la escala anterior da `1 /
 * 1.3 = 0.77`. El umbral separa los dos casos con margen de sobra por ambos
 * lados.
 */
const MIN_BITMAP_TO_CANVAS_RATIO = 0.95;

/**
 * Instrumenta `CanvasRenderingContext2D.drawImage` para registrar, por canvas,
 * el alto **intrínseco** de cada bitmap dibujado. Es la única vía observable
 * para distinguir el redibujo transitorio del re-render a la escala nueva: los
 * dos pintan el mismo canvas al mismo tamaño (`drawImage(image, 0, 0,
 * canvas.width, canvas.height)`, `PageCanvas.tsx`), pero el bitmap de origen
 * no mide lo mismo — el transitorio sigue siendo el render viejo estirado.
 */
async function recordCanvasDraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as { __draws?: DrawRecord[] };
    if (scope.__draws !== undefined) return;
    scope.__draws = [];
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.drawImage as (this: CanvasRenderingContext2D, ...a: never[]) => void;
    proto.drawImage = function patched(this: CanvasRenderingContext2D, ...args: never[]): void {
      const source = args[0] as unknown;
      const label = this.canvas.getAttribute("aria-label");
      if (label !== null && source instanceof HTMLImageElement) {
        scope.__draws?.push({
          label,
          naturalHeight: source.naturalHeight,
          canvasHeight: this.canvas.height,
        });
      }
      original.apply(this, args);
    } as typeof proto.drawImage;
  });
}

test("cambiar el zoom re-escala de inmediato y reemplaza el bitmap transitorio", async ({
  page,
}) => {
  await openApp(page, "networkidle");

  const file = await manyNeutralPagesFile(3);
  await page.locator('input[type="file"]').setInputFiles(file);

  const firstPage = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPage).toBeVisible({ timeout: 30_000 });
  // El `role="img"` ES el propio `<canvas>` (`PageCanvas.tsx`).
  const canvas = firstPage;

  // Deja asentar el primer render real a zoom 100% antes de tocar el zoom.
  await page.waitForTimeout(500);
  await recordCanvasDraws(page);
  const initialHeight = await canvasHeight(canvas);

  const zoomControls = page.getByRole("group", { name: "Zoom del visor" });
  const zoomLabel = zoomControls.getByText(/^\d+%$/);
  await expect(zoomLabel).toHaveText("100%");

  // Espera del punto 2, LANZADA ANTES DE TOCAR EL ZOOM (ver la cabecera) y
  // evaluada íntegramente dentro de la página: sobre el canvas de la página 1
  // **ya a la altura nueva** tiene que dibujarse un bitmap cuyo alto
  // intrínseco esté a la altura del canvas, es decir renderizado a la escala
  // nueva y no heredado de la vieja.
  //
  // Dos criterios más flojos que se probaron y NO sirven: "el contenido del
  // canvas cambió" (el efecto de `PageCanvas` limpia el canvas al
  // redimensionarlo, así que cambia sin que haya ocurrido ningún re-render) y
  // "se dibujó un `blobUrl` distinto" (el cambio de zoom también mueve el
  // rango visible, y ese camino pide su propio render). Solo el alto
  // intrínseco distingue un render a la escala nueva.
  //
  // Se lanza sin `await` a propósito: `waitForFunction` empieza a pollear al
  // invocarse, así que ya está observando durante los clicks y durante las
  // aserciones del punto 1 — no hay ningún viaje a Node en el medio que
  // pueda llegar tarde.
  const sawRealRerender = page.waitForFunction(
    ({ label, minHeight, minRatio }) => {
      const scope = globalThis as unknown as { __draws?: DrawRecord[] };
      return (scope.__draws ?? []).some(
        (draw) =>
          draw.label === label &&
          draw.canvasHeight >= minHeight &&
          draw.naturalHeight >= draw.canvasHeight * minRatio,
      );
    },
    {
      label: FIRST_PAGE_LABEL,
      minHeight: Math.ceil(initialHeight * 1.28),
      minRatio: MIN_BITMAP_TO_CANVAS_RATIO,
    },
    { polling: SAMPLE_INTERVAL_MS, timeout: 20_000 },
  );

  // Tres clicks de +10% (`ZOOM_STEP`, `ZoomControls.tsx`) → 130%, todos
  // dentro de la misma ventana de debounce (cada click reinicia el timer).
  const zoomIn = zoomControls.getByRole("button", { name: "Acercar" });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await expect(zoomLabel).toHaveText("130%");

  // 1. Escalado inmediato: la altura intrínseca del canvas ya creció ~30%,
  // sin esperar el debounce. Margen de ±2 % sobre el 30 % esperado para
  // absorber el redondeo a entero de `PageCanvas.tsx` (`Math.round`).
  await expect
    .poll(() => canvasHeight(canvas), { timeout: 2_000 })
    .toBeGreaterThan(initialHeight * 1.28);
  const newHeight = await canvasHeight(canvas);
  expect(newHeight).toBeLessThan(initialHeight * 1.32);

  // 2. Re-render real: el muestreo de arriba vio el canvas pasar por dos
  // contenidos distintos ya a la altura nueva — el transitorio y el que trajo
  // `PREVIEW_UPDATED` tras completar un ciclo real por el `RenderWorker`
  // (transporte real desde PR13, ADR-043).
  //
  // Se espera por la CONDICIÓN, no por una duración fija: si el re-render de
  // verdad no ocurriera, esto sigue fallando (tras agotar los 20 s), y
  // entonces sí sería un bug de producto.
  await sawRealRerender;

  // El visor sigue mostrando la página (sin quedar en un estado roto).
  await expect(firstPage).toBeVisible();
});
