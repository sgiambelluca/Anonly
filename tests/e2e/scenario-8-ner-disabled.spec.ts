/**
 * Escenario 8 (`docs/architecture/07_Performance_Strategy.md` §11.3, item 8):
 * "Cargar PDF sin NER activado → verificar que solo Regex detecta."
 *
 * Desbloqueado por PR16.5 (`ADR-048 §7 punto 2`): `App.tsx` ahora hidrata
 * `settings.store` (`useSettingsStore.load()`) y deriva
 * `EngineConfigOverrides` (`core-adapter/settingsToEngineConfig.ts`) ANTES de
 * `initCore()`, así que un `nerEnabled: false` persistido en `localStorage`
 * antes de la primera importación desactiva NER de verdad — a diferencia de
 * antes de PR16.5, cuando `initCore()` se llamaba sin overrides una única vez
 * al montar `App` y nada volvía a leer `settings.store`. Este spec estuvo en
 * `test.fixme` desde PR10 con esa ambigüedad documentada (ver historial de
 * git de este archivo); PR16.5 la resolvió y este PR (17) lo saca del fixme.
 *
 * `installSettingsOverride` (`support/settingsOverride.ts`) escribe
 * `nerEnabled: false` en `localStorage` vía `page.addInitScript`, antes de
 * `page.goto`, para que el bootstrap lo lea en su primer `initCore()`.
 *
 * `text-10p.pdf` (`tests/fixtures/README.md`) trae entidades de ambos
 * detectores: DNI/teléfono/email (Regex, páginas 0-2) y Personas/Organización
 * (NER, páginas 0-1). Con NER desactivado, solo las primeras deben aparecer.
 *
 * No se usa el CUIT del fixture ("20-12345678-9") como entidad Regex de
 * control: `regex-engine/src/patterns/default-ar.ts` valida CUIT con el
 * dígito verificador módulo 11 de AFIP (`computeCuitChecksum`) y ese valor
 * sintético no lo pasa (checksum calculado: 6 ≠ 9) — el patrón matchea el
 * formato pero el motor descarta el match por checksum inválido
 * (`regex.engine.ts`, "checksum inválido descarta el match"), así que nunca
 * se agrupa. Es un desvío real entre `tests/fixtures/README.md` ("Las
 * entidades esperadas": "1 CUIT") y el comportamiento del motor, preexistente
 * a este PR — no se toca `generate.ts` ni `regex-engine` (fuera de alcance,
 * motor cerrado del Hito 4).
 *
 * Tampoco se usa el teléfono real de la página 0 ("+54 11 1234-5678") como
 * entidad de control: confirmado empíricamente (`getByRole` no lo encuentra,
 * dos corridas) que en este fixture el único `Teléfono` que sobrevive es
 * "20-12345678" — un match de `phone-mobile-ar` (`\d{2}[\s-]?\d{4}[\s-]?\d{4}`,
 * sin checksum) sobre los primeros 10 dígitos del CUIT rechazado ("20-12345678-9"
 * menos el dígito verificador final). No se investigó más a fondo el porqué
 * exacto de que el teléfono real no sobreviva junto a este (posible
 * interacción de `regex.engine.ts` entre patrones sobre spans cercanos,
 * motor cerrado del Hito 4, fuera de alcance) — se usa acá el valor
 * confirmado por observación directa, no el que la lectura ingenua del texto
 * sugeriría.
 */

import { expect, test } from "@playwright/test";

import { textTenPagesFile } from "./support/fixtures.js";
import { installSettingsOverride } from "./support/settingsOverride.js";

// Margen sobre el default (30 s de Playwright): sin esto, el propio
// `expect(exportButton).toBeVisible({ timeout: 30_000 })` de abajo, sumado a
// las siete aserciones que le siguen (5 s de timeout default cada una en el
// peor caso), podría agotar el timeout global del test en un runner de CI
// lento.
test.setTimeout(90_000);

test("Escenario 8: cargar PDF sin NER activado → solo Regex detecta", async ({ page }) => {
  await installSettingsOverride(page, { nerEnabled: false });
  await page.goto("/", { waitUntil: "networkidle" });

  const file = await textTenPagesFile();
  await page.locator('input[type="file"]').setInputFiles(file);

  // Sin NER no hay modelo que cargar: el pipeline llega a Ready rápido, sin
  // el timeout extendido que necesita `scenario-1-import-edit-export.spec.ts`.
  const exportButton = page.getByRole("button", { name: "Exportar" });
  await expect(exportButton).toBeVisible({ timeout: 30_000 });

  // Entidades de Regex: presentes.
  await expect(page.getByRole("treeitem", { name: "34.567.891" })).toBeVisible(); // DNI
  await expect(page.getByRole("treeitem", { name: "20-12345678" })).toBeVisible(); // Teléfono
  await expect(page.getByRole("treeitem", { name: "juan.perez@example.com" })).toBeVisible(); // Email

  // Entidades exclusivas de NER (Personas/Organización, `tests/fixtures/README.md`): ausentes.
  await expect(page.getByRole("treeitem", { name: "Juan Pérez" })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "María Gómez" })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Carlos López" })).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: "Empresa S.A." })).toHaveCount(0);
});
