import { createHash } from "node:crypto";

/**
 * Campaña «pico de memoria en el parseo» (`docs/roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md`,
 * candidato C-1). Transformación **solo de build**, aplicada por el arnés a una
 * copia en memoria del fuente: `packages/` no se modifica (ADR-218 §2, mismo
 * método).
 *
 * Brazo A: el producto tal cual. Brazo B: `parsePage` suelta los objetos de la
 * página (`PDFPageProxy.cleanup()`) en cuanto termina de pedir el operator
 * list. En pdf.js 4.10.38 las imágenes que decodifica `getOperatorList()`
 * quedan en `pageProxy.objs` y el `pageCache` del documento conserva cada
 * página hasta `destroy()`; después de `render()` pdf.js ya limpia solo las
 * imágenes grandes (`_maybeCleanupAfterRender`), pero después de
 * `getOperatorList()` no.
 */
export type ParseCleanupArm = "A" | "B";

export const PARSE_CLEANUP_ANCHOR =
  "    operatorList = (await pageProxy.getOperatorList()) as OperatorListLike;\n";
export const PARSE_CLEANUP_INSERTION =
  "    // experimento C-1 (solo build del arnés): suelta las imágenes decodificadas.\n" +
  "    pageProxy.cleanup();\n";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export interface ParseCleanupIdentity {
  readonly schema: 1;
  readonly arm: ParseCleanupArm;
  readonly matches: 1;
  readonly sourceSha256: string;
  readonly transformedSha256: string;
}

export function parseParseCleanupArm(value: string | undefined): ParseCleanupArm {
  if (value !== "A" && value !== "B") throw new Error("C-1: brazo desconocido");
  return value;
}

/** Exige una sola coincidencia exacta y que el fuente no traiga ya el cambio. */
export function transformParseCleanupSource(source: string, arm: ParseCleanupArm): string {
  if (source.split(PARSE_CLEANUP_ANCHOR).length !== 2)
    throw new Error("C-1: el ancla no aparece exactamente una vez en pdf.engine.ts");
  if (source.includes("pageProxy.cleanup()"))
    throw new Error("C-1: el fuente ya llama a pageProxy.cleanup()");
  if (arm === "A") return source;
  return source.replace(PARSE_CLEANUP_ANCHOR, PARSE_CLEANUP_ANCHOR + PARSE_CLEANUP_INSERTION);
}

export function createParseCleanupIdentity(
  source: string,
  arm: ParseCleanupArm,
): ParseCleanupIdentity {
  return {
    schema: 1,
    arm,
    matches: 1,
    sourceSha256: sha256(source),
    transformedSha256: sha256(transformParseCleanupSource(source, arm)),
  };
}
