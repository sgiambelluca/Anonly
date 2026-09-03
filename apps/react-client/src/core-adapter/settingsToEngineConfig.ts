/**
 * `settingsToEngineConfig.ts` — deriva el `EngineConfigOverrides` que el
 * bootstrap (`App.tsx`) pasa a `initCore` a partir de los settings
 * persistidos (`store/settings.store.ts`), antes de que haya ningún
 * documento abierto.
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.7 ("Mapeo settings →
 * EngineConfig"), tabla + párrafo "Bootstrap: los settings persistidos se
 * aplican al crear el core (PR16.5, ADR-048 §7 punto 2)".
 *
 * Mapeo (directo, sin condicionales, para `ner`/`ocr`): `nerEnabled` →
 * `ner.enabled`, `ocrLanguages` → `ocr.languages`. `performancePreset` →
 * `workerPool.*PoolSize`: `auto` **omite** la sección `workerPool` completa
 * del override devuelto — ni `{}` ni `workerPool: undefined` explícito
 * (`exactOptionalPropertyTypes` lo trataría distinto de "ausente") — para no
 * pisar los defaults derivados de `hardwareConcurrency`
 * (`05_Worker_Architecture.md` §1.1, que sigue calculándolos en
 * `buildDefaultEngineConfig`); `low`/`high` mandan los tamaños fijos de la
 * tabla.
 *
 * Función pura, sin efectos — mismo tipo de código que
 * `components/toolbar/reanalyzePlan.ts` (derivación de config a partir de
 * settings), pero para el caso "sin documento abierto" (bootstrap) en vez de
 * "con documento abierto" (`reanalyze`); ese caso sigue sin cambios por este
 * PR.
 *
 * `initCore` (`core-adapter/index.ts`) mergea por debajo la inyección de
 * `ner.wasmPaths` (ADR-039: `{ wasmPaths: {...}, ...config?.ner }`), así que
 * el override devuelto acá nunca la pisa: no incluye esa clave.
 */

import type { EngineConfigOverrides, WorkerPoolConfig } from "@anonly/anonymization-core";

import type { SettingsSlice } from "../store/settings.store.js";

export type BootstrapSettings = Pick<
  SettingsSlice,
  "performancePreset" | "nerEnabled" | "ocrLanguages"
>;

type WorkerPoolSizes = Pick<
  WorkerPoolConfig,
  "pdfPoolSize" | "ocrPoolSize" | "nerPoolSize" | "renderPoolSize"
>;

const LOW_POOL_SIZES: WorkerPoolSizes = {
  pdfPoolSize: 1,
  ocrPoolSize: 1,
  nerPoolSize: 1,
  renderPoolSize: 1,
};

const HIGH_POOL_SIZES: WorkerPoolSizes = {
  pdfPoolSize: 4,
  ocrPoolSize: 2,
  nerPoolSize: 2,
  renderPoolSize: 4,
};

type WorkerPoolOverride = { readonly workerPool: WorkerPoolSizes } | Record<string, never>;

/**
 * `auto` devuelve `{}` (sin la clave `workerPool`) a propósito: el override
 * tiene que **no existir**, no existir con valor `undefined`. Al nivel del
 * runtime las dos formas son equivalentes —`mergeEngineConfig` hace spread
 * (`{ ...base.workerPool, ...overrides.workerPool }`) y difundir `undefined`
 * es un no-op—, así que la razón no es evitar que se pisen los defaults: es
 * que el tipo diga la verdad. Bajo `exactOptionalPropertyTypes`, declarar
 * `workerPool: undefined` afirma un override que no existe, y obliga a todo
 * consumidor del tipo a contemplar un caso que nunca se produce.
 *
 * El `switch` sin `default` sobre un union de 3 valores hace que
 * `noImplicitReturns` (tsconfig.base.json) marque error si
 * `PerformancePreset` gana un cuarto valor sin actualizar acá.
 */
function workerPoolOverride(preset: SettingsSlice["performancePreset"]): WorkerPoolOverride {
  switch (preset) {
    case "low":
      return { workerPool: LOW_POOL_SIZES };
    case "high":
      return { workerPool: HIGH_POOL_SIZES };
    case "auto":
      return {};
  }
}

/**
 * Deriva el `EngineConfigOverrides` para `initCore` en el bootstrap
 * (`App.tsx`), según la tabla de `React_Client.md` §3.7.
 */
export function deriveEngineConfigOverrides(settings: BootstrapSettings): EngineConfigOverrides {
  return {
    ner: { enabled: settings.nerEnabled },
    ocr: { languages: settings.ocrLanguages },
    ...workerPoolOverride(settings.performancePreset),
  };
}

/**
 * ¿Dos settings producen el mismo `EngineConfigOverrides`?
 *
 * ADR-125 §2: guardar settings sin documento abierto recrea el core, y
 * recrearlo tira y rearma los cinco workers. `language` es UI pura y no entra
 * en el override: cambiar el idioma de la interfaz no puede costar eso. La
 * comparación va sobre el override **derivado** y no sobre los settings
 * crudos, que es lo que hace que la respuesta sea exactamente "¿cambia algo
 * que el Core vaya a leer?".
 *
 * Comparación explícita y no `JSON.stringify`: `workerPool` está presente o
 * ausente según el preset (ver `workerPoolOverride`), y dos objetos iguales
 * pueden serializar distinto según el orden en que se armaron.
 */
export function sameEngineConfigOverrides(
  a: EngineConfigOverrides,
  b: EngineConfigOverrides,
): boolean {
  if (a.ner?.enabled !== b.ner?.enabled) return false;

  const langsA = a.ocr?.languages ?? [];
  const langsB = b.ocr?.languages ?? [];
  if (langsA.length !== langsB.length) return false;
  if (langsA.some((lang, i) => lang !== langsB[i])) return false;

  const poolA = a.workerPool;
  const poolB = b.workerPool;
  if ((poolA === undefined) !== (poolB === undefined)) return false;
  if (poolA !== undefined && poolB !== undefined) {
    if (
      poolA.pdfPoolSize !== poolB.pdfPoolSize ||
      poolA.ocrPoolSize !== poolB.ocrPoolSize ||
      poolA.nerPoolSize !== poolB.nerPoolSize ||
      poolA.renderPoolSize !== poolB.renderPoolSize
    ) {
      return false;
    }
  }

  return true;
}
