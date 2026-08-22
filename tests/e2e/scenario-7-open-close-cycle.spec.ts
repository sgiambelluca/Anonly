/**
 * Escenario 7 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 7):
 * "Abrir y cerrar 10 documentos consecutivos → verificar que la memoria
 * regresa al baseline." Reparto (ADR-048 §3, ratificado por ADR-051 §5): este
 * E2E ejercita el **flujo** (cada `DOCUMENT_CLOSED` deja el estado limpio —
 * sin documento activo, sin preview, sin blob URLs vivos — y el ciclo 10 se
 * comporta como el 1); la medición de bytes contra baseline queda para
 * `tests/leak/` (Hito 11, `performance.measureUserAgentSpecificMemory()`
 * exige `crossOriginIsolated`, headers que esta app no lleva).
 *
 * Des-fixme (ADR-051-Cerrar-Documento-Desde-El-Toolbar.md, PR 17.7): hasta
 * ese ADR no existía ningún control de UI para cerrar un documento que llegó
 * a `Ready` (solo el banner de `Failed` y el "Cancelar" de `PasswordDialog`),
 * así que este escenario no era ejercitable — ver el historial de git de este
 * archivo para el diagnóstico completo que dejó PR17. `CloseDocumentButton`
 * (`apps/react-client/src/components/toolbar/CloseDocumentButton.tsx`) lo
 * desbloquea.
 *
 * Fixture: `manyNeutralPagesFile(3)` (`support/fixtures.ts`, ya usado por
 * `scenario-11-zoom.spec.ts`) + `nerEnabled: false` (`installSettingsOverride`,
 * mismo mecanismo que `scenario-8-ner-disabled.spec.ts`/`scenario-9-*`): sin
 * entidades que detectar y sin modelo NER que cargar, el pipeline llega a
 * `Ready` en el orden de un segundo por ciclo — 3 páginas neutras alcanzan
 * para que `PdfViewer` monte al menos un `PageCanvas` con preview real
 * (`PREVIEW_UPDATED` → blob URL), que es lo que este escenario necesita
 * liberar en cada `DOCUMENT_CLOSED`. Diez ciclos con `text-10p.pdf` (Regex
 * real + más páginas) también cerrarían, pero serían más lentos sin agregar
 * nada a lo que este escenario verifica (limpieza de estado, no detección).
 *
 * "sin blob URLs vivos" se verifica con `support/blobUrlTracker.ts`: parchea
 * `URL.createObjectURL`/`revokeObjectURL` en la página (`page.addInitScript`,
 * antes de que cargue la app) y expone la cuenta de blob URLs vivas. Ver el
 * comentario de cabecera de ese archivo para por qué alcanza con instrumentar
 * la página (sin tocar `apps/react-client/src`): tanto la creación
 * (`RenderEngine.emitPreviewUpdated`, sección "Helpers de host") como la
 * revocación (`Orchestrator.closeDocument` → `BlobUrlTracker.revokeByPrefix`)
 * corren en el hilo principal, nunca dentro de un Worker.
 *
 * "sin documento activo" / "sin preview" se verifican por DOM: sin documento,
 * la app está en la **pantalla de carga** de ADR-087 §1 y muestra su botón
 * "Elegir archivo" (antes era el `ImportButton` de la toolbar, "Importar PDF",
 * que se retiró con el rediseño), y
 * `PdfViewer` (con sus `PageCanvas`, `role="img"`) solo se monta con
 * `document.store.id !== null` (`App.tsx#RightPanel`).
 *
 * "tras cerrar, la pantalla de carga permite importar otro PDF sin recargar la
 * pestaña" no es una aserción aparte: el propio loop lo ejercita 9 veces
 * (ciclos 2 a 10 reimportan después del cierre del ciclo anterior, sobre la
 * misma pestaña) — si `Orchestrator#validateImportInput` siguiera rechazando
 * con `InvalidInputError` por un `activeDocumentId` no limpiado, el `expect`
 * de preview del ciclo siguiente haría timeout.
 */

import { expect, test } from "@playwright/test";

import { installBlobUrlTracker, liveBlobUrlCount } from "./support/blobUrlTracker.js";
import { manyNeutralPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

const CYCLES = 10;

test.setTimeout(180_000);

test("Escenario 7: abrir y cerrar 10 documentos consecutivos, estado limpio por ciclo", async ({
  page,
}) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await installBlobUrlTracker(page);
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await manyNeutralPagesFile(3);

  const importButton = page.getByRole("button", { name: "Elegir archivo" });
  const closeButton = page.getByRole("button", { name: "Cerrar documento" });
  const confirmDialog = page.getByRole("dialog", { name: "Cerrar documento" });
  const originalPreview = page.getByRole("img", { name: "Página 1, original" });

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    await expect(
      importButton,
      `ciclo ${cycle}: "Elegir archivo" visible antes de importar (Idle, sin documento activo)`,
    ).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(file);

    // Documento abierto con preview real: `PdfViewer` monta en cuanto llega
    // `DOCUMENT_PARSED` (antes de `Ready`, `scenario-11-zoom.spec.ts`), pero
    // la aserción que importa es la blob URL viva — el canvas ya está en el
    // DOM con el skeleton gris incluso antes de que `PREVIEW_UPDATED` llegue.
    await expect(
      originalPreview,
      `ciclo ${cycle}: canvas de la página 1 (original) montado`,
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => liveBlobUrlCount(page), { timeout: 15_000 }).toBeGreaterThan(0);

    // Pipeline detenido (sin NER, Regex sin entidades en este fixture):
    // `CloseDocumentButton` decide su propia visibilidad por `stage`
    // (`closeDocumentButtonVisibility.ts`, ADR-051 §1).
    await expect(closeButton, `ciclo ${cycle}: CloseDocumentButton visible en Ready`).toBeVisible({
      timeout: 30_000,
    });

    // Cerrar pasa por `ConfirmDialog` (ADR-051 §2 — a diferencia del
    // "Cerrar documento" del banner de `Failed`, que no aplica acá porque
    // este ciclo nunca falla).
    await closeButton.click();
    await expect(confirmDialog, `ciclo ${cycle}: ConfirmDialog visible`).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Cerrar documento" }).click();

    // Estado limpio (ADR-051 §Validación): sin documento activo, sin
    // preview, sin blob URLs vivas — verificado antes de reintentar el
    // ciclo siguiente, para que el ciclo 10 se comporte igual que el 1.
    await expect(confirmDialog, `ciclo ${cycle}: ConfirmDialog cerrado`).toHaveCount(0);
    await expect(
      importButton,
      `ciclo ${cycle}: "Elegir archivo" reaparece (Idle de nuevo, sin recargar la pestaña)`,
    ).toBeVisible();
    await expect(originalPreview, `ciclo ${cycle}: preview desmontado`).toHaveCount(0);
    await expect(closeButton, `ciclo ${cycle}: CloseDocumentButton desmontado`).toHaveCount(0);
    // Margen generoso (mismo criterio que `scenario-1-*`/`scenario-9-*`):
    // la revocación corre dentro del `await this.engines.render.unloadDocument(...)`
    // del Orchestrator (roundtrip real por Worker, ADR-043), así que bajo
    // contención de CPU (suite completa con varios specs pesados en
    // paralelo, `fullyParallel: true`) puede tardar más que en una corrida
    // aislada — confirmado empíricamente: aislado (`--workers=1`) los 10
    // ciclos completos tardan ~4s; bajo la suite completa en paralelo, un
    // poll de 15 s alcanzó a expirar una vez antes de que la revocación
    // llegara. 30 s da el mismo margen que el resto de la suite usa para
    // absorber un Chromium headless sin aceleración gráfica de sistema.
    await expect
      .poll(() => liveBlobUrlCount(page), {
        timeout: 30_000,
        message: `ciclo ${cycle}: no deberían quedar blob URLs vivas tras DOCUMENT_CLOSED`,
      })
      .toBe(0);
  }
});
