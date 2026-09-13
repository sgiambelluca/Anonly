/**
 * H-10 (ADR-146): instrumento de medición de memoria M1/M2, sobre el shell
 * de Electron empaquetado — mismo arnés que `pipeline-timing.spec.ts`
 * (ADR-153 §2: tiempos y memoria salen del mismo proceso, mismo
 * instrumento, se pueden leer juntos).
 *
 * **No es un gate** (ADR-146, "en contra": "no fija los números finales del
 * gate... primero H-10 mide"). Mide y reporta — mismo criterio que
 * `tests/measure/baseline.spec.ts` — y escribe el resultado en `.measure/`
 * para comparar corridas.
 *
 * Perfiles (ADR-146 §4): P1 (10 páginas de texto nativo, control), P2 (50
 * páginas escaneadas, el fixture de H-10) y P2-dense (mismas 50 páginas,
 * entidad en las 50 en vez de 5, párrafo más largo — control de densidad
 * pedido para separar "más páginas" de "más carga por página" como
 * variables de M1). Ver `memory-attribution.spec.ts` para las corridas que
 * aíslan de qué componente sale el exceso de P2 sobre 512 MB. P3 (ciclo de
 * 10 open/close) no está en este archivo — H-07/test:leak es quien lo
 * necesita y todavía no existe; ver `07_Performance_Strategy.md` §11.4.
 *
 * Frío/caliente, dentro de la MISMA instancia de Electron (ADR-146 §4: "los
 * modelos ya cargados por un documento anterior en el mismo arranque"):
 * import 1 (frío, sin modelos) → `closeDocument` → import 2 (caliente, los
 * modelos siguen retenidos por el idle-dispose de ADR-080). M1 solo tiene
 * sentido en la corrida caliente: su definición exige una línea de base
 * "con los modelos ya cargados y sin documento abierto" (ADR-146 §1), que
 * recién existe después de haber procesado al menos un documento.
 *
 * Los PDF escaneados se generan con `getOrGenerateScannedFixture`
 * (`support/scannedFixtureCache.ts`), **no** con `rasterizeToScannedPdf(page, …)`
 * usando la `page` medida — corregido a partir de una revisión del
 * planificador: rasterizar dentro del mismo renderer que después mide
 * `memorySampler` deja residencia de la propia generación (imports
 * dinámicos de pdfjs-dist/pdf-lib, 50 renders a canvas) contaminando la
 * línea de base "fría", contra lo que pide ADR-146 §4 ("en un proceso
 * separado que termine antes de medir").
 */
import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";
import {
  TEXT_200P_ENTITY_PAGE_INDICES,
  TEXT_50P_ENTITY_PAGE_INDICES,
  generateText200p,
  generateText50p,
  generateText50pDense,
} from "../fixtures/generate.js";

import { measureProfile, printReport, writeReport } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

test.setTimeout(300_000);

test("P1 — 10 páginas de texto nativo (control)", async ({
  page,
  electronApp,
  electronUserDataDir,
}, testInfo) => {
  await openApp(page, "networkidle");
  const file = await textTenPagesFile();

  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    "p1-native-10p",
    file,
  );
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // DNI 34.567.891 de la página 1 de text-10p.pdf — Regex sin depender de NER.
  expect(report.cold.groupCount).toBeGreaterThan(0);
  expect(report.hot.groupCount).toBeGreaterThan(0);
});

test("P2 — 50 páginas escaneadas (fixture de H-10)", async ({
  page,
  electronApp,
  electronUserDataDir,
}, testInfo) => {
  const textSource = await generateText50p();
  // Fuera de la ventana de medición Y fuera del renderer medido (ADR-146
  // §15.2 punto 4 / §4): un chromium aparte, cerrado antes de abrir la app.
  const file = await getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(textSource));
  await openApp(page, "networkidle");

  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    "p2-scanned-50p",
    file,
  );
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // 5 páginas con DNI conocido (TEXT_50P_ENTITY_PAGE_INDICES) — al menos esas
  // deberían agrupar, vía OCR real.
  expect(report.cold.groupCount).toBeGreaterThanOrEqual(TEXT_50P_ENTITY_PAGE_INDICES.length);
  expect(report.hot.groupCount).toBeGreaterThanOrEqual(TEXT_50P_ENTITY_PAGE_INDICES.length);
});

test("P2-dense — 50 páginas escaneadas, entidades en las 50 (control de densidad)", async ({
  page,
  electronApp,
  electronUserDataDir,
}, testInfo) => {
  const textSource = await generateText50pDense();
  const file = await getOrGenerateScannedFixture(
    "p2-scanned-50p-dense",
    new Uint8Array(textSource),
  );
  await openApp(page, "networkidle");

  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    "p2-scanned-50p-dense",
    file,
  );
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // Las 50 páginas llevan entidad acá (vs. 5 de 50 en p2-scanned-50p) —
  // umbral mucho más alto a propósito, para que un falso verde (0 grupos por
  // un OCR/NER roto) no pase inadvertido en el perfil que más volumen mueve.
  expect(report.cold.groupCount).toBeGreaterThan(TEXT_50P_ENTITY_PAGE_INDICES.length * 5);
  expect(report.hot.groupCount).toBeGreaterThan(TEXT_50P_ENTITY_PAGE_INDICES.length * 5);
});

test.describe("P2-200 — 200 páginas escaneadas (fixture de H-10 T-3)", () => {
  test.skip(process.env.ANONLY_MEMORY_200P !== "1", "T-3 es un perfil opt-in");

  test("perfil p2-scanned-200p", async ({ page, electronApp, electronUserDataDir }, testInfo) => {
    test.setTimeout(2_100_000);

    const textSource = await generateText200p();
    // Fuera de la ventana de medición Y fuera del renderer medido: el
    // escaneado se construye en un Chromium separado y se cachea antes de
    // abrir el Electron que mide memoria (ADR-146 §4).
    const file = await getOrGenerateScannedFixture("p2-scanned-200p", new Uint8Array(textSource));
    await openApp(page, "networkidle");

    const report = await measureProfile(
      page,
      electronApp,
      electronUserDataDir,
      "p2-scanned-200p",
      file,
      900_000,
    );
    printReport(report);
    await writeReport(report, testInfo.repeatEachIndex);

    expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
    expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
    // Una entidad conocida por cada una de las 20 posiciones de verificación.
    // Sirve además para detectar un pipeline que no alcanzó el final del PDF.
    expect(report.cold.groupCount).toBeGreaterThanOrEqual(TEXT_200P_ENTITY_PAGE_INDICES.length);
    expect(report.hot.groupCount).toBeGreaterThanOrEqual(TEXT_200P_ENTITY_PAGE_INDICES.length);
  });
});
