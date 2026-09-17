/**
 * T-7 — de qué está hecha la base caliente
 * (`docs/roadmap/Perfilado_Base_Caliente_Plan.md`).
 *
 * Es medición, no gate: no fija ningún umbral, mide y escribe a
 * `.measure/base-caliente/<timestamp>/` (o `ANONLY_HOT_BASELINE_OUTPUT_DIR`
 * si el script de campaña lo fija) — mismo criterio que `memory.spec.ts`
 * (ADR-146, "no es un gate").
 *
 * Un solo import (frío) por corrida, sin import caliente: T-7 pregunta qué
 * queda retenido después de cerrar el primer documento (§1 del plan: "la
 * aplicación queda en 1,7–2,2 GB sin documento abierto"), no cómo procesa el
 * segundo — eso ya lo mide `memory.spec.ts`. `measureHotBaselineCurve`
 * (`support/hotBaselineCurve.ts`) hace: abrir → cerrar → observar ≥125 s con
 * checkpoints en 5/15/30/45/60/75/90/120 s (C-1), cada uno con desglose por
 * tipo de proceso (C-2).
 *
 * C-3 (NER activo contra apagado) es el mismo mecanismo que
 * `memory-attribution.spec.ts` ya usa para "P2-attrib — NER apagado":
 * `installSettingsOverride(page, { nerEnabled: false })`, canal de
 * ADR-155/`settingsOverride.ts`, sin tocar producción. Las condiciones se
 * declaran alternadas (on/off/on/off/on/off) para que la deriva del banco
 * las afecte por igual — mismo criterio que `RENDER_POOL_CONDITIONS` en
 * `memory-attribution.spec.ts`, y pedido explícito del plan §3 C-3 ("no en
 * bloques").
 *
 * Perfiles: P2 (principal) y P1 (control — su base caliente es el 100% de
 * M2, así que es el caso más limpio para ver el piso sin que el documento lo
 * tape). Tres corridas por condición, seriales (`playwright.perf.config.ts`:
 * `workers: 1`, `retries: 0`), instancia fresca por corrida (fixture
 * `electronApp` de `tests/e2e/support/electronApp.ts`).
 */
import { expect, openApp, test } from "../e2e/support/electronApp.js";
import type { E2eFilePayload } from "../e2e/support/fixtures.js";
import { textTenPagesFile } from "../e2e/support/fixtures.js";
import { installSettingsOverride } from "../e2e/support/settingsOverride.js";
import { generateText50p } from "../fixtures/generate.js";

import {
  measureHotBaselineCurve,
  printHotBaselineCurveReport,
  writeHotBaselineCurveReport,
} from "./support/hotBaselineCurve.js";
import { getOrGenerateScannedFixture } from "./support/scannedFixtureCache.js";

interface NerCondition {
  readonly label: string;
  readonly nerEnabled: boolean;
}

/** Orden de declaración = orden de ejecución con `workers: 1` (plan §3 C-3: alternar, no bloques). */
const NER_CONDITIONS: ReadonlyArray<NerCondition> = [
  { label: "NER on", nerEnabled: true },
  { label: "NER off", nerEnabled: false },
];

const HOT_BASELINE_REPEATS = 3;

interface ProfileSpec {
  readonly id: string;
  readonly label: string;
  readonly runTimeoutMs: number;
  /** Generoso a propósito: import + hasta 30s de asentamiento + ventana de observación de 125s + apertura/cierre, sobre un banco con load average propio (CLAUDE.md, sección "Sobre la máquina"). */
  readonly testTimeoutMs: number;
  readonly getFile: () => Promise<E2eFilePayload>;
}

const PROFILES: ReadonlyArray<ProfileSpec> = [
  {
    id: "p1-native-10p",
    label: "P1 — 10 páginas de texto nativo (control)",
    runTimeoutMs: 180_000,
    testTimeoutMs: 220_000,
    getFile: () => textTenPagesFile(),
  },
  {
    id: "p2-scanned-50p",
    label: "P2 — 50 páginas escaneadas (principal)",
    runTimeoutMs: 180_000,
    testTimeoutMs: 280_000,
    getFile: async () => {
      const textSource = await generateText50p();
      return getOrGenerateScannedFixture("p2-scanned-50p", new Uint8Array(textSource));
    },
  },
];

/** El script de campaña (`run-hot-baseline-campaign.sh`) fija esto a `.measure/base-caliente/<timestamp>` para que las tandas no se pisen (plan §4: "sin sobrescribir tandas previas"). Sin la env var, `writeHotBaselineCurveReport` cae a su default (`.measure/base-caliente/`) — sirve para una corrida manual suelta, no para la campaña. */
function resolveOutputDir(): string | undefined {
  return process.env.ANONLY_HOT_BASELINE_OUTPUT_DIR;
}

for (const profileSpec of PROFILES) {
  for (let rep = 0; rep < HOT_BASELINE_REPEATS; rep += 1) {
    for (const condition of NER_CONDITIONS) {
      test(`T-7 — ${profileSpec.label} — ${condition.label} (alternada, corrida ${rep + 1}/${HOT_BASELINE_REPEATS})`, async ({
        page,
        electronApp,
      }) => {
        test.setTimeout(profileSpec.testTimeoutMs);

        const file = await profileSpec.getFile();
        if (!condition.nerEnabled) {
          await installSettingsOverride(page, { nerEnabled: false });
        }
        await openApp(page, "networkidle");

        const report = await measureHotBaselineCurve(
          page,
          electronApp,
          profileSpec.id,
          condition.nerEnabled,
          file,
          profileSpec.runTimeoutMs,
        );
        printHotBaselineCurveReport(report);
        await writeHotBaselineCurveReport(report, `run${rep}`, resolveOutputDir());

        expect(report.cold.ok, "la corrida fría terminó en PIPELINE_FAILED").toBe(true);
        // Con NER apagado, Regex igual encuentra los DNI conocidos — mismo
        // criterio que "P2-attrib — NER apagado" en memory-attribution.spec.ts:
        // >0 en vez de un umbral por perfil, para no acoplar esta corrida a
        // cuántas entidades detecta NER específicamente.
        expect(report.cold.groupCount).toBeGreaterThan(0);
        // Cada checkpoint tiene que haber capturado una muestra real — si
        // `sumBytes` da null en alguno, la ventana de observación no llegó a
        // cubrir ese punto (regresión del instrumento, no del producto).
        for (const point of report.curve) {
          expect(point.sumBytes, `checkpoint t=${point.targetMs}ms sin muestra`).not.toBeNull();
        }
      });
    }
  }
}
