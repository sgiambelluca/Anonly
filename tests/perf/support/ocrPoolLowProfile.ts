/**
 * Perfil Bajo tal como lo elige un usuario (ADR-194 §2): el setting `performancePreset: "low"`
 * manda `LEVEL_OVERRIDE.low` de `settingsToEngineConfig.ts`, que fija en 1 los pools de PDF, OCR,
 * NER y render y no envía `ocr.maxLiveImageBytes` (queda el default de 128 MiB). Este módulo es la
 * comprobación pura de esa configuración efectiva; la lectura del Core vive en el spec.
 *
 * La corrida de memoria del perfil Bajo (fase `low-memory`) es inválida si la configuración
 * efectiva no coincide: la comprobación no se relaja para que una corrida pase.
 */

import { DEFAULT_MAX_LIVE_IMAGE_BYTES } from "./ocrPoolArms.js";

export const LOW_PROFILE_POOL_KEYS = [
  "pdfPoolSize",
  "ocrPoolSize",
  "nerPoolSize",
  "renderPoolSize",
] as const;
export type LowProfilePoolKey = (typeof LOW_PROFILE_POOL_KEYS)[number];

/** Lo que se observa del Core vivo y de lo persistido por el arnés, antes de medir. */
export interface EffectiveProfileEvidence {
  /** `performancePreset` de `localStorage["anonly:settings"]`; `null` si no hay o no se pudo leer. */
  readonly performancePreset: string | null;
  /** `localStorage["anonly:engine-overrides"]` (ADR-155) tiene un valor: sería un override suelto. */
  readonly engineOverridesPresent: boolean;
  /** `ctx.config.workerPool.<pool>` del motor OCR; `null` si no es observable. */
  readonly workerPool: Readonly<Record<LowProfilePoolKey, number | null>>;
  /** `ctx.config.ocr.maxLiveImageBytes` del motor OCR; `null` si no es observable. */
  readonly maxLiveImageBytes: number | null;
}

/** Motivos por los que la configuración observada no es el perfil Bajo; vacío si lo es. */
export function lowProfileMismatches(
  evidence: EffectiveProfileEvidence | undefined,
): ReadonlyArray<string> {
  if (evidence === undefined) return ["sin evidencia de la configuración efectiva"];
  const mismatches: string[] = [];
  if (evidence.performancePreset !== "low")
    mismatches.push(
      `performancePreset persistido=${evidence.performancePreset ?? "no observable"}, esperado=low`,
    );
  if (evidence.engineOverridesPresent)
    mismatches.push(
      "hay overrides sueltos en anonly:engine-overrides: el perfil no es el del setting",
    );
  for (const key of LOW_PROFILE_POOL_KEYS) {
    const observed = evidence.workerPool[key];
    if (observed !== 1)
      mismatches.push(`${key} efectivo=${observed ?? "no observable"}, esperado=1`);
  }
  if (evidence.maxLiveImageBytes !== DEFAULT_MAX_LIVE_IMAGE_BYTES)
    mismatches.push(
      `ocr.maxLiveImageBytes efectivo=${evidence.maxLiveImageBytes ?? "no observable"}, esperado=${DEFAULT_MAX_LIVE_IMAGE_BYTES} (default, sin enviar)`,
    );
  return mismatches;
}
