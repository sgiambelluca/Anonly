/**
 * T-8 (`docs/roadmap/AB_Intercalado_Plan.md`): **una** corrida de la curva de
 * base caliente por invocación, etiquetada con el brazo que se está midiendo.
 *
 * Una corrida por invocación, y no las doce en un solo `playwright test`, es el
 * punto del diseño: entre corrida y corrida el script de campaña intercambia el
 * `dist` construido para el otro brazo (plan §4). Alternar A/B dentro de la
 * misma sesión es lo que hace que la deriva del banco atraviese a los dos por
 * igual — que es la única forma de comparar RSS entre dos versiones del código
 * (plan §2, `tests/perf/README.md`: comparar entre tandas separadas quedó
 * retirado como método).
 *
 * Perfil fijo: P1 con NER activo. Sin OCR de por medio, la memoria del modelo es
 * prácticamente todo lo que se mueve; P2 arrastra el residuo de OCR y su señal
 * cambia de signo entre tandas (`Perfilado_Base_Caliente_Medicion.md` §4.2).
 *
 * No es un gate: mide y escribe. El brazo sale de `ANONLY_AB_ARM` y el índice de
 * corrida de `ANONLY_AB_RUN`, los dos obligatorios — sin ellos el reporte no se
 * podría emparejar después, así que el test falla en vez de escribir un archivo
 * ambiguo.
 */
import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";

import {
  measureHotBaselineCurve,
  printHotBaselineCurveReport,
  writeHotBaselineCurveReport,
} from "./support/hotBaselineCurve.js";

const PROFILE_ID = "p1-native-10p";
const RUN_TIMEOUT_MS = 180_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} no está definido. Esta spec se lanza desde run-ab-intercalado.sh, ` +
        `que fija el brazo y el índice de corrida — correrla suelta produciría un ` +
        `reporte que no se puede emparejar (plan §6).`,
    );
  }
  return value;
}

test("T-8 — curva de base caliente, P1 con NER (un brazo, una corrida)", async ({
  page,
  electronApp,
}) => {
  test.setTimeout(260_000);

  const arm = requireEnv("ANONLY_AB_ARM");
  const runIndex = requireEnv("ANONLY_AB_RUN");
  const outputDir = requireEnv("ANONLY_HOT_BASELINE_OUTPUT_DIR");

  const file = await textTenPagesFile();
  await openApp(page, "networkidle");

  const report = await measureHotBaselineCurve(
    page,
    electronApp,
    PROFILE_ID,
    true,
    file,
    RUN_TIMEOUT_MS,
  );
  printHotBaselineCurveReport(report);
  await writeHotBaselineCurveReport(report, `arm${arm}-run${runIndex}`, outputDir);

  expect(report.cold.ok, "la corrida terminó en PIPELINE_FAILED").toBe(true);
  expect(report.cold.groupCount).toBeGreaterThan(0);
  for (const point of report.curve) {
    expect(point.sumBytes, `checkpoint t=${point.targetMs}ms sin muestra`).not.toBeNull();
  }
});
