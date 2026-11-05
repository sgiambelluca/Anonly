import { createHash } from "node:crypto";

/**
 * Campaña de reducción de pico (`docs/roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md`).
 * Transformación **solo de build**, aplicada por el arnés a una copia en
 * memoria del fuente: `packages/` no se modifica (ADR-218 §2, mismo método).
 *
 * Desde la implementación de ADR-225 (C-1) y ADR-226 (C-2), el producto trae
 * los dos cambios. Cada brazo se arma **quitando** del fuente los que no lleva:
 *
 * | brazo  | C-1 (cleanup en `parsePage`) | C-2 (baja de NER al empezar el OCR) |
 * |--------|------------------------------|-------------------------------------|
 * | `base` | no                           | no                                  |
 * | `c1`   | sí                           | no                                  |
 * | `c2`   | no                           | sí                                  |
 * | `head` | sí                           | sí  (el producto tal cual)          |
 *
 * Cada bloque se busca con una coincidencia exacta: si el fuente cambia, el
 * build se niega en vez de medir otra cosa.
 */
export type PeakArm = "base" | "c1" | "c2" | "head";
export type PeakSourceFile = "pdf-engine" | "orchestrator";

export const PEAK_ARMS: ReadonlyArray<PeakArm> = ["base", "c1", "c2", "head"];

/** C-1, `pdf-engine/src/pdf.engine.ts` (commit 9ead600). */
export const C1_BLOCK =
  "    // ADR-225: pdf.js decodifica las imágenes de la página para armar el\n" +
  "    // operator list y las deja en `pageProxy.objs`; `PDFDocumentProxy` retiene\n" +
  "    // cada página hasta `destroy()`. El recorrido de abajo solo lee operadores\n" +
  "    // y argumentos, así que se sueltan ya (`rotate` y el viewport siguen\n" +
  "    // disponibles). Si `getOperatorList()` falla, el documento se destruye en\n" +
  "    // el camino de fallo: no hace falta el cleanup.\n" +
  "    pageProxy.cleanup();\n";

/** C-2, `src/orchestrator.ts` (commit f5ac19a). */
export const C2_BLOCK =
  "      // ADR-226: en caliente, el modelo de NER del documento anterior sigue\n" +
  "      // residente (ADR-167: 15 s de inactividad) y el OCR de este documento\n" +
  "      // correría apilado sobre él. Se pide la baja UNA vez, antes de despachar\n" +
  "      // la primera página de OCR. `NerEngine.releaseIdleWorkers()` es `void` y\n" +
  "      // trae su guarda (no hace nada con un `processPage`/`processPages` en\n" +
  "      // curso); la recarga cae en la detección, con el pool de OCR ya dado de\n" +
  "      // baja (ADR-157). Un documento sin páginas OCR nunca entra acá.\n" +
  "      this.engines.ner.releaseIdleWorkers();\n" +
  "\n";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export function parsePeakArm(value: string | undefined): PeakArm {
  if (value === "base" || value === "c1" || value === "c2" || value === "head") return value;
  throw new Error("arnés de pico: brazo desconocido (base, c1, c2 o head)");
}

export function armKeeps(arm: PeakArm, file: PeakSourceFile): boolean {
  if (file === "pdf-engine") return arm === "c1" || arm === "head";
  return arm === "c2" || arm === "head";
}

function blockFor(file: PeakSourceFile): string {
  return file === "pdf-engine" ? C1_BLOCK : C2_BLOCK;
}

/** Exige que el bloque aparezca exactamente una vez y lo quita si el brazo no lo lleva. */
export function transformPeakSource(source: string, file: PeakSourceFile, arm: PeakArm): string {
  const block = blockFor(file);
  if (source.split(block).length !== 2)
    throw new Error(`arnés de pico: el bloque de ${file} no aparece exactamente una vez`);
  return armKeeps(arm, file) ? source : source.replace(block, "");
}

export interface PeakArmIdentity {
  readonly schema: 1;
  readonly arm: PeakArm;
  readonly file: PeakSourceFile;
  readonly kept: boolean;
  readonly sourceSha256: string;
  readonly transformedSha256: string;
}

export function createPeakArmIdentity(
  source: string,
  file: PeakSourceFile,
  arm: PeakArm,
): PeakArmIdentity {
  return {
    schema: 1,
    arm,
    file,
    kept: armKeeps(arm, file),
    sourceSha256: sha256(source),
    transformedSha256: sha256(transformPeakSource(source, file, arm)),
  };
}
