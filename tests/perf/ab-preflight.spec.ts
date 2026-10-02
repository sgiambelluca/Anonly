/**
 * Pre-vuelo de T-8 (`docs/roadmap/AB_Intercalado_Plan.md` §4.1): demuestra que
 * el brazo que el script dice estar corriendo es el que realmente está corriendo.
 *
 * Hace falta porque la campaña intercambia el `dist` ya construido en vez de
 * reconstruir, y eso **neutraliza `checkFreshBuild`**: con `cp -R`, el `dist`
 * siempre queda recién copiado y el guard pasa siempre, incluso midiendo el
 * brazo equivocado. Ese guard existe porque ya pasó una vez — una campaña entera
 * medida sobre un `dist` de 5,7 h de antigüedad, con todos los gates en verde
 * (`tests/perf/README.md`).
 *
 * El discriminante es de comportamiento, no de fecha (ADR-149 §2): se procesan
 * dos documentos en la misma instancia y se mira `NER_MODEL_READY` en el
 * segundo.
 *
 * - **Brazo A** (con la baja de ADR-166): el modelo se soltó al cerrar la
 *   detección del primero, así que el segundo lo vuelve a cargar y el evento
 *   **aparece**.
 * - **Brazo B** (sin la baja): el modelo sigue residente —el temporizador de
 *   ADR-080 son 60 s y acá pasan ~1,3 s entre documentos—, el kernel hace
 *   early-return sin reportar nada, y el evento **no aparece**.
 *
 * Si los dos brazos dan lo mismo, el intercambio de `dist` está roto y la
 * campaña no arranca.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, openApp, test } from "../e2e/support/electronApp.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";

import { measureProfile, printReport } from "./support/memoryProfile.js";

const P1_SAMPLE_INTERVAL_MS = 30;

test("T-8 pre-vuelo — el brazo activo es el que dice el script", async ({
  page,
  electronApp,
  electronUserDataDir,
}) => {
  test.setTimeout(260_000);

  const arm = process.env.ANONLY_AB_ARM;
  expect(arm, "ANONLY_AB_ARM no está definido").toBeTruthy();

  await openApp(page, "networkidle");
  const file = await textTenPagesFile();

  // ANONLY_AB_GAP_MS: espera con el PRIMER documento todavía abierto, antes
  // de cerrarlo — el usuario revisando. Sin ella los dos documentos van
  // pegados (~1,3 s), que es el caso "tanda". Con ella se puede hacer disparar
  // un temporizador de inactividad entre los dos y ver qué pasa con la
  // recarga que sigue.
  const gapMs = Number(process.env.ANONLY_AB_GAP_MS ?? "0");
  const reviewGap =
    gapMs > 0
      ? async (p: typeof page, temperature: "cold" | "hot"): Promise<void> => {
          if (temperature === "cold") await p.waitForTimeout(gapMs);
        }
      : undefined;
  if (gapMs > 0) test.setTimeout(260_000 + gapMs);

  const report = await measureProfile(
    page,
    electronApp,
    electronUserDataDir,
    "p1-native-10p",
    file,
    180_000,
    [],
    reviewGap,
    P1_SAMPLE_INTERVAL_MS,
  );
  printReport(report);

  expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
  expect(report.hot.ok, "la corrida caliente terminó en PIPELINE_FAILED").toBe(true);

  const reloadedInHot = report.hot.phases.NER_MODEL_READY !== undefined;
  process.stdout.write(
    `\n=== pre-vuelo brazo ${arm}: NER_MODEL_READY en caliente = ` +
      `${reloadedInHot ? `${report.hot.phases.NER_MODEL_READY?.toFixed(0)} ms` : "AUSENTE"} ===\n\n`,
  );

  // Etapa 2 del plan §5: la misma corrida sirve de pre-vuelo y de medición del
  // pico del SEGUNDO documento, que es donde vive el costo de la recarga. Se
  // escribe solo si el script pide un directorio — como pre-vuelo no escribe
  // nada. No se usa `writeReport` porque su nombre de archivo es fijo y no
  // lleva el brazo: dos brazos se pisarían.
  const outDir = process.env.ANONLY_AB_OUTPUT_DIR;
  if (outDir !== undefined && outDir !== "") {
    const runIndex = process.env.ANONLY_AB_RUN ?? "0";
    await mkdir(outDir, { recursive: true });
    const outFile = resolve(outDir, `memory-arm${arm}-run${runIndex}.json`);
    await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Medición escrita en ${outFile}\n`);
  }

  // La expectativa la declara el script, no el nombre del brazo: con tres
  // brazos, "A recarga y el resto no" deja de ser una regla que se pueda
  // deducir del nombre. ANONLY_AB_EXPECT_RELOAD=1 significa "este brazo tiene
  // que recargar el modelo en el segundo documento".
  const expectReload = process.env.ANONLY_AB_EXPECT_RELOAD;
  if (expectReload === "1") {
    expect(
      reloadedInHot,
      `brazo ${arm}: el modelo tendría que haberse soltado y recargado — si no, el dist activo no es el suyo`,
    ).toBe(true);
  } else if (expectReload === "0") {
    expect(
      reloadedInHot,
      `brazo ${arm}: el modelo tendría que seguir residente — si se recargó, el dist activo no es el suyo`,
    ).toBe(false);
  }
});
