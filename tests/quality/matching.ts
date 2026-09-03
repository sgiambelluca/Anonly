/**
 * La regla de matcheo (ADR-095 §1-§3). Funciones puras, sin I/O: reciben las
 * entidades esperadas y las detecciones ya extraídas del pipeline y deciden
 * qué cuenta como acierto. Es la parte de la suite verificable sin correr un
 * solo PDF — `matching.test.ts` la ejercita directo con datos sintéticos.
 */
import { normalizeForComparison } from "@anonly/shared";

import type { DetectedEntity, TruthEntity } from "./types.js";

function normalizedContains(haystack: string, needle: string): boolean {
  return normalizeForComparison(haystack).includes(normalizeForComparison(needle));
}

/**
 * Detecciones de la MISMA página cuyo valor normalizado contiene entero al
 * valor esperado normalizado (ADR-095 §1: contención, no igualdad, no
 * substring en cualquier dirección). Base de los dos recalls de §2.
 */
export function coveringDetections(
  truth: TruthEntity,
  detections: ReadonlyArray<DetectedEntity>,
): ReadonlyArray<DetectedEntity> {
  return detections.filter(
    (detection) =>
      detection.pageIndex === truth.pageIndex && normalizedContains(detection.value, truth.value),
  );
}

/** Recall de cobertura (§2, type-agnostic): ¿el dato quedó tapado, sin importar el tipo? */
export function isCovered(truth: TruthEntity, detections: ReadonlyArray<DetectedEntity>): boolean {
  return coveringDetections(truth, detections).length > 0;
}

/**
 * Recall tipado (§2): además de tapar el valor, ¿alguna de las detecciones
 * que lo cubren coincide también en `entityType`? Al filtrar sobre el mismo
 * conjunto que `isCovered`, todo tipado-cubierto es también cobertura-cubierto
 * por construcción — la invariante "cobertura ≥ tipado" no depende de que el
 * dataset la respete, la garantiza la forma de la función.
 */
export function isTypedCovered(
  truth: TruthEntity,
  detections: ReadonlyArray<DetectedEntity>,
): boolean {
  return coveringDetections(truth, detections).some(
    (detection) => detection.entityType === truth.entityType,
  );
}

/**
 * Falso positivo (§3): la detección no se solapa —ni entera ni
 * parcialmente, en cualquier dirección— con ninguna entidad esperada de su
 * página. Deliberadamente más indulgente que §1: un solapamiento parcial no
 * cuenta como acierto de recall, pero tampoco es una alucinación.
 */
export function isFalsePositive(
  detection: DetectedEntity,
  truths: ReadonlyArray<TruthEntity>,
): boolean {
  const detectedNorm = normalizeForComparison(detection.value);
  return !truths.some((truth) => {
    if (truth.pageIndex !== detection.pageIndex) return false;
    const truthNorm = normalizeForComparison(truth.value);
    return detectedNorm.includes(truthNorm) || truthNorm.includes(detectedNorm);
  });
}
