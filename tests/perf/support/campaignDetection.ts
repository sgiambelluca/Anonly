/**
 * Mezcla, entre las carpetas de una tanda con continuaciones, la detección de suspensión y las
 * salvedades (§7). `available` es `true` solo si lo fue en TODAS las fuentes que aportan celdas o
 * corridas; una continuación sin detección deja la salvedad aunque la primera carpeta la tuviera.
 */

import type { UltraCaveat, UltraSleepDetection } from "./ocrPoolUltraSummary.js";

export interface SourceDetection {
  readonly name: string;
  /** La carpeta aporta celdas o corridas al resumen. */
  readonly contributes: boolean;
  readonly detection: UltraSleepDetection | undefined;
  readonly caveats: ReadonlyArray<UltraCaveat>;
}

export function mergeSleepDetection(
  sources: ReadonlyArray<SourceDetection>,
): UltraSleepDetection | undefined {
  const contributing = sources.filter((source) => source.contributes);
  if (contributing.length === 0) return undefined;
  const missing = contributing.filter(
    (source) => source.detection === undefined || source.detection.available === null,
  );
  const failed = contributing.filter((source) => source.detection?.available === false);
  if (failed.length > 0)
    return {
      available: false,
      note: failed
        .map((source) => `${source.name}: ${source.detection?.note ?? "no disponible"}`)
        .join("; "),
    };
  if (missing.length > 0)
    return {
      available: null,
      note: `sin detección de suspensión en: ${missing.map((source) => source.name).join(", ")}`,
    };
  return { available: true, note: null };
}

export function mergeCaveats(sources: ReadonlyArray<SourceDetection>): UltraCaveat[] {
  const seen = new Set<string>();
  const merged: UltraCaveat[] = [];
  for (const source of sources) {
    for (const caveat of source.caveats) {
      const key = `${caveat.id}|${caveat.note}|${sources.length > 1 ? source.name : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(
        sources.length > 1 ? { id: caveat.id, note: `${caveat.note} [${source.name}]` } : caveat,
      );
    }
  }
  return merged;
}
