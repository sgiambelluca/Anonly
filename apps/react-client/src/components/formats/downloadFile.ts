/**
 * `downloadFile.ts` — baja un texto como cualquier descarga del navegador
 * (ADR-223 §5.4, ADR-227 §6): un `Blob`, un enlace temporal y un clic. No hace
 * falta código nuevo en el contenedor y el Core no toca el disco (R-10).
 *
 * Es la única parte de «Exportar formatos» que toca el DOM; el contenido del
 * archivo lo arma `formatsExport.ts`, que es puro y está probado.
 */

export function downloadTextFile(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Después del clic: la descarga ya tomó la URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
