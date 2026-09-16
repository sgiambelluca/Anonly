/** Rutas de assets first party compartidas por los kernels OCR y OSD. */
export const TESSERACT_LANG_PATH = "/models/tesseract/";
export const TESSERACT_CORE_PATH = "/wasm/tesseract/";
export const TESSERACT_WORKER_PATH = "/wasm/tesseract/worker.min.js";

export function resolveTesseractPath(path: string): string {
  if (typeof self === "undefined") return path;
  const origin = self.location?.origin;
  return origin === undefined ? path : new URL(path, origin).href;
}
