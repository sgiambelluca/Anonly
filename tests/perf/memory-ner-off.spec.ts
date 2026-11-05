/**
 * Campaña de reducción de pico (`docs/roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md`):
 * P1 y P2 de `memory.spec.ts` con NER apagado, para un banco que **no tiene el
 * modelo de NER** (la red del contenedor rechaza `huggingface.co`).
 *
 * No reemplaza a `memory.spec.ts`: P1 y P2 llevan NER por definición
 * (ADR-146 §4) y los techos de ADR-192 se juzgan sobre ellos. Esto mide lo
 * que queda del pipeline sin el detector — parseo, render, OCR, Regex y
 * Grouping —, con el mismo instrumento y la misma secuencia fría → cierre →
 * caliente, para separar por fase y por proceso lo que no es NER.
 *
 * Opt-in: `ANONLY_MEMORY_NER_OFF=1`. Mismo canal que «P2-attrib — NER
 * apagado» de `memory-attribution.spec.ts` (`installSettingsOverride`).
 */
import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";
import { TEXT_50P_ENTITY_PAGE_INDICES, generateText50p } from "../fixtures/generate.js";

import { measureProfile, printReport, writeReport } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

test.setTimeout(300_000);
test.skip(process.env.ANONLY_MEMORY_NER_OFF !== "1", "perfil opt-in sin NER");

/** Misma cadencia fina que P1 en `memory.spec.ts` (A-3): sus fases duran milisegundos. */
const P1_SAMPLE_INTERVAL_MS = 30;

test("P1-ner-off — 10 páginas de texto nativo, sin NER", async ({
  page,
  electronApp,
  electronUserDataDir,
}, testInfo) => {
  const file = await textTenPagesFile();
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    "p1-native-10p-ner-off",
    file,
    180_000,
    [],
    undefined,
    P1_SAMPLE_INTERVAL_MS,
  );
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // DNI de la página 1 de text-10p.pdf: Regex lo encuentra sin NER.
  expect(report.cold.groupCount).toBeGreaterThan(0);
  expect(report.hot.groupCount).toBeGreaterThan(0);
});

test("P2-ner-off — 50 páginas escaneadas, sin NER", async ({
  page,
  electronApp,
  electronUserDataDir,
}, testInfo) => {
  const textSource = await generateText50p();
  const file = await getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(textSource));
  await installSettingsOverride(page, { nerEnabled: false });
  await openApp(page, "networkidle");

  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    "p2-scanned-50p-ner-off",
    file,
  );
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // Los 5 DNI conocidos salen por Regex, vía OCR real.
  expect(report.cold.groupCount).toBeGreaterThanOrEqual(TEXT_50P_ENTITY_PAGE_INDICES.length);
  expect(report.hot.groupCount).toBeGreaterThanOrEqual(TEXT_50P_ENTITY_PAGE_INDICES.length);
});
