/**
 * Escenario 12 (`docs/architecture/07_Performance_Strategy.md` §11.3, item
 * 12, ADR-056 §1/§8): "Con la sincronización de scroll apagada (el default),
 * scrollear el panel `original` → verificar que no llega ningún
 * `PREVIEW_UPDATED` con `kind: "anonymized"`." Es la prueba directa de que un
 * panel no dispara el render del otro (Contexto §1 de
 * `adr/ADR-056-RenderRequested-Kind-Por-Panel.md`: antes de este ADR,
 * scrollear rápido "original" hacía parpadear "anonimizado", que el usuario
 * no había tocado).
 *
 * Complementa al escenario de `adr/ADR-054-Scroll-Independiente-Por-Panel.md`
 * §8 (`viewer-scroll-jump.spec.ts`): ese cubre que el `scrollTop` de un panel
 * no mueve al otro; este cubre el pipeline de RENDER que dispara ese
 * scroll — que el panel no tocado tampoco vuelve a pedir/recibir píxeles.
 *
 * `PdfViewer`/`PageCanvas` no exponen ningún evento del bus al DOM
 * directamente (mismo problema que el Escenario 11, `scenario-11-zoom.spec.ts`),
 * así que este spec observa el efecto contractual de `PREVIEW_UPDATED` sobre
 * la página en vez del evento del bus: `PageCanvas` (`apps/react-client/src/
 * components/viewer/PageCanvas.tsx`) solo llama `drawImage` sobre su
 * `<canvas>` cuando el `blobUrl` de SU `kind` cambia, y ese `blobUrl` en
 * `viewer.previewByPage[kind]` solo cambia por un `PREVIEW_UPDATED` de ese
 * mismo `kind` (`core-adapter/bus-bridge.ts`). Instrumentando
 * `CanvasRenderingContext2D.prototype.drawImage` (mismo patrón que
 * `scenario-11-zoom.spec.ts#recordCanvasDraws`) y distinguiendo por
 * `aria-label` ("Página N, original" / "Página N, anonimizado",
 * `PageCanvas.tsx`) se puede afirmar la ausencia de cualquier
 * `PREVIEW_UPDATED` de `anonymized` durante la ventana de observación, sin
 * acceso directo al bus.
 */

import { expect, test, type Page } from "@playwright/test";

import { manyNeutralPagesFile } from "./support/fixtures.js";

const PAGE_COUNT = 30;

// Período de quietud (sin ningún draw nuevo) que hay que observar antes de
// dar por terminado el asentamiento inicial y limpiar el registro — ver
// `waitForDrawQuiescence` más abajo.
const SETTLE_QUIET_MS = 500;

test.setTimeout(90_000);

/**
 * Instrumenta `drawImage` para registrar, por `aria-label`, cada bitmap
 * dibujado sobre un canvas de página (y el timestamp del último draw, para
 * `waitForDrawQuiescence`). Se instala ANTES de subir el archivo
 * (inmediatamente tras `page.goto`) para no perderse los draws del render
 * inicial, que este spec necesita observar para confirmar que el
 * asentamiento terminó antes de empezar a scrollear.
 */
async function recordCanvasDraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = globalThis as unknown as { __draws?: string[]; __lastDrawAt?: number };
    if (scope.__draws !== undefined) return;
    scope.__draws = [];
    scope.__lastDrawAt = Date.now();
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.drawImage as (this: CanvasRenderingContext2D, ...a: never[]) => void;
    proto.drawImage = function patched(this: CanvasRenderingContext2D, ...args: never[]): void {
      const label = this.canvas.getAttribute("aria-label");
      if (label !== null) {
        scope.__draws?.push(label);
        scope.__lastDrawAt = Date.now();
      }
      original.apply(this, args);
    } as typeof proto.drawImage;
  });
}

async function drawnLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as unknown as { __draws?: string[] }).__draws ?? []);
}

async function clearDraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as unknown as { __draws?: string[] }).__draws = [];
  });
}

/**
 * Espera a que no haya llegado ningún draw nuevo en los últimos `quietMs` ms.
 * El rango montado (visible ± 1, `computeMountRange`) dispara renders para
 * varias páginas por panel al cargar el documento, no solo la página 1:
 * esperar únicamente "página 1 dibujada en los dos paneles" deja abierta la
 * ventana en la que el render legítimo, todavía en vuelo, de las páginas
 * 2/3 de "anonimizado" aterriza DESPUÉS de `clearDraws` y se cuenta como una
 * violación falsa del escenario — mismo tipo de carrera que motivó los
 * ajustes de timeout del escenario 3 y el fix de carrera del escenario 11.
 */
async function waitForDrawQuiescence(
  page: Page,
  quietMs: number,
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    (quiet) => {
      const lastDrawAt = (globalThis as unknown as { __lastDrawAt?: number }).__lastDrawAt ?? 0;
      return Date.now() - lastDrawAt >= quiet;
    },
    quietMs,
    { polling: 100, timeout: timeoutMs },
  );
}

test("scrollear el panel original con la sincronización apagada no dispara ningún render de anonymized", async ({
  page,
}) => {
  // Ventana ancha (≥ lg = 1024px, Tailwind): los dos paneles visibles a la
  // vez (Contexto §1 del ADR), mismo criterio que
  // `viewer-scroll-jump.spec.ts` (describe "viewport ancho ... ADR-054 §8").
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/", { waitUntil: "networkidle" });
  await recordCanvasDraws(page);

  const file = await manyNeutralPagesFile(PAGE_COUNT);
  await page.locator('input[type="file"]').setInputFiles(file);

  const firstPageOriginal = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPageOriginal).toBeVisible({ timeout: 30_000 });

  const originalContainer = page.locator('[aria-label="PDF original"] > div').first();
  const anonymizedContainer = page.locator('[aria-label="PDF anonimizado"] > div').first();
  await originalContainer.waitFor({ state: "visible" });
  await anonymizedContainer.waitFor({ state: "visible" });

  // Sincronización apagada por default (ADR-054 §2) — no se toca el toggle.

  // Espera a que el render inicial de LOS DOS paneles arranque: al montar,
  // cada `PdfViewer` pide su propio preview de entrada (ADR-056 §2, tres
  // emisores por panel) — es trabajo legítimo, no el bug de este escenario.
  // Página 1 en los dos paneles es solo la señal de arranque, no de
  // asentamiento completo (ver `waitForDrawQuiescence` debajo).
  await page.waitForFunction(
    () => {
      const draws = (globalThis as unknown as { __draws?: string[] }).__draws ?? [];
      return (
        draws.some((label) => label === "Página 1, original") &&
        draws.some((label) => label === "Página 1, anonimizado")
      );
    },
    { polling: 100, timeout: 30_000 },
  );

  // El rango montado es visible ± 1: además de la página 1, cada panel sigue
  // recibiendo renders de las páginas 2/3 un instante más. Esperar quietud
  // real (no solo "llegó la página 1") antes de limpiar el registro evita
  // que esos renders legítimos, tardíos, aterricen después de `clearDraws` y
  // se cuenten como el bug.
  await waitForDrawQuiescence(page, SETTLE_QUIET_MS, 15_000);

  const box = await originalContainer.boundingBox();
  if (!box) throw new Error('No se pudo ubicar el contenedor de "original".');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Limpia el registro justo antes de scrollear: de acá en más, cualquier
  // draw de "anonimizado" sería la prueba directa del bug (un panel no
  // tocado recargándose).
  await clearDraws(page);

  // Scroll rápido y sostenido del panel "original" (mismo patrón que
  // `viewer-scroll-jump.spec.ts`): cruza varios bordes de página, cada
  // cambio de rango montado dispara su propio RENDER_REQUESTED con
  // `kind: "original"` (ADR-056 §1/§2) — nunca el del otro panel.
  const WHEEL_TICKS = 20;
  const WHEEL_DELTA_Y = 350; // 20 * 350 = 7000px: cruza varios bordes de página (800px c/u).
  for (let tick = 0; tick < WHEEL_TICKS; tick += 1) {
    await page.mouse.wheel(0, WHEEL_DELTA_Y);
    await page.waitForTimeout(30);
  }

  // Ventana de observación tras el scroll: suficiente para que cualquier
  // render real (correcto, o indebido si el bug reapareciera) complete un
  // ciclo por el RenderWorker antes de leer el resultado.
  await page.waitForTimeout(2_000);

  const labels = await drawnLabels(page);
  const originalDraws = labels.filter((label) => label.includes("original"));
  const anonymizedDraws = labels.filter((label) => label.includes("anonimizado"));

  // Evidencia positiva primero: el scroll de "original" sí tiene que haber
  // ejercitado el pipeline de render real de ese panel. Si esto diera 0, el
  // test de abajo sería vacuamente verde y no probaría nada.
  expect(
    originalDraws.length,
    'el scroll de "original" debería haber disparado al menos un render real de ese panel',
  ).toBeGreaterThan(0);

  // La prueba directa del escenario (ADR-056 §1/§8): el panel "anonimizado",
  // que el usuario no tocó, no recibió ningún PREVIEW_UPDATED — cero draws
  // de bitmaps nuevos en sus canvases mientras "original" scrolleaba.
  expect(
    anonymizedDraws,
    `"anonimizado" no debería haber recibido ningún render tras scrollear "original" (draws: ${anonymizedDraws.join(", ")})`,
  ).toHaveLength(0);
});
