/**
 * `support/blobUrlTracker.ts` — instrumenta `URL.createObjectURL`/
 * `URL.revokeObjectURL` en la página, para que el Escenario 7
 * (`scenario-7-open-close-cycle.spec.ts`, ADR-051 §5/§Validación) pueda
 * verificar "sin blob URLs vivos" tras cada `DOCUMENT_CLOSED` sin depender de
 * un hook de debug en `apps/react-client/src` (fuera de alcance de este PR).
 *
 * Por qué interceptar en la página (vía `page.addInitScript`) alcanza: la
 * única fuente de blob URLs en el ciclo de este escenario es el preview del
 * Render Engine (`canvasBlobUrl` de `PREVIEW_UPDATED`) — no hay export en
 * este escenario. `RenderEngine.emitPreviewUpdated`
 * (`packages/anonymization-core/render-engine/src/render.engine.ts`) está
 * bajo el comentario de sección "── Helpers de host ──": la clase
 * `RenderEngine` completa corre HOST-side (ADR-043) — el worker solo hace el
 * trabajo de píxeles vía `./worker/kernel.ts` y devuelve bytes ya
 * codificados; el `new Blob(...)` + `URL.createObjectURL(blob)` ocurre en el
 * mismo hilo principal que esta página, nunca dentro del Worker. La
 * revocación (`packages/anonymization-core/src/blob-tracker.ts`,
 * `BlobUrlTracker.revokeByPrefix`, invocada por el `Orchestrator.closeDocument`
 * del façade) también es host-side por la misma razón: el `Orchestrator` es
 * una clase del hilo principal, no del worker. Parchear `window.URL` desde
 * `addInitScript` (que corre ANTES que cualquier script de la app, en cada
 * navegación) cubre entonces las dos puntas sin falsos negativos.
 */

import type { Page } from "@playwright/test";

declare global {
  interface Window {
    /** Set de blob: URLs creadas y todavía no revocadas (instalado por `installBlobUrlTracker`). */
    __anonlyLiveBlobUrls?: Set<string>;
  }
}

/** Instala el parche de rastreo. Debe llamarse ANTES de `page.goto(...)`. */
export async function installBlobUrlTracker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const live = new Set<string>();
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      const url = originalCreateObjectURL(obj);
      live.add(url);
      return url;
    };

    URL.revokeObjectURL = (url: string): void => {
      live.delete(url);
      originalRevokeObjectURL(url);
    };

    window.__anonlyLiveBlobUrls = live;
  });
}

/** Cantidad de blob: URLs vivas (creadas y aún no revocadas) en este momento. */
export async function liveBlobUrlCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__anonlyLiveBlobUrls?.size ?? 0);
}
