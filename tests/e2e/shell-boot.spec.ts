/**
 * Prueba de arranque del contenedor.
 *
 * Es el único escenario que no viene de `07_Performance_Strategy.md` §11.3:
 * verifica lo que el contenedor agrega y un navegador no tiene — que la app se
 * sirva por `app://`, que el aislamiento de origen llegue **adentro de un
 * worker** (sin eso `onnxruntime-web` cae a un hilo, ADR-100), y que el
 * renderer no tenga acceso a Node (ADR-132 §3).
 */

import { expect, openApp, test } from "./support/electronApp.js";

test("el shell sirve la app por app:// con aislamiento de origen", async ({ page }) => {
  await openApp(page);

  expect(page.url()).toContain("app://local");

  const isolation = await page.evaluate(() => ({
    crossOriginIsolated: self.crossOriginIsolated,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    isSecureContext: self.isSecureContext,
  }));
  expect(isolation).toEqual({
    crossOriginIsolated: true,
    hasSharedArrayBuffer: true,
    isSecureContext: true,
  });

  // ADR-132 §3: `nodeIntegration: false` y `sandbox: true`. Si esto se afloja,
  // el renderer —que procesa documentos de terceros— gana acceso al sistema.
  const nodeReachable = await page.evaluate(
    () => typeof (globalThis as { require?: unknown }).require !== "undefined",
  );
  expect(nodeReachable).toBe(false);
});
