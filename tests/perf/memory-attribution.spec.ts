/**
 * H-10 — atribución del exceso de M1 sobre 512 MB en P2 (`memory.spec.ts`).
 *
 * El planificador descartó la primera lectura ("costo dominante: caché de
 * `ImageData` del OCR") — `rasterizePage` no usa esa LRU (el propio motor
 * lo documenta) y las imágenes en vuelo ya están acotadas por ADR-143. Dos
 * sospechas concretas a probar, cada una con **una** corrida
 * frío→cerrar→caliente sobre el mismo fixture base (`generateText50p`,
 * salvo donde se indica), reportando el delta de M1 contra P2 base:
 *
 * 1. **NER apagado** (`nerEnabled: false`, `installSettingsOverride` —
 *    mecanismo de test ya existente, sin tocar producción): cuánto del
 *    pico es del detector de nombres.
 * 2. **`ocrPoolSize: 1`**, vía `performancePreset: "low"` — es el único
 *    lever alcanzable desde el arnés sin tocar código de producción
 *    (`settingsToEngineConfig.ts` solo deriva tamaños de pool por preset
 *    bucketado, nunca un campo suelto). **Confunde**: el preset "low"
 *    también fija `pdfPoolSize`/`nerPoolSize`/`renderPoolSize` a 1, no
 *    solo `ocrPoolSize` — un NER pool más chico puede aportar su propio
 *    delta (menos instancias del modelo ONNX en paralelo), que este
 *    experimento no separa del efecto de "menos copias de imagen en
 *    vuelo". Documentado, no resuelto: no hay override más fino sin tocar
 *    `settingsToEngineConfig.ts`/`settings.store.ts`.
 * 3. **Proxy de `ocr.dpi: 200`**: `ocr.dpi` tampoco es una
 *    `SettingsOverride` alcanzable (no es un campo de settings del
 *    usuario, es un default fijo de `config.ts`). El área rasterizada de
 *    una página escala con ancho×alto — reducir el tamaño físico de la
 *    página al mismo ratio que (200/300)² ≈ 0,444 prueba la MISMA
 *    hipótesis (¿el costo es proporcional al área?) sin tocar producción.
 *    `generateText50pSmallPage()` (`tests/fixtures/generate.ts`) es ese
 *    proxy — no es literalmente "OCR a 200 dpi", es un documento cuyas
 *    páginas rasterizan a un área equivalente.
 *
 * Una corrida por condición (no 3+3): esto es atribución exploratoria, no
 * caracterización estadística — si un delta es grande y consistente con la
 * hipótesis, una corrida alcanza para orientar; si es chico o ambiguo, se
 * anota como tal en el reporte en vez de gastar más corridas de ~30-60s
 * cada una para una pregunta que ADR-146 §6/ADR-149 §5 prohíben resolver
 * mirando un número aislado.
 */
import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";
import { generateText50p, generateText50pSmallPage } from "../fixtures/generate.js";

import { measureProfile, printReport, writeReport } from "./support/memoryProfile.js";

test.setTimeout(300_000);

test("P2-attrib — NER apagado (cuánto es del detector)", async ({
  page,
  electronApp,
}, testInfo) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");
  const textSource = await generateText50p();
  const file = await rasterizeToScannedPdf(page, new Uint8Array(textSource));

  const report = await measureProfile(page, electronApp, "p2-attrib-ner-off", file);
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // Con NER apagado, Regex igual encuentra los 5 DNI conocidos — la caída de
  // groupCount (si la hay) tiene que venir de Person (solo NER lo detecta),
  // no de que el pipeline haya dejado de procesar páginas.
  expect(report.cold.groupCount).toBeGreaterThan(0);
});

test("P2-attrib — ocrPoolSize:1 vía performancePreset low (cuánto escala con las copias en vuelo; confunde con nerPoolSize/pdfPoolSize/renderPoolSize:1)", async ({
  page,
  electronApp,
}, testInfo) => {
  await installSettingsOverride(page, { performancePreset: "low" });
  await openApp(page, "networkidle");
  const textSource = await generateText50p();
  const file = await rasterizeToScannedPdf(page, new Uint8Array(textSource));

  const report = await measureProfile(page, electronApp, "p2-attrib-low-preset", file);
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  expect(report.cold.groupCount).toBeGreaterThan(0);
});

test("P2-attrib — página a 4/9 de área (proxy de ocr.dpi 200 contra 300; cuánto es proporcional al área rasterizada)", async ({
  page,
  electronApp,
}, testInfo) => {
  await openApp(page, "networkidle");
  const textSource = await generateText50pSmallPage();
  const file = await rasterizeToScannedPdf(page, new Uint8Array(textSource));

  const report = await measureProfile(page, electronApp, "p2-attrib-small-page", file);
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  expect(report.cold.groupCount).toBeGreaterThan(0);
});
