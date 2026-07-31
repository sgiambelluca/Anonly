/**
 * `reanalyzePlan.ts` — política de secuenciación de `actions.reanalyze` para
 * `SettingsDialog` cuando el usuario cambia `nerEnabled` y `ocrLanguages` en
 * el mismo guardado.
 *
 * Mitigación indicada por el planificador para este PR (Hito 10 PR6): el PR3
 * (`Orchestrator.reanalyze`, ADR-038) tiene una limitación conocida, confirmada
 * por el revisor — un único `reanalyze` con AMBOS campos (`ner` + `ocr`) en el
 * mismo patch no logra la equivalencia con una corrida fresca en dos sub-casos
 * (ocurrencias NER huérfanas en uno, NER incompleto en el otro; sin bug de
 * crash, pero resultado potencialmente inconsistente). En vez de un patch
 * combinado, `SettingsDialog` emite DOS llamadas secuenciales a
 * `actions.reanalyze`, esperando a que la primera resuelva antes de lanzar la
 * segunda. Orden: OCR primero, NER después — misma idea que ADR-038 §5.4
 * ("el orden es OCR → detección; la config NER final decide"), pero con dos
 * invocaciones separadas en vez de un solo patch combinado.
 */

import type { ReanalyzeConfigPatch } from "@anonly/anonymization-core";

export interface SettingsReanalyzeChange {
  readonly ner?: { readonly enabled: boolean };
  readonly ocr?: { readonly languages: ReadonlyArray<string> };
}

/**
 * Devuelve la secuencia ordenada de patches a enviar a `actions.reanalyze`,
 * uno por llamada (esperando cada una antes de lanzar la siguiente). Vacío si
 * no hay cambios relevantes.
 */
export function planReanalyzePatches(
  change: SettingsReanalyzeChange,
): ReadonlyArray<ReanalyzeConfigPatch> {
  const patches: ReanalyzeConfigPatch[] = [];
  if (change.ocr) patches.push({ ocr: change.ocr });
  if (change.ner) patches.push({ ner: change.ner });
  return patches;
}

function sameLanguages(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((lang) => setA.has(lang));
}

/**
 * Calcula qué campos de `ReanalyzeConfigPatch` cambiaron entre la config de
 * settings vigente y la del formulario, comparando `ocrLanguages` por
 * contenido (sin importar el orden).
 */
export function diffReanalyzeChange(
  previous: { readonly nerEnabled: boolean; readonly ocrLanguages: ReadonlyArray<string> },
  next: { readonly nerEnabled: boolean; readonly ocrLanguages: ReadonlyArray<string> },
): SettingsReanalyzeChange {
  const change: {
    ner?: { readonly enabled: boolean };
    ocr?: { readonly languages: ReadonlyArray<string> };
  } = {};
  if (previous.nerEnabled !== next.nerEnabled) {
    change.ner = { enabled: next.nerEnabled };
  }
  if (!sameLanguages(previous.ocrLanguages, next.ocrLanguages)) {
    change.ocr = { languages: next.ocrLanguages };
  }
  return change;
}
