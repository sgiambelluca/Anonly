import { GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./index.css";

/**
 * pdf-engine y render-engine (Core, sin bundler — Code_Standards.md §1) usan
 * `pdfjs-dist.getDocument()` pero nunca pueden configurar
 * `GlobalWorkerOptions.workerSrc`: ese import `?url` es sintaxis específica
 * de Vite. Solo la app (única capa con bundler) puede resolverlo, así que la
 * costura vive acá — antes de cualquier `getDocument()`, incluido el que
 * dispara `initCore()` al montar `App` (`core-adapter/index.ts`).
 *
 * Sin esto, `getDocument()` rechaza con `Error: No
 * "GlobalWorkerOptions.workerSrc" specified.` — reclasificado por
 * `pdf.engine.ts` (ADR-020 §4, catch-all de errores de documento) como
 * `PdfInvalidError`/`PDF_INVALID`, indistinguible en la UI de un PDF
 * realmente corrupto. Hallazgo del Escenario 1 E2E (Hito 10 PR10): ningún
 * test unit/contract/edge lo detectaba porque todos mockean la frontera de
 * `pdfjs-dist` (ADR-021 §5) — es la primera vez que `getDocument()` corre de
 * verdad, en un browser real.
 */
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Elemento #root no encontrado en index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
