/**
 * H-10 — atribución del exceso de M1 sobre 512 MB en P2 (`memory.spec.ts`).
 *
 * El planificador descartó la primera lectura ("costo dominante: caché de
 * `ImageData` del OCR") — `rasterizePage` no usa esa LRU (el propio motor
 * lo documenta) y las imágenes en vuelo ya están acotadas por ADR-143.
 *
 * **`renderPoolSize` — el método de comparar M2 entre corridas alternadas
 * (ADR-146 §7, enmienda 2026-09-10) se probó acá y no tiene resolución;
 * ADR-146 §7 punto 3 lo reemplazó al día siguiente (2026-09-11).** El
 * conteo de workers por pool (Task 3 de esta ronda) midió, con settings por
 * defecto: `ocr-page`/`render-page` alcanzan su tamaño de pool configurado
 * (2 y 4 con 8 CPUs); `ner-page`/`pdf-parse` se quedan en 1 sin importar el
 * tamaño configurado (`NerEngine.processPages` es secuencial por página —
 * ADR-046 §8/ADR-101 —, y `pdf-parse` es un solo job por documento). O sea:
 * de los cuatro pools, solo `ocrPoolSize` y `renderPoolSize` mueven
 * concurrencia real hoy. `renderPoolSize` se aisló con el canal de overrides
 * (ADR-155) porque cada worker de Render recibe el documento por el
 * `broadcast` de `load-document` (`reprimeWorkers`, ADR-043 §5), que no
 * puede usar `transferList` porque el mismo buffer va a los N workers
 * vivos — la premisa original ("cuatro copias del documento, cientos de
 * MB") estaba errada por dos órdenes de magnitud: el fixture de P2 pesa
 * 1,71 MB, así que los tres clones de más cuestan 5,1 MB, no cientos
 * (ADR-154 §2 lever 2, corregido).
 *
 * **Resultado de comparar M2 entre `renderPoolSize: 4` (auto) y `:1`,
 * alternando 3 pares dentro de esta misma ejecución de archivo**: −83 MB de
 * promedio en caliente, +264 MB en frío — cada uno consistente 3/3 en su
 * propia dirección, contradictorios entre sí. Los dos deltas están por
 * debajo del ruido de M2 ya medido entre tandas separadas (~345 MB), y 3/3
 * con n=3 ocurre una de cada cuatro veces por azar puro: **no hay
 * resultado**, no es que el costo sea chico. Ningún lever candidato (50-400
 * MB) es mayor que ese ruido, así que restar dos corridas no puede
 * resolverlos — ni triplicando las repeticiones (bajar el error estándar
 * de 345 a 50 MB pediría del orden de cincuenta corridas por condición).
 * `renderPoolSize` queda como sospechoso de baja prioridad y sin confirmar
 * — lo que sobrevive del lever no es el archivo clonado sino el estado por
 * instancia (canvas de cada worker, lo que su propio pdf.js decodificó),
 * compatible en orden de magnitud con el delta caliente pero no resuelto
 * por este instrumento.
 *
 * Las 6 corridas de acá abajo (`RENDER_POOL_CONDITIONS`) se conservan **no**
 * como resultado de atribución sino porque validan de punta a punta el
 * canal de overrides contra un build real (`render-page` respondió 4 vs. 1
 * según la condición) — la primera vez que se probó así: la corrida previa
 * había salido en falso por un `apps/react-client/dist` de 5,7 h de
 * antigüedad, con los gates en verde porque no dependen del build
 * empaquetado (de ahí el guard de build fresco en `playwright.perf.config.ts`).
 * La atribución real de acá en más se hace por fase, dentro de una sola
 * corrida (ADR-146 §7 punto 3) — instrumento todavía pendiente, ver
 * `tests/perf/README.md` por el estado de esa migración.
 *
 * Dos hipótesis más, cada una con **una** corrida frío→cerrar→caliente sobre
 * el fixture base (`generateText50p`, salvo donde se indica) — atribución
 * exploratoria, no caracterización estadística; no comparan pool sizes, así
 * que la resta M1 todavía sirve de orientación aunque sea una cota:
 *
 * 1. **NER apagado** (`nerEnabled: false`, `installSettingsOverride` —
 *    mecanismo de test ya existente, sin tocar producción): cuánto del
 *    pico es del detector de nombres en sí (modelo cargado, pipeline
 *    activo), no de su tamaño de pool.
 * 2. **Proxy de `ocr.dpi: 200`**: `ocr.dpi` tampoco es una
 *    `SettingsOverride` alcanzable vía settings (aunque sí vía el canal de
 *    overrides ahora — no usado acá para no cambiar dos cosas en el mismo
 *    experimento). El área rasterizada de una página escala con ancho×alto —
 *    reducir el tamaño físico de la página al mismo ratio que (200/300)² ≈
 *    0,444 prueba la MISMA hipótesis (¿el costo es proporcional al área?)
 *    sin tocar producción. `generateText50pSmallPage()`
 *    (`tests/fixtures/generate.ts`) es ese proxy — no es literalmente "OCR a
 *    200 dpi", es un documento cuyas páginas rasterizan a un área
 *    equivalente.
 *
 * Los PDF escaneados salen de `getOrGenerateScannedFixture`
 * (`support/scannedFixtureCache.ts`), no de rasterizar con la `page` medida
 * — mismo arreglo que `memory.spec.ts` (revisión del planificador sobre el
 * defecto del instrumento, ver ese archivo).
 */
import type { EngineConfigOverrides } from "@anonly/anonymization-core";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";
import { generateText50p, generateText50pSmallPage } from "../fixtures/generate.js";

import { installEngineOverrides } from "./support/engineOverrides.js";
import { measureProfile, printReport, writeReport } from "./support/memoryProfile.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

test.setTimeout(300_000);

test("P2-attrib — NER apagado (cuánto es del detector)", async ({
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
    "p2-attrib-ner-off",
    file,
  );
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  // Con NER apagado, Regex igual encuentra los 5 DNI conocidos — la caída de
  // groupCount (si la hay) tiene que venir de Person (solo NER lo detecta),
  // no de que el pipeline haya dejado de procesar páginas.
  expect(report.cold.groupCount).toBeGreaterThan(0);
});

/**
 * Regresión del canal de overrides (ADR-155), no atribución de memoria (ver
 * cabecera del archivo). Dos configuraciones, alternadas 3 veces cada una (6
 * corridas totales, en orden de declaración = orden de ejecución con un solo
 * worker de Playwright): auto/1/auto/1/auto/1. `{}` en "auto" no es "sin
 * canal" (eso sería no llamar a `installEngineOverrides` en absoluto) sino
 * un `EngineConfigOverrides` vacío explícito — mergea igual que la ausencia
 * (`{...config.workerPool, ...{}.workerPool}` es un no-op), pero ejercita
 * el mismo código en las dos condiciones.
 */
const RENDER_POOL_CONDITIONS: ReadonlyArray<{
  readonly label: string;
  readonly profile: string;
  readonly overrides: EngineConfigOverrides;
}> = [
  { label: "auto (4 con 8 CPUs)", profile: "p2-attrib-renderpool-auto", overrides: {} },
  {
    label: "renderPoolSize:1",
    profile: "p2-attrib-renderpool-1",
    overrides: { workerPool: { renderPoolSize: 1 } },
  },
];
const RENDER_POOL_REPEATS = 3;

for (let rep = 0; rep < RENDER_POOL_REPEATS; rep += 1) {
  for (const condition of RENDER_POOL_CONDITIONS) {
    test(`P2-attrib — renderPoolSize ${condition.label} (alternada, corrida ${rep + 1}/${RENDER_POOL_REPEATS})`, async ({
      page,
      electronApp,
      electronUserDataDir,
    }) => {
      const textSource = await generateText50p();
      const file = await getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(textSource));
      await installEngineOverrides(page, condition.overrides);
      await openApp(page, "networkidle");

      const report = await measureProfile(
        page,
        electronApp,
        electronUserDataDir,
        condition.profile,
        file,
      );
      printReport(report);
      await writeReport(report, rep);

      expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
      expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
      expect(report.cold.groupCount).toBeGreaterThan(0);
    });
  }
}

test("P2-attrib — página a 4/9 de área (proxy de ocr.dpi 200 contra 300; cuánto es proporcional al área rasterizada)", async ({
  page,
  electronApp,
  electronUserDataDir,
}, testInfo) => {
  const textSource = await generateText50pSmallPage();
  const file = await getOrGenerateScannedFixture(
    "p2-attrib-small-page",
    new Uint8Array(textSource),
  );
  await openApp(page, "networkidle");

  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    "p2-attrib-small-page",
    file,
  );
  printReport(report);
  await writeReport(report, testInfo.repeatEachIndex);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);
  expect(report.cold.groupCount).toBeGreaterThan(0);
});
