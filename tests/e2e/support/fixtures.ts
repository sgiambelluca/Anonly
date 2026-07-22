/**
 * `support/fixtures.ts` — adjunta PDFs de fixture a un `<input type="file">`
 * de Playwright sin escribir archivos a disco.
 *
 * Reutiliza los generadores deterministas de `tests/fixtures/generate.ts`
 * (misma fuente que documenta `tests/fixtures/README.md` y que ya validan
 * `tests/fixtures/generate.test.ts`) en vez de duplicar los bytes acá o
 * commitear PDFs binarios nuevos: `Locator.setInputFiles()` de Playwright
 * acepta un `FilePayload` en memoria (`{ name, mimeType, buffer }`), así que
 * no hace falta que el archivo exista en `tests/fixtures/*.pdf` para este PR.
 */

import { generateCorrupt, generateText10p } from "../../fixtures/generate.js";

export interface E2eFilePayload {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

/** `text-10p.pdf` (`tests/fixtures/README.md`): 10 páginas, entidades conocidas. */
export async function textTenPagesFile(): Promise<E2eFilePayload> {
  const bytes = await generateText10p();
  return { name: "text-10p.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) };
}

/** `corrupt.pdf` (`tests/fixtures/README.md`): header %PDF- válido + cuerpo no-PDF. */
export async function corruptFile(): Promise<E2eFilePayload> {
  const bytes = await generateCorrupt();
  return { name: "corrupt.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) };
}
