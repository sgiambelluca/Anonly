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
 * Regex sobre `text-10p-person.pdf` (`textTenPagesWithPersonFile`, ver el
 * último párrafo — no `text-10p.pdf`). El grupo del DNI de la página 0 ("34.567.891")
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
 * detectar durante la carrera: confirmado empíricamente (dos corridas) que
 * el modelo cuantizado no reconoce "Juan Pérez" como Persona en el fixture
 * `text-10p.pdf` original — un problema de **precisión del modelo** sobre
 * esa oración puntual (el nombre queda pegado a una lista de otras
 * entidades), no de integración del pipeline. Precisión/recall real se mide
 * contra el dataset de referencia de `tests/fixtures/README.md` (gate de
 * Hito 11); este E2E solo necesita **una** detección para probar que el
 * pipeline integra.
 *
 * Por eso, y para cerrar el agujero de ADR-055 §6 ("no existe, en ningún
 * nivel de la pirámide, un test que verifique que una entidad detectada por
 * NER llega a la UI" — el bug que el PR de decodificación del sobre del
 * `NerWorker` arregló pasó los 911 tests, los 203 de contrato y los 12 E2E
 * existentes sin que ninguno lo notara), este escenario se eligió como sede
 * de esa aserción sobre el Escenario 9 (el otro candidato, que también
 * corre NER real pero vía `reanalyze`): corre el camino de una sola pasada
 * (NER activado por default, el mismo que reportó el bug en producción,
 * `ADR-055` Contexto §1) y es el más barato de los dos, lo que importa para
 * poder revalidar la estabilidad de una aserción que depende de un modelo
 * real. (El presupuesto de `test.setTimeout` de este escenario es la mitad
 * del Escenario 9 — 240 s contra 480 s. Son presupuestos, no mediciones: los
 * runtimes reales están en el orden de ~14 s cada uno.) La aserción final usa un
 * fixture propio (`textTenPagesWithPersonFile`, `support/fixtures.ts`) con
 * dos oraciones de nombre "limpias" (sin otras entidades alrededor) en vez
 * de reutilizar "Juan Pérez", justamente porque esa oración ya está probada
 * como no reconocida.
 */

import { expect, test } from "@playwright/test";

import { textTenPagesWithPersonFile } from "./support/fixtures.js";

// Mismo orden de magnitud que scenario-1 (misma carga: NER real sobre
// text-10p.pdf hasta Ready) — con headroom real sobre la suma de los
// `timeout` internos de abajo (30 s + 150 s), que de otro modo agotaría el
// timeout global sin margen para el resto del test.
test.setTimeout(240_000);

test("editar un grupo mientras NER sigue corriendo no pierde la edición", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await textTenPagesWithPersonFile();
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

  // ADR-055 §6: al menos un grupo de tipo Persona llegó al panel de
  // Entidades — prueba de que una entidad detectada por NER (que cruzó el
  // sobre `{ spans }` del `NerWorker` real, no el camino in-process)
  // efectivamente llega a la UI. Se assertea la EXISTENCIA del grupo de
  // tipo, no un valor puntual: cuál de los nombres candidatos del fixture
  // detectó el modelo no es parte del contrato (mismo criterio que
  // `scenario-10-merge-split-groups.spec.ts` sobre los grupos de DNI). El
  // target es el botón de la cabecera `EntityTypeGroup`
  // (`{ENTITY_TYPE_LABEL[type]} ({groups.length})`, `EntityTypeGroup.tsx`),
  // no el `treeitem` que la envuelve: el `treeitem` acumula en su nombre
  // accesible el de sus controles hermanos ("Colapsar Personas Habilitar
  // todos los grupos de Personas Personas (N)"), así que anclar el regex al
  // inicio ahí no matchea — confirmado corriendo el test antes de este
  // ajuste. `exportButton` ya visible implica que `NER_FINISHED` ya ocurrió
  // (Ready exige que todos los motores terminen), así que acá no se espera
  // a la inferencia en sí — el poll cubre el margen entre el último evento
  // de dominio y el repintado de React, con presupuesto generoso (no
  // `waitForTimeout`, precedente del Escenario 11) por si CI (2 cores,
  // software rendering) lo necesita.
  const personTypeGroupButton = page.getByRole("button", { name: /^Personas \(\d+\)$/ });
  await expect
    .poll(() => personTypeGroupButton.count(), {
      timeout: 30_000,
      message: "esperaba al menos un grupo de tipo Persona en el panel de Entidades",
    })
    .toBeGreaterThan(0);
});
