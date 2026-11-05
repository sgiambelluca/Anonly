import { createHash } from "node:crypto";

/**
 * Campaña de reducción de pico (`docs/roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md`).
 * Transformación **solo de build**, aplicada por el arnés a una copia en
 * memoria del fuente: `packages/` no se modifica (ADR-218 §2, mismo método).
 *
 * El producto trae C-1 (ADR-225), C-2 (ADR-226) y C-4 en su opción 2 (ADR-227).
 * Cada brazo se arma **quitando** del fuente los cambios que no lleva:
 *
 * | brazo  | C-1 (`parsePage`) | C-2 (baja de NER antes del OCR) | C-4 (cleanup en OCR y export) |
 * |--------|-------------------|---------------------------------|-------------------------------|
 * | `base` | no                | no                              | no                            |
 * | `c1`   | sí                | no                              | no                            |
 * | `c2`   | no                | sí                              | no                            |
 * | `c4`   | no                | no                              | sí                            |
 * | `head` | sí                | sí                              | sí (el producto tal cual)     |
 *
 * Cada bloque se busca con una coincidencia exacta: si el fuente cambia, el
 * build se niega en vez de medir otra cosa. **Los nombres cambiaron de
 * significado** al implementar C-4: en la versión del arnés del commit
 * `8e8e2e4`, `c3`, `c4` y `c4r` **agregaban** candidatos sobre `head`
 * (`c4r` era C-4 restringido). Desde entonces `c4` es «solo C-4». Los
 * `transform-<brazo>.json` de cada campaña registran qué se midió.
 */
export type PeakArm = "base" | "c1" | "c2" | "c4" | "head";
export type PeakSourceFile = "pdf-engine" | "orchestrator" | "render-kernel";

export const PEAK_ARMS: ReadonlyArray<PeakArm> = ["base", "c1", "c2", "c4", "head"];

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

/** C-4, `render-engine/src/worker/kernel.ts`, en `kernelRenderPage` (solo `mode: "full"`). */
export const C4_RENDER_BLOCK =
  '    // ADR-227: solo en `mode: "full"` (export, una vez por página). El preview\n' +
  "    // conserva lo que dibujó para que un zoom o un cambio de vista no vuelva\n" +
  "    // a decodificar la imagen. Después de este punto la función no vuelve a\n" +
  "    // usar `pageProxy` (el viewport ya está calculado).\n" +
  '    if (mode === "full") pageProxy.cleanup();\n';

/** C-4, `render-engine/src/worker/kernel.ts`, en `kernelRasterizePage` (OCR). */
export const C4_RASTER_BLOCK =
  "    // ADR-227: pdf.js deja en `pageProxy.objs` las imágenes decodificadas para\n" +
  "    // dibujar, y `PDFDocumentProxy` retiene la página hasta `destroy()`. Se\n" +
  "    // sueltan apenas el dibujo terminó, antes de recortar o codificar. Si el\n" +
  "    // render falla o se cancela no se llega acá. No se vuelve a usar\n" +
  "    // `pageProxy` después (viewport y `cropRect` ya están calculados).\n" +
  "    pageProxy.cleanup();\n";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export function parsePeakArm(value: string | undefined): PeakArm {
  if ((PEAK_ARMS as ReadonlyArray<string>).includes(value ?? "")) return value as PeakArm;
  throw new Error("arnés de pico: brazo desconocido (base, c1, c2, c4 o head)");
}

/** Si el brazo conserva el cambio implementado de ese archivo. */
export function armKeeps(arm: PeakArm, file: PeakSourceFile): boolean {
  if (arm === "head") return true;
  if (file === "pdf-engine") return arm === "c1";
  if (file === "orchestrator") return arm === "c2";
  return arm === "c4";
}

function blocksFor(file: PeakSourceFile): ReadonlyArray<string> {
  if (file === "pdf-engine") return [C1_BLOCK];
  if (file === "orchestrator") return [C2_BLOCK];
  return [C4_RENDER_BLOCK, C4_RASTER_BLOCK];
}

/** Exige cada bloque exactamente una vez y los quita si el brazo no lleva ese cambio. */
export function transformPeakSource(source: string, file: PeakSourceFile, arm: PeakArm): string {
  let out = source;
  for (const block of blocksFor(file)) {
    if (out.split(block).length !== 2)
      throw new Error(`arnés de pico: un bloque de ${file} no aparece exactamente una vez`);
    if (!armKeeps(arm, file)) out = out.replace(block, "");
  }
  return out;
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
