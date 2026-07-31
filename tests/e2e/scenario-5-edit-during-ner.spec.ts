/**
 * Escenario 5 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 5):
 * "Editar grupo mientras NER sigue corriendo → verificar que no se pierden
 * ediciones."
 *
 * A diferencia del Escenario 9 (`scenario-9-ner-runtime-reanalyze.spec.ts`,
 * `reanalyze` con NER activado en runtime sobre un documento ya `Ready`), este
 * escenario edita **durante la primera pasada** de detección: NER está
 * activado por default (`config.ts#buildDefaultEngineConfig`, mismo criterio
 * que `scenario-1-import-edit-export.spec.ts`) y corre concurrentemente con
 * Regex sobre `text-10p.pdf`. El grupo del DNI de la página 0 ("34.567.891")
 * lo detecta Regex y puede aparecer antes de que NER (y por lo tanto el
 * pipeline completo) llegue a `Ready` — la edición se hace apenas ese grupo
 * existe, tan pronto como sea posible, sin asumir una ventana de tiempo
 * exacta (afirmar que el pipeline "todavía no terminó" en ese instante
 * preciso sería una carrera contra la propia velocidad de NER en el entorno
 * de CI, y no es necesario para lo que el escenario pide probar). La garantía
 * verificada ("gana el usuario", caso límite 17 del spec de Grouping —
 * `docs/adr/ADR-038-Reanalisis-Parcial-Preservando-Ediciones.md` §Contexto
 * punto 1) es la misma que sostiene el Escenario 9, pero acá se ejercita en
 * el camino de la corrida única (sin `reanalyze`).
 *
 * "NER sigue corriendo" se verifica por el evento de carga del modelo
 * (`NER_MODEL_LOADING` → `PipelineStatus` muestra "Cargando modelo NER…",
 * `pipelineStageLabel.ts`), no por una entidad puntual que NER deba
 * detectar: confirmado empíricamente (dos corridas) que el modelo
 * cuantizado no reconoce "Juan Pérez" como Persona en este fixture
 * sintético — un problema de **precisión del modelo**, no de integración
 * del pipeline (que es lo que este E2E puede/debe verificar; recall/precision
 * real se mide contra el dataset de referencia de `tests/fixtures/README.md`,
 * gate de Hito 11). Probar "corrió" con la señal de carga evita acoplar este
 * test a la calidad de detección del modelo sobre un texto no representativo
 * del dataset de referencia.
 */

import { expect, test } from "@playwright/test";

import { textTenPagesFile } from "./support/fixtures.js";

// Mismo orden de magnitud que scenario-1 (misma carga: NER real sobre
// text-10p.pdf hasta Ready) — con headroom real sobre la suma de los
// `timeout` internos de abajo (30 s + 150 s), que de otro modo agotaría el
// timeout global sin margen para el resto del test.
test.setTimeout(240_000);

test("editar un grupo mientras NER sigue corriendo no pierde la edición", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  // Prueba temprana de que NER está en carrera: `NER_MODEL_LOADING` es un
  // estado transitorio (`pipeline.store.modelLoading`, prioridad más alta en
  // `pipelineStageLabel.ts`) que desaparece en cuanto `NER_MODEL_READY`
  // llega — se verifica ACÁ, antes de que el resto del flujo tenga chance de
  // dejarlo atrás.
  const status = page.getByRole("status");
  await expect(status).toHaveText(/Cargando modelo NER…/, { timeout: 30_000 });

  // El grupo del DNI (Regex) aparece incrementalmente, antes de Ready.
  const dniGroup = page.getByRole("treeitem", { name: "34.567.891" });
  await expect(dniGroup).toBeVisible({ timeout: 30_000 });

  // Editar de inmediato, tan pronto como el grupo existe: deshabilitarlo
  // (checkbox → `actions.updateGroup({ enabled: false })`).
  const enableCheckbox = dniGroup.getByRole("checkbox", { name: "Habilitar 34.567.891" });
  await enableCheckbox.click();
  await expect(dniGroup).toHaveAttribute("aria-checked", "false");

  // Deja correr el resto del pipeline (NER termina, Grouping cierra la
  // sesión) hasta Ready.
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 150_000 });

  // La edición sobrevivió: ni el resto de `ENTITY_FOUND` de Regex ni los de
  // NER (para otros grupos) pisaron `enabled` de este grupo (caso 17).
  await expect(dniGroup).toBeVisible();
  await expect(dniGroup).toHaveAttribute("aria-checked", "false");
});
