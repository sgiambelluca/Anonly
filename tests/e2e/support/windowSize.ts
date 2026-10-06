/**
 * `support/windowSize.ts` — pedir un tamaño de ventana y esperar a que se asiente.
 *
 * `setContentSize` no garantiza el tamaño pedido: el sistema puede recortarlo
 * al área visible de la pantalla. En el runner de macOS el contenido pedido de
 * 1024 × 700 termina en 1024 × 668, y ese recorte llega **después** de que
 * `getContentBounds()` ya devolvió 700. Comparar el viewport contra una
 * lectura única de los límites falla según quién llegue primero (visto en CI:
 * esperado 700, recibido 668). Acá se espera por la condición: límites de la
 * ventana y viewport coinciden y no cambian en lecturas consecutivas.
 */

import { type ElectronApplication, type Page } from "@playwright/test";

import { expect } from "./electronApp.js";

export interface ContentSize {
  readonly width: number;
  readonly height: number;
}

/** Lecturas consecutivas iguales que se exigen para dar el tamaño por asentado. */
const SETTLED_READINGS = 3;

async function readContentBounds(electronApp: ElectronApplication): Promise<ContentSize> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const appWindow = BrowserWindow.getAllWindows()[0];
    const { width, height } = appWindow?.getContentBounds() ?? { width: 0, height: 0 };
    return { width, height };
  });
}

/**
 * Pide `requested` como tamaño del contenido y devuelve el tamaño efectivo una
 * vez que la ventana y el viewport coinciden y dejaron de cambiar. Puede ser
 * menor al pedido si el sistema lo recorta.
 */
export async function setContentSizeAndWait(
  page: Page,
  electronApp: ElectronApplication,
  requested: ContentSize,
): Promise<ContentSize> {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
  }, requested);

  let previous: string | null = null;
  let consecutive = 0;
  let settled: ContentSize = { width: 0, height: 0 };
  await expect
    .poll(
      async () => {
        const bounds = await readContentBounds(electronApp);
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        const agree = bounds.width === viewport.width && bounds.height === viewport.height;
        const key = agree ? `${bounds.width}x${bounds.height}` : null;
        consecutive = key !== null && key === previous ? consecutive + 1 : 1;
        previous = key;
        if (key !== null) settled = bounds;
        return key === null ? 0 : consecutive;
      },
      {
        message: `La ventana no se asentó en un tamaño estable (se pidió ${requested.width}x${requested.height})`,
        intervals: [100],
        timeout: 10_000,
      },
    )
    .toBeGreaterThanOrEqual(SETTLED_READINGS);
  return settled;
}
