/**
 * `settingsToEngineConfig.ts` — deriva el `EngineConfigOverrides` que el
 * bootstrap (`App.tsx`) pasa a `initCore` a partir de los settings
 * persistidos (`store/settings.store.ts`), antes de que haya ningún
 * documento abierto.
 *
 * Fuente de verdad: docs/ui/React_Client.md §3.7 y ADR-194 (§2 qué manda cada
 * nivel, §3 la regla de Automático).
 *
 * `nerEnabled` → `ner.enabled` y `ocrLanguages` → `ocr.languages` son directos.
 * `performancePreset` se deriva del **nivel**: `auto` se resuelve a uno de los
 * cuatro con las señales del equipo (`resolveAutoLevel`, función pura) y manda
 * el override de ese nivel. Lo que un nivel no nombra no se envía: queda en el
 * default del Core (`05_Worker_Architecture.md` §1.1). Las claves ausentes lo
 * son de verdad, no `undefined` (`exactOptionalPropertyTypes`).
 *
 * La lectura de `window.anonlyDevice` y de `navigator` vive en un solo punto,
 * `readDeviceSignals`; el resto es puro y no toca el DOM.
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

type WorkerPoolSizes = Partial<
  Pick<WorkerPoolConfig, "pdfPoolSize" | "ocrPoolSize" | "nerPoolSize" | "renderPoolSize">
>;

export type PerformanceLevel = "low" | "medium" | "high" | "ultra";

/** Las señales del equipo que usa la regla de Automático (ADR-194 §3). */
export interface DeviceSignals {
  readonly totalMemoryBytes?: number;
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
}

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

// Los umbrales son «8 GB» y «16 GB» con tolerancia: un equipo de 16 GB informa
// menos de 16 GiB (ADR-194 §3).
const LOW_MEMORY_GIB = 7;
const MEDIUM_MEMORY_GIB = 15;
// Mismo default que el Core cuando `hardwareConcurrency` no existe.
const DEFAULT_THREADS = 4;

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

/**
 * El nivel al que resuelve `auto` en este equipo (ADR-194 §3). Función pura
 * de las señales: no mira memoria libre, páginas ni documento.
 */
export function resolveAutoLevel(signals: DeviceSignals): PerformanceLevel {
  const threads = isPositiveFinite(signals.hardwareConcurrency)
    ? signals.hardwareConcurrency
    : DEFAULT_THREADS;

  if (!isPositiveFinite(signals.totalMemoryBytes)) {
    const smallMemory = signals.deviceMemory !== undefined && signals.deviceMemory < 4;
    return threads < 4 || smallMemory ? "low" : "medium";
  }

  const memoryGib = signals.totalMemoryBytes / GIB;
  if (threads < 4 || memoryGib < LOW_MEMORY_GIB) return "low";
  if (memoryGib < MEDIUM_MEMORY_GIB) return "medium";
  if (threads >= 12) return "ultra";
  if (threads >= 8) return "high";
  return "medium";
}

/** El nivel que se aplica: el elegido, o el que resuelve `auto`. */
export function resolvePerformanceLevel(
  preset: SettingsSlice["performancePreset"],
  signals: DeviceSignals,
): PerformanceLevel {
  return preset === "auto" ? resolveAutoLevel(signals) : preset;
}

/**
 * Lee las señales del equipo. Único lugar del cliente que sabe que
 * `window.anonlyDevice` existe (ADR-194 §4): fuera del shell, o con un valor
 * que no es un número finito y positivo, no hay dato de RAM.
 */
export function readDeviceSignals(): DeviceSignals {
  const device: unknown = typeof window === "undefined" ? undefined : window.anonlyDevice;
  const totalMemoryBytes =
    typeof device === "object" && device !== null
      ? (device as { readonly totalMemoryBytes?: unknown }).totalMemoryBytes
      : undefined;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const deviceMemory = (nav as { readonly deviceMemory?: unknown } | undefined)?.deviceMemory;
  return {
    ...(typeof totalMemoryBytes === "number" && isPositiveFinite(totalMemoryBytes)
      ? { totalMemoryBytes }
      : {}),
    ...(typeof nav?.hardwareConcurrency === "number"
      ? { hardwareConcurrency: nav.hardwareConcurrency }
      : {}),
    ...(typeof deviceMemory === "number" ? { deviceMemory } : {}),
  };
}

declare global {
  interface Window {
    readonly anonlyDevice?: unknown;
  }
}

interface LevelOverride {
  readonly workerPool: WorkerPoolSizes;
  readonly maxLiveImageBytes?: number;
}

const LEVEL_OVERRIDE: Readonly<Record<PerformanceLevel, LevelOverride>> = {
  low: { workerPool: { pdfPoolSize: 1, ocrPoolSize: 1, nerPoolSize: 1, renderPoolSize: 1 } },
  medium: { workerPool: { ocrPoolSize: 2, nerPoolSize: 2 } },
  high: { workerPool: { ocrPoolSize: 4, nerPoolSize: 2 }, maxLiveImageBytes: 136 * MIB },
  ultra: { workerPool: { ocrPoolSize: 6, nerPoolSize: 2 }, maxLiveImageBytes: 200 * MIB },
};

/**
 * Deriva el `EngineConfigOverrides` para `initCore` en el bootstrap
 * (`App.tsx`), según la tabla de ADR-194 §2. `signals` solo importa con
 * `auto`.
 */
export function deriveEngineConfigOverrides(
  settings: BootstrapSettings,
  signals: DeviceSignals = readDeviceSignals(),
): EngineConfigOverrides {
  const level = LEVEL_OVERRIDE[resolvePerformanceLevel(settings.performancePreset, signals)];
  return {
    ner: { enabled: settings.nerEnabled },
    ocr: {
      languages: settings.ocrLanguages,
      ...(level.maxLiveImageBytes !== undefined
        ? { maxLiveImageBytes: level.maxLiveImageBytes }
        : {}),
    },
    workerPool: level.workerPool,
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
 * Comparación explícita y no `JSON.stringify`: dos objetos iguales pueden
 * serializar distinto según el orden en que se armaron, y cada nivel manda un
 * subconjunto distinto de claves.
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

  if (a.ocr?.maxLiveImageBytes !== b.ocr?.maxLiveImageBytes) return false;

  const poolA = a.workerPool;
  const poolB = b.workerPool;
  if (
    poolA?.pdfPoolSize !== poolB?.pdfPoolSize ||
    poolA?.ocrPoolSize !== poolB?.ocrPoolSize ||
    poolA?.nerPoolSize !== poolB?.nerPoolSize ||
    poolA?.renderPoolSize !== poolB?.renderPoolSize
  ) {
    return false;
  }

  return true;
}

/**
 * La plataforma del contenedor (ADR-197 §6), de `window.anonlyDevice.platform`.
 * Sin dato —fuera del shell, o con un valor que no es uno de los tres— es
 * `"other"`: la interfaz avisa y espera, y no instala sola nunca. No se lee
 * `navigator.userAgent`.
 */
export type ShellPlatform = "windows" | "macos" | "other";

export function readShellPlatform(): ShellPlatform {
  const device: unknown = typeof window === "undefined" ? undefined : window.anonlyDevice;
  const platform =
    typeof device === "object" && device !== null
      ? (device as { readonly platform?: unknown }).platform
      : undefined;
  return platform === "windows" || platform === "macos" ? platform : "other";
}
