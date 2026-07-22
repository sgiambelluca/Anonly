/**
 * Escenario 1 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 1):
 * "Cargar PDF con texto → ver grupos aparecer → editar modo de un grupo →
 * exportar → descargar."
 *
 * Corre contra el core **in-process** (sin Web Workers reales — Hito 10
 * PR10; el wiring de workers reales es PR11+, `docs/ui/React_Client.md`
 * §2.4). El fixture `text-10p.pdf` (`tests/fixtures/README.md`) trae, en su
 * página 0, "DNI 34.567.891": una entidad detectada por Regex (sin depender
 * de NER), útil para verificar el "ver grupos aparecer" **incremental**
 * (`ENTITY_GROUP_CREATED` llega grupo a grupo, `07_Performance_Strategy.md`
 * §4.1) antes de que el pipeline llegue a `Ready`.
 *
 * NER está activado por default (`config.ts#buildDefaultEngineConfig`:
 * `ner.enabled: true`) y corre igual sobre el mismo documento (no hay forma
 * de desactivarlo antes de importar — ver la ambigüedad reportada para el
 * Escenario 8 en `scenario-8-ner-disabled.spec.ts`), así que **sí** hay que
 * esperar a que termine para que el pipeline llegue a `Ready` y aparezca
 * `ExportButton`. El modelo NER se sirve first-party desde
 * `apps/react-client/public/models/ner/` (ADR-018, ~174 MB sin red real: es
 * un archivo local servido por Vite) pero aun así la primera carga + la
 * inferencia ONNX pueden tardar bastante más que el objetivo de producción de
 * `07_Performance_Strategy.md` §1 (< 8 s) en un contexto de navegador nuevo
 * sin cache — de ahí el timeout generoso de este test.
 */

import { expect, test } from "@playwright/test";

import { textTenPagesFile } from "./support/fixtures.js";

test.setTimeout(420_000);

test("cargar PDF con texto, ver grupos, editar modo, exportar y descargar", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  // "ver grupos aparecer": el grupo del DNI (detectado por Regex, sin
  // depender de que NER termine) debería aparecer bastante antes de que el
  // pipeline llegue a Ready.
  const dniGroup = page.getByRole("treeitem", { name: "34.567.891" });
  await expect(dniGroup).toBeVisible({ timeout: 30_000 });

  // El pipeline llega a Ready: `ExportButton` decide su propia visibilidad
  // por `stage === PipelineStage.Ready` (`ui/Components.md` §2.5) — esto
  // implica que Detecting (Regex + NER) y Grouping ya terminaron.
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 150_000 });

  // "editar modo de un grupo": el `Select` de reemplazo del grupo del DNI, de
  // "Placeholder" (default) a "Máscara".
  const replacementModeSelect = dniGroup.getByRole("combobox", { name: "Modo de reemplazo" });
  await expect(replacementModeSelect).toHaveText("Placeholder");
  await replacementModeSelect.click();
  await page.getByRole("option", { name: "Máscara" }).click();
  await expect(replacementModeSelect).toHaveText("Máscara");

  // "exportar": abre `ExportDialog` y confirma con los valores default del
  // form (nombre "anonimizado.pdf", JPEG 150 DPI) — válidos sin tocar nada
  // (`exportValidation.ts`). Con `enabledGroups > 0` (grupos habilitados por
  // default, `grouping.engine.ts`) no aparece el pre-flight de "sin grupos
  // habilitados".
  await exportButton.click();
  const exportDialog = page.getByRole("dialog", { name: "Exportar PDF anonimizado" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("button", { name: "Exportar" }).click();

  // "descargar": `ExportProgress` transiciona a "done" y muestra el ancla
  // `<a download>` (`ui/Components.md` §7.2, `ExportProgress.tsx`) —
  // Playwright captura el evento `download` nativo del navegador al
  // clickearla (funciona con `blob:` URLs en Chromium).
  // Export completo (render full-quality de 10 páginas + ensamblado del PDF)
  // en un Chromium headless sin aceleración gráfica de sistema (esta sesión
  // instaló el navegador sin `--with-deps`, ver Hito10_Observaciones_Revision.md
  // entrada "PR10") puede tardar bastante más que en un dev real — confirmado
  // empíricamente: con el bug #6 resuelto, la corrida real llega hasta
  // "Exportando página 10 de 10…" (progreso genuino, no cuelgue) y solo le
  // faltaba margen frente a los 180s previos.
  const downloadLink = exportDialog.getByRole("link", { name: "Descargar" });
  await expect(downloadLink).toBeVisible({ timeout: 300_000 });

  const [download] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
  expect(download.suggestedFilename()).toBe("anonimizado.pdf");
});
