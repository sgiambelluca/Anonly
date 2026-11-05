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
 * Y dos brazos que **agregan** un candidato sobre `head` (todavía sin
 * implementar, solo build del arnés):
 *
 * - `c3`: `head` + el pool de `pdf-parse` se da de baja al terminar el parseo
 *   (`this.pools.getPool("pdf").releaseIdleWorkers()` en el Orchestrator).
 * - `c4`: `head` + `pageProxy.cleanup()` después de cada `render()` en el
 *   kernel de Render (pdf.js solo programa, con 5 s de retardo, la limpieza de
 *   las páginas con imágenes de más de 10e6 bytes).
 * - `c4r`: `head` + el mismo cleanup, **solo** donde cada página se dibuja una vez
 *   por etapa: siempre en `kernelRasterizePage` (OCR) y en `kernelRenderPage`
 *   cuando `mode === "full"` (export). El preview no cambia (ADR-227, opción 2).
 *
 * Cada bloque se busca con una coincidencia exacta: si el fuente cambia, el
 * build se niega en vez de medir otra cosa.
 */
export type PeakArm = "base" | "c1" | "c2" | "head" | "c3" | "c4" | "c4r";
export type PeakSourceFile = "pdf-engine" | "orchestrator" | "render-kernel";

export const PEAK_ARMS: ReadonlyArray<PeakArm> = ["base", "c1", "c2", "head", "c3", "c4", "c4r"];

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

/** C-3: se inserta antes de esta ancla de `src/orchestrator.ts`, al volver el parseo. */
export const C3_ANCHOR =
  "    this.documents.set(documentId, pdfOutput.document);\n" +
  "    this.interactionRevisionsByDocument.set(\n";
export const C3_INSERTION =
  "    // experimento C-3 (solo build del arnés): el parseo ya terminó.\n" +
  '    this.pools.getPool("pdf").releaseIdleWorkers();\n';

/** C-4: se inserta al final del `try` de `renderPageOntoContext` (`render-engine/src/worker/kernel.ts`). */
export const C4_ANCHOR =
  "        viewport,\n" + "      }).promise,\n" + "      timeoutPromise,\n" + "    ]);\n";
export const C4_INSERTION =
  "    // experimento C-4 (solo build del arnés): suelta las imágenes de la página.\n" +
  "    pageProxy.cleanup();\n";

/** C-4 restringido: los dos llamados a `renderPageOntoContext`, distinguidos por lo que los precede. */
const RENDER_CALL =
  "  try {\n" +
  "    await renderPageOntoContext(\n" +
  "      pageProxy,\n" +
  "      context2d,\n" +
  "      viewport,\n" +
  "      documentId,\n" +
  "      pageIndex,\n" +
  "      opts.timeoutMs,\n" +
  "    );\n";
const CANVAS_LINES =
  "  const canvas = createCanvas(documentId, pageIndex, viewport.width, viewport.height, opts.onWarn);\n" +
  "  const context2d = get2dContext(canvas, documentId, pageIndex);\n" +
  "\n";
/** `kernelRenderPage` (preview y export). */
export const C4R_RENDER_ANCHOR =
  "  const viewport = pageProxy.getViewport({ scale });\n" + CANVAS_LINES + RENDER_CALL;
export const C4R_RENDER_INSERTION =
  "    // experimento C-4r (solo build del arnés): solo el export suelta la página.\n" +
  '    if (mode === "full") pageProxy.cleanup();\n';
/** `kernelRasterizePage` (OCR). */
export const C4R_RASTER_ANCHOR = "      : undefined;\n\n" + CANVAS_LINES + RENDER_CALL;
export const C4R_RASTER_INSERTION =
  "    // experimento C-4r (solo build del arnés): el OCR suelta la página.\n" +
  "    pageProxy.cleanup();\n";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export function parsePeakArm(value: string | undefined): PeakArm {
  if ((PEAK_ARMS as ReadonlyArray<string>).includes(value ?? "")) return value as PeakArm;
  throw new Error("arnés de pico: brazo desconocido (base, c1, c2, head, c3 o c4)");
}

/** Si el brazo conserva el cambio implementado de ese archivo (C-1 o C-2). `render-kernel` no tiene. */
export function armKeeps(arm: PeakArm, file: PeakSourceFile): boolean {
  const withHead = arm === "head" || arm === "c3" || arm === "c4" || arm === "c4r";
  if (file === "pdf-engine") return withHead || arm === "c1";
  if (file === "orchestrator") return withHead || arm === "c2";
  return true;
}

/** Si el brazo agrega a ese archivo el candidato todavía no implementado (C-3 o C-4). */
export function armAdds(arm: PeakArm, file: PeakSourceFile): boolean {
  return (
    (arm === "c3" && file === "orchestrator") ||
    ((arm === "c4" || arm === "c4r") && file === "render-kernel")
  );
}

function requireOnce(source: string, needle: string, what: string): void {
  if (source.split(needle).length !== 2)
    throw new Error(`arnés de pico: ${what} no aparece exactamente una vez`);
}

/**
 * Exige cada bloque y cada ancla exactamente una vez; quita el cambio
 * implementado si el brazo no lo lleva y agrega el candidato si lo lleva.
 */
export function transformPeakSource(source: string, file: PeakSourceFile, arm: PeakArm): string {
  let out = source;
  if (file === "pdf-engine") {
    requireOnce(out, C1_BLOCK, "el bloque de C-1");
    if (!armKeeps(arm, file)) out = out.replace(C1_BLOCK, "");
  }
  if (file === "orchestrator") {
    requireOnce(out, C2_BLOCK, "el bloque de C-2");
    requireOnce(out, C3_ANCHOR, "el ancla de C-3");
    if (out.includes('this.pools.getPool("pdf").releaseIdleWorkers()'))
      throw new Error("arnés de pico: el fuente ya da de baja el pool de pdf-parse");
    if (!armKeeps(arm, file)) out = out.replace(C2_BLOCK, "");
    if (armAdds(arm, file)) out = out.replace(C3_ANCHOR, C3_INSERTION + C3_ANCHOR);
  }
  if (file === "render-kernel") {
    requireOnce(out, C4_ANCHOR, "el ancla de C-4");
    requireOnce(out, C4R_RENDER_ANCHOR, "el ancla de C-4r en kernelRenderPage");
    requireOnce(out, C4R_RASTER_ANCHOR, "el ancla de C-4r en kernelRasterizePage");
    if (out.includes("pageProxy.cleanup()"))
      throw new Error("arnés de pico: el kernel de Render ya llama a pageProxy.cleanup()");
    if (arm === "c4") out = out.replace(C4_ANCHOR, C4_ANCHOR + C4_INSERTION);
    if (arm === "c4r") {
      out = out.replace(C4R_RENDER_ANCHOR, C4R_RENDER_ANCHOR + C4R_RENDER_INSERTION);
      out = out.replace(C4R_RASTER_ANCHOR, C4R_RASTER_ANCHOR + C4R_RASTER_INSERTION);
    }
  }
  return out;
}

export interface PeakArmIdentity {
  readonly schema: 1;
  readonly arm: PeakArm;
  readonly file: PeakSourceFile;
  readonly kept: boolean;
  readonly added: boolean;
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
    added: armAdds(arm, file),
    sourceSha256: sha256(source),
    transformedSha256: sha256(transformPeakSource(source, file, arm)),
  };
}
