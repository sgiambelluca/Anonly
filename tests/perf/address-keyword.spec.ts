/**
 * M-D2 (`docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md`, Frente 2): ¿qué deja a la vista la
 * aplicación de hoy cuando una dirección viene con una palabra clave antes («Av.», «calle», «domicilio
 * en»…), escrita normal, en mayúsculas con tildes y en mayúsculas sin tildes? Opt-in: la lanza
 * `run-address-keyword.sh`. Un PDF digital (capa de texto, sin OCR) generado acá, una oración de prueba por
 * página (55 oraciones en tres escrituras, 165 páginas), se importa en la aplicación Electron empaquetada
 * con el modelo real y la configuración por defecto (la suite de medición solo fija el perfil, ADR-194 §8).
 * Una instancia fría de Electron por repetición. Solo sintéticos: nada de `ANONLY_REAL_DOC_*`.
 *
 * Por página se registra, del estado real de la app después del análisis, el texto, todas las ocurrencias
 * de cualquier tipo y qué pasó con cada parte de la oración (`addressKeywordClassify.ts`). Es una medición
 * de línea de base: no falla porque el resultado no sea el esperado; sí marca inválida la corrida si el
 * análisis no termina o si la configuración no es la esperada, e inválida la página si el texto extraído
 * difiere del escrito. Reusa el observador de M-D1.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openApp, test } from "../e2e/support/electronApp.js";

import {
  installAddressHeightObserver,
  readAddressHeightRun,
  waitForPipelineEnd,
} from "./support/addressHeightBrowser.js";
import { buildAddressKeywordPdf } from "./support/addressKeywordFixture.js";
import { buildKeywordRunRecord } from "./support/addressKeywordRun.js";
import { ADDRESS_KEYWORD_PAGES } from "./support/addressKeywordSentences.js";
import { addressKeywordRunFileName } from "./support/addressKeywordSummary.js";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const OPT_IN = process.env.ANONLY_ADDRESS_KEYWORD === "1";
const OUTPUT_DIR = process.env.ANONLY_ADDRESS_KEYWORD_OUTPUT_DIR ?? "";
const COMMIT = process.env.ANONLY_ADDRESS_KEYWORD_COMMIT ?? null;
const repetitions = Number(process.env.ANONLY_ADDRESS_KEYWORD_REPS ?? "2");
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 9)
  throw new Error(`Repeticiones inválidas: ${repetitions}`);
// El runner lanza cada repetición por separado (una suspensión invalida solo la suya).
const onlyRepetition = process.env.ANONLY_ADDRESS_KEYWORD_REP;

test.describe("Direcciones con palabra clave (M-D2)", () => {
  test.skip(!OPT_IN, "Campaña opt-in: la lanza run-address-keyword.sh");

  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    if (
      onlyRepetition !== undefined &&
      onlyRepetition !== "" &&
      Number(onlyRepetition) !== repetition
    )
      continue;
    test(`r${repetition}`, async ({ page }) => {
      test.setTimeout(900_000);
      if (OUTPUT_DIR === "") throw new Error("ANONLY_ADDRESS_KEYWORD_OUTPUT_DIR no definido.");
      await mkdir(resolve(OUTPUT_DIR), { recursive: true });
      const startedAtUtc = new Date().toISOString();
      const startedAt = Date.now();
      const write = async (record: unknown): Promise<void> => {
        await writeFile(
          resolve(OUTPUT_DIR, addressKeywordRunFileName(repetition)),
          `${JSON.stringify(
            {
              ...(record as Record<string, unknown>),
              commit: COMMIT,
              startedAtUtc,
              completedAtUtc: new Date().toISOString(),
              durationMs: Date.now() - startedAt,
            },
            null,
            2,
          )}\n`,
          { flag: "wx" },
        );
      };

      try {
        const pdf = await buildAddressKeywordPdf(ADDRESS_KEYWORD_PAGES);
        await openApp(page, "networkidle");
        await page.waitForFunction(() => globalThis.__anonlyCore !== undefined);
        await installAddressHeightObserver(page);
        await page.locator('input[type="file"]').setInputFiles({
          name: "address-keyword.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(pdf),
        });
        await waitForPipelineEnd(page, 800_000);
        const observation = await readAddressHeightRun(page);
        const record = buildKeywordRunRecord({
          repetition,
          pages: ADDRESS_KEYWORD_PAGES,
          observation,
        });
        await write(record);
        console.log(
          JSON.stringify({
            run: `r${repetition}`,
            valid: record.valid,
            invalidReasons: record.invalidReasons,
            pages: record.pageCount,
            occurrences: record.occurrenceCount,
            invalidPages: record.invalidPages.length,
          }),
        );
        // No se relanza: una corrida inválida queda escrita y el agregador la reporta.
        if (!record.valid)
          test.info().annotations.push({ type: "corrida-invalida", description: `r${repetition}` });
      } catch (error: unknown) {
        await write({
          schema: 1,
          repetition,
          valid: false,
          invalidReasons: [`spec-error: ${String(error).slice(0, 300)}`],
        }).catch(() => undefined);
        test.info().annotations.push({ type: "corrida-invalida", description: `r${repetition}` });
      }
    });
  }
});
