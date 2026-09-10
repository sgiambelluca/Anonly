/**
 * `support/scannedFixtureCache.ts` — corrige el defecto del instrumento de
 * H-10 que encontró el planificador: `rasterizeToScannedPdf(page, ...)`
 * llamado con la `page` de Electron que después mide `memorySampler` deja
 * residencia de la propia generación (imports dinámicos de pdfjs-dist/
 * pdf-lib como blob URLs, 50 renders a canvas) contaminando la línea de
 * base "fría" — ADR-146 §4 pide generar el fixture "fuera de la ventana de
 * medición **o en un proceso separado que termine antes de medir**"; el
 * código anterior cumplía la primera mitad y no la segunda.
 *
 * Medido con el instrumento contaminado: base fría de P2 en 1223-1248 MB
 * contra 403-430 MB de P1 (que genera su PDF en Node, sin este problema).
 *
 * Arreglo: rasterizar en un `chromium.launch()` **plano** (no Electron, no
 * la app) que se cierra antes de lanzar la instancia que se mide —
 * `rasterizeToScannedPdf` no usa nada específico de Electron ni del origen
 * de la app, solo `page.evaluate` con los bundles de pdfjs-dist/pdf-lib
 * inyectados como blob URLs (`tests/e2e/support/scannedPdf.ts`) — y
 * cachear el resultado a disco (`.measure/fixtures/`, gitignoreado) para no
 * repetir el trabajo en cada test/corrida. Sin dependencias nuevas: `chromium`
 * ya viene con `@playwright/test` (R-12).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import type { E2eFilePayload } from "../../e2e/support/fixtures.js";
import { rasterizeToScannedPdf } from "../../e2e/support/scannedPdf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(HERE, "../../../.measure/fixtures");

/**
 * Devuelve el PDF escaneado correspondiente a `sourceBytes`, generándolo
 * (en un browser aparte) solo si no está cacheado. `cacheKey` es un nombre
 * legible para el archivo; el hash de `sourceBytes` en el nombre evita
 * servir un cache viejo si el generador de la fuente cambia.
 */
export async function getOrGenerateScannedFixture(
  cacheKey: string,
  sourceBytes: Uint8Array,
): Promise<E2eFilePayload> {
  await mkdir(CACHE_DIR, { recursive: true });
  const hash = createHash("sha256").update(sourceBytes).digest("hex").slice(0, 16);
  const cachePath = resolve(CACHE_DIR, `${cacheKey}-${hash}.pdf`);

  const cached = await readFile(cachePath).catch(() => undefined);
  if (cached !== undefined) {
    return { name: `${cacheKey}.pdf`, mimeType: "application/pdf", buffer: cached };
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const generated = await rasterizeToScannedPdf(page, sourceBytes);
    await writeFile(cachePath, generated.buffer);
    return generated;
  } finally {
    await browser.close();
  }
}
