/**
 * Punto de entrada del evaluador de recall/precisión (ADR-095).
 *
 * Es un **script**, no un test de vitest, y esa es la decisión de ADR-095 §6
 * llevada a su forma más simple: correr 20 PDFs por el pipeline entero es más
 * lento que el resto de la suite junta, así que no puede colgarse del bucle de
 * cada cambio. Lo que sí es un test —y corre con `pnpm test`— es
 * `matching.test.ts`, que ejercita la **regla** con datos sintéticos en
 * milisegundos. La regla es la métrica: es lo que hay que proteger de una
 * regresión, no el tiempo de rasterizado.
 *
 * **No falla por número bajo** (ADR-095 §6): reporta. Los umbrales del gate se
 * deciden con estos números a la vista, no antes. Sale con código distinto de
 * cero solo si el evaluador **no pudo correr** — un dataset ilegible o un
 * documento que revienta el pipeline son errores de verdad.
 *
 *   pnpm test:quality
 */
import { aggregateEvaluations, evaluateDocument, type DocumentEvaluation } from "./evaluate.js";
import { loadReferenceDataset } from "./load-reference-dataset.js";
import { formatReport } from "./print-report.js";
import { runDocument } from "./run-document.js";

async function main(): Promise<void> {
  const dataset = await loadReferenceDataset();
  const perDocument: DocumentEvaluation[] = [];

  for (const document of dataset) {
    const { detections, suggestions } = await runDocument(
      document.pdfBuffer,
      document.entry.documentId,
    );
    perDocument.push(evaluateDocument(document.truth, detections, suggestions.length));
  }

  // La salida del reporte ES la herramienta (no-console no rige en `tests/`).
  console.log(formatReport(aggregateEvaluations(perDocument)));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
