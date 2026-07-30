/**
 * Escenario 4 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 4):
 * "Cargar PDF enorme → cancelar a mitad → verificar cese de CPU < 200 ms."
 *
 * Fixture (ADR-048 §2, `tests/fixtures/README.md` fila 4): `manyNeutralPagesFile`
 * (`support/fixtures.ts`) genera un PDF grande en memoria con texto neutro —
 * ya promovida y usada por `viewer-scroll-jump.spec.ts` como precedente. No
 * hace falta `huge-1000p.pdf` ni Git LFS (ADR-048 §2, fila 4 de la tabla).
 *
 * SLA del proyecto (`07_Performance_Strategy.md` §1: "Cancelación efectiva
 * < 200 ms desde input hasta cese de CPU"): el mecanismo es
 * `AbortController.abort()` (`abortRegistry.abort(documentId)`,
 * `packages/anonymization-core/src/orchestrator.ts`), síncrono por diseño —
 * no depende de I/O ni de un tick de cola de eventos. Medir milisegundos de
 * punta a punta *desde Playwright* mezclaría esa latencia real del Core con
 * el overhead de automatización del navegador (click → evento DOM → React →
 * store → re-render), que por sí solo puede superar 200 ms en un Chromium
 * headless sin relación alguna con el SLA del Core. Por eso este spec
 * verifica lo que SÍ es determinista y observable desde E2E — mismo criterio
 * que ADR-048 §3 aplicó al Escenario 7 (memoria): el **flujo** (cancelar
 * confirma y el stage pasa a "Cancelado" con margen generoso, no ajustado a
 * 200 ms) y, sobre todo, el **cese de actividad** (una vez cancelado, no
 * llega más `PIPELINE_PROGRESS` que delate CPU corriendo en segundo plano).
 * La medición fina de nanosegundos del propio `AbortController` es
 * responsabilidad de un test de Core (`tests/cancel/`, gate `pnpm test:cancel`,
 * Hito 11, `07_Performance_Strategy.md` §11.4) — no existe todavía en este PR.
 */

import { expect, test } from "@playwright/test";

import { manyNeutralPagesFile } from "./support/fixtures.js";

const PAGE_COUNT = 500;

test.setTimeout(120_000);

test("cargar PDF enorme, cancelar a mitad del procesamiento y verificar cese de actividad", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await manyNeutralPagesFile(PAGE_COUNT);
  await page.locator('input[type="file"]').setInputFiles(file);

  // "a mitad del procesamiento": `CancelButton` aparece apenas el stage sale
  // de Idle (`CancelButton.tsx`, `HIDDEN_STAGES = {Idle, Done, Failed,
  // Cancelled}`) — con 500 páginas (Regex + NER reales corriendo) hay
  // sobrado margen para cancelar bien antes de `Ready`.
  const cancelButton = page.getByRole("button", { name: "Cancelar" });
  await expect(cancelButton).toBeVisible({ timeout: 30_000 });

  const status = page.getByRole("status");
  await cancelButton.click();
  const confirmDialog = page.getByRole("dialog", { name: "Cancelar procesamiento" });
  await expect(confirmDialog).toBeVisible();

  const confirmClickedAt = Date.now();
  await confirmDialog.getByRole("button", { name: "Cancelar procesamiento" }).click();

  // El stage pasa a "Cancelado" (`pipelineStageLabel.ts`) con margen generoso
  // frente al SLA de 200 ms del Core (ver comentario de cabecera: el margen
  // absorbe overhead de Playwright/React, no mide el SLA en sí).
  await expect(status).toHaveText("Cancelado", { timeout: 5_000 });
  const cancelledAt = Date.now();
  expect(
    cancelledAt - confirmClickedAt,
    "tiempo hasta reflejar 'Cancelado' en la UI (incluye overhead de automatización, no es el SLA del Core)",
  ).toBeLessThan(5_000);

  // Cese de actividad: tras llegar a "Cancelado", ningún progreso tardío. Si
  // el pipeline siguiera trabajando en segundo plano, `PIPELINE_PROGRESS`
  // seguiría mutando el texto de `PipelineStatus` — se comprueba tomando dos
  // snapshots separados por una ventana muy por encima del SLA.
  const textAfterCancel = await status.textContent();
  await page.waitForTimeout(500);
  const textAfterWait = await status.textContent();
  expect(textAfterWait, "no debería haber actividad nueva tras cancelar").toBe(textAfterCancel);

  // `CancelButton` desaparece (`Cancelled ∈ HIDDEN_STAGES`): no queda ningún
  // job "en vuelo" ofreciendo cancelarse de nuevo.
  await expect(cancelButton).toHaveCount(0);
});
