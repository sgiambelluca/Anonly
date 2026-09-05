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
 * **Reescrito por ADR-087 §2: ya no hay dos paneles.** El escenario nació
 * cuando el visor mostraba `original` y `anonymized` lado a lado, y afirmaba
 * que scrollear uno no hacía parpadear al otro. Con el visor único hay un solo
 * kind montado por vez, así que la garantía cambia de forma: lo que se afirma
 * ahora es que **mientras se mira `original`, no se pinta un solo bitmap de
 * `anonymized`** — ni por un pedido de más, ni por una suscripción que quedó
 * viva del otro modo.
 *
 * Es una garantía **más débil** que la original, y conviene decirlo: antes el
 * otro panel estaba montado y podía verse parpadear; ahora no está montado, así
 * que buena parte de la afirmación la sostiene el propio diseño. Se conserva
 * igual por dos razones: sigue siendo el único test que mira el pipeline de
 * render real disparado por scroll (no el `scrollTop`), y la mitad de
 * evidencia positiva —que scrollear SÍ produce renders de `original`— es la
 * que evita que quede vacuamente verde el día que algo deje de renderizar.
 *
 * El `scrollTop` en sí lo cubre `viewer-scroll-jump.spec.ts`, también
 * reescrito para el visor único.
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

import { type Page } from "@playwright/test";

import { expect, openApp, test } from "./support/electronApp.js";
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
 * (inmediatamente tras `openApp`) para no perderse los draws del render
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

test("scrollear el visor en modo original no dispara ningún render de anonymized", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, "networkidle");
  await recordCanvasDraws(page);

  const file = await manyNeutralPagesFile(PAGE_COUNT);
  await page.locator('input[type="file"]').setInputFiles(file);

  const firstPageOriginal = page.getByRole("img", { name: "Página 1, original" });
  await expect(firstPageOriginal).toBeVisible({ timeout: 30_000 });

  const originalContainer = page.locator('[aria-label="Documento original"] > div').first();
  await originalContainer.waitFor({ state: "visible" });

  // El visor arranca en `original` (`viewer.store.ts`) — no se toca el toggle.

  // Espera a que el render inicial arranque: al montar, `PdfViewer` pide su
  // preview de entrada (ADR-056 §2) — es trabajo legítimo, no el bug de este
  // escenario. La página 1 es solo la señal de arranque, no de asentamiento
  // completo (ver `waitForDrawQuiescence` debajo).
  await page.waitForFunction(
    () => {
      const draws = (globalThis as unknown as { __draws?: string[] }).__draws ?? [];
      return draws.some((label) => label === "Página 1, original");
    },
    { polling: 100, timeout: 30_000 },
  );

  // El rango montado es visible ± 1: además de la página 1, el visor sigue
  // recibiendo renders de las páginas 2/3 un instante más. Esperar quietud
  // real (no solo "llegó la página 1") antes de limpiar el registro evita
  // que esos renders legítimos, tardíos, aterricen después de `clearDraws` y
  // se cuenten como el bug.
  await waitForDrawQuiescence(page, SETTLE_QUIET_MS, 15_000);

  const box = await originalContainer.boundingBox();
  if (!box) throw new Error("No se pudo ubicar el contenedor del visor.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Limpia el registro justo antes de scrollear: de acá en más, cualquier
  // draw de "anonimizado" sería la prueba directa del bug (un panel no
  // tocado recargándose).
  await clearDraws(page);

  // Scroll rápido y sostenido (mismo patrón que `viewer-scroll-jump.spec.ts`):
  // cruza varios bordes de página, y cada cambio de rango montado dispara su
  // propio RENDER_REQUESTED con `kind: "original"` (ADR-056 §1/§2) — nunca el
  // del kind que no se está mirando.
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

  // Evidencia positiva primero, y es la mitad que más trabaja desde el visor
  // único: el scroll SÍ tiene que haber ejercitado el pipeline de render real.
  // Si esto diera 0, la afirmación de abajo sería vacuamente verde.
  expect(
    originalDraws.length,
    "el scroll debería haber disparado al menos un render real del kind visible",
  ).toBeGreaterThan(0);

  // ADR-056 §1/§8: mirando `original`, no se pinta un solo bitmap de
  // `anonymized` — ni por un pedido de más, ni por una suscripción viva del
  // otro modo.
  expect(
    anonymizedDraws,
    `no debería haberse renderizado "anonimizado" mientras se mira "original" (draws: ${anonymizedDraws.join(", ")})`,
  ).toHaveLength(0);
});
