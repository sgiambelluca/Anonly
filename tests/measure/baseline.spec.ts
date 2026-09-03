/**
 * Harness de medición — la **línea de base** de
 * `roadmap/Optimizacion_De_Rendimiento.md`.
 *
 * **Por qué corre en un browser y no en Node.** Los dos números que hacen
 * falta son inseparables del entorno real:
 *
 * 1. *Calidad con NER encendido.* El kernel resuelve el modelo contra
 *    `env.localModelPath = "/models/ner/"`, una ruta de servidor — en Node no
 *    existe y por eso `tests/quality/` mide con NER apagado (ADR-095 §5).
 *    Acá el dev server la sirve desde `public/`, así que el modelo carga de
 *    verdad.
 * 2. *Tiempos representativos.* En Node, Transformers.js usa el backend
 *    nativo de onnxruntime; en el browser usa WASM. Medido: **82 ms contra
 *    1590 ms** para las mismas 256 palabras — 19×. Un número de Node no
 *    describiría el producto.
 *
 * Prerequisito: `pnpm assets:mirror` (igual que `tests/e2e/`, ver su README).
 *
 * **Esto no es un gate**: no afirma umbrales, mide y reporta. Se corre a mano
 * antes y después de un cambio para comparar.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";
import { classifyGroups } from "../quality/classify-groups.js";
import { aggregateEvaluations, evaluateDocument } from "../quality/evaluate.js";
import { loadReferenceDataset } from "../quality/load-reference-dataset.js";
import { formatReport } from "../quality/print-report.js";

import { TIMED_EVENTS, type BrowserCollector, type MeasuredDocument } from "./collect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../.measure");

/**
 * `MEASURE_SCAN=1` rasteriza cada documento antes de importarlo: el mismo
 * contenido, sin capa de texto, o sea que el pipeline tiene que llegar a las
 * entidades **vía OCR**.
 *
 * Es la única forma que hay hoy de medir la calidad del OCR. El dataset de
 * referencia no tiene documentos escaneados —y no los puede tener sin
 * commitear binarios que CI no sabe regenerar, porque rasterizar necesita un
 * canvas de browser— así que el escaneo se hace **en el momento**, dentro de
 * la misma página, con el helper que ya usa el escenario 2 de `tests/e2e/`.
 *
 * El ground truth es el del documento de texto: son el mismo documento. La
 * diferencia entre las dos corridas **es** la calidad del OCR.
 */
function scanMode(): boolean {
  return process.env.MEASURE_SCAN === "1";
}

/** Documentos a medir; `MEASURE_DOCS=doc-001,doc-016` acota la corrida. */
function selectedDocumentIds(): ReadonlyArray<string> | undefined {
  const raw = process.env.MEASURE_DOCS;
  if (raw === undefined || raw.trim().length === 0) return undefined;
  return raw.split(",").map((s) => s.trim());
}

test("línea de base sobre el dataset de referencia, con NER encendido", async ({ page }) => {
  const dataset = await loadReferenceDataset();
  const only = selectedDocumentIds();
  const documents = only ? dataset.filter((d) => only.includes(d.entry.documentId)) : dataset;
  expect(documents.length, "el dataset de referencia vino vacío").toBeGreaterThan(0);

  const results: MeasuredDocument[] = [];

  for (const doc of documents) {
    const measured = await measureOne(page, doc.entry.documentId, doc.pdfBuffer);
    results.push(measured);
    // Un documento que falla no aborta la corrida: se reporta y se sigue, que
    // es lo útil cuando se compara un antes y un después.
    if (!measured.ok)
      console.warn(`${doc.entry.documentId}: el pipeline terminó en PIPELINE_FAILED`);
  }

  // Calidad: se reusa el evaluador de ADR-095 tal cual, alimentado con lo
  // que capturó el browser en vez de con una corrida de Node. La regla de
  // matcheo queda en un solo lugar (`tests/quality/matching.ts`).
  //
  // Ojo con lo que este número significa HOY: `evaluateDocument` excluye del
  // recall las entidades `detector: "ner"` (ADR-095 §5), así que el recall
  // sigue siendo el de Regex aunque NER esté encendido. Lo que sí cambia es
  // la PRECISIÓN, que ahora incluye las detecciones de NER. Medir recall de
  // NER pide extender el evaluador — decisión abierta.
  const evaluations = documents.map((doc, i) => {
    const measured = results[i]!;
    const occurrencesById = new Map(measured.occurrences.map((o) => [o.id, o]));
    const { detections, suggestions } = classifyGroups(measured.groups, occurrencesById);
    return evaluateDocument(doc.truth, detections, suggestions.length);
  });
  console.log(
    `\n${scanMode() ? "*** MODO ESCANEO: el pipeline llegó a las entidades vía OCR ***\n" : ""}` +
      `${formatReport(aggregateEvaluations(evaluations), { nerActive: true })}`,
  );

  console.log("\nTiempos por documento (ms):");
  for (const r of results) {
    const ner = r.timings.find((t) => t.event === "NER_FINISHED");
    const modelReady = r.timings.find((t) => t.event === "NER_MODEL_READY");
    const parsed = r.timings.find((t) => t.event === "DOCUMENT_PARSED");
    const fmt = (v: number | undefined): string =>
      v === undefined ? "     —" : (v - r.startedAt).toFixed(0).padStart(6);
    console.log(
      `  ${r.documentId}  total=${(r.readyAt - r.startedAt).toFixed(0).padStart(6)}` +
        `  pdf=${fmt(parsed?.last)}  modelo=${fmt(modelReady?.last)}  ner=${fmt(ner?.last)}`,
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outFile = resolve(OUT_DIR, `${process.env.MEASURE_LABEL ?? "baseline"}.json`);
  await writeFile(
    outFile,
    JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2),
  );
  console.log(`\nMedición escrita en ${outFile}`);
});

async function measureOne(
  page: Page,
  documentId: string,
  pdfBuffer: ArrayBuffer,
): Promise<MeasuredDocument> {
  /*
   * Página nueva por documento. No es una preferencia de estilo: una vez
   * importado un documento la app muestra el visor y el `input[type=file]`
   * deja de existir, así que no hay dónde soltar el segundo.
   *
   * El costo es que cada documento vuelve a cargar el modelo de NER (~2 s).
   * Se reporta aparte —columna `modelo`— justamente para poder descontarlo:
   * lo que comparan A/B/C es el tiempo POR PÁGINA, no el arranque.
   */
  await page.goto("/", { waitUntil: "networkidle" });
  // El hook de dev de `core-adapter/index.ts`; sin él no hay bus que escuchar.
  await page.waitForFunction(() => "__anonlyCore" in globalThis, undefined, { timeout: 60_000 });

  /*
   * El rasterizado va ANTES de instalar el recolector: es preparación del
   * insumo, no parte del pipeline, y cronometrarlo ensuciaría los tiempos.
   */
  const file = scanMode()
    ? await rasterizeToScannedPdf(page, new Uint8Array(pdfBuffer))
    : {
        name: `${documentId}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from(pdfBuffer),
      };

  // Recolector nuevo por documento: se instala ANTES de soltar el archivo.
  await page.evaluate(
    ({ timed, id }: { timed: ReadonlyArray<readonly [string, string]>; id: string }) => {
      const core = globalThis.__anonlyCore;
      if (core === undefined) throw new Error("__anonlyCore ausente: ¿el dev server corre en dev?");

      const timings = new Map<string, { first: number; last: number; count: number }>();
      const occurrences = new Map<string, never>();
      const groups = new Map<string, never>();
      let ok = true;

      const mark = (event: string): void => {
        const now = performance.now();
        const prev = timings.get(event);
        timings.set(
          event,
          prev === undefined
            ? { first: now, last: now, count: 1 }
            : { first: prev.first, last: now, count: prev.count + 1 },
        );
      };

      for (const [channel, event] of timed) {
        core.bus.on(channel, event, () => {
          mark(event);
          if (event === "PIPELINE_FAILED") ok = false;
        });
      }

      const collectOccurrence = (payload: unknown): void => {
        const { occurrence } = payload as { occurrence: { id: string } };
        occurrences.set(occurrence.id, occurrence as never);
      };
      core.bus.on("regex", "ENTITY_FOUND", collectOccurrence);
      core.bus.on("ner", "ENTITY_FOUND", collectOccurrence);

      // Por id y con el ÚLTIMO estado, igual que `tests/quality/run-document.ts`:
      // un grupo gana `enabled`/`needsReview` por UPDATED (ADR-094 §3), así
      // que quedarse con el payload de creación contaría de menos.
      const collectGroup = (payload: unknown): void => {
        const { group } = payload as { group: { id: string } };
        groups.set(group.id, group as never);
      };
      core.bus.on("grouping", "ENTITY_GROUP_CREATED", collectGroup);
      core.bus.on("grouping", "ENTITY_GROUP_UPDATED", collectGroup);

      globalThis.__anonlyMeasure = {
        documentId: id,
        startedAt: performance.now(),
        timings,
        occurrences,
        groups,
        isOk: () => ok,
      };
    },
    { timed: TIMED_EVENTS, id: documentId },
  );

  await page.locator('input[type="file"]').setInputFiles(file);

  // `PIPELINE_READY` o `PIPELINE_FAILED`: los dos cierran la medición.
  await page.waitForFunction(
    () => {
      const m = globalThis.__anonlyMeasure;
      return (
        m !== undefined && (m.timings.has("PIPELINE_READY") || m.timings.has("PIPELINE_FAILED"))
      );
    },
    undefined,
    { timeout: 240_000 },
  );

  return page.evaluate((): MeasuredDocument => {
    const m = globalThis.__anonlyMeasure as BrowserCollector;
    const ready = m.timings.get("PIPELINE_READY") ?? m.timings.get("PIPELINE_FAILED");
    return {
      documentId: m.documentId,
      startedAt: m.startedAt,
      readyAt: ready?.last ?? m.startedAt,
      timings: [...m.timings.entries()].map(([event, t]) => ({ event, ...t })),
      occurrences: [...m.occurrences.values()],
      groups: [...m.groups.values()],
      ok: m.isOk(),
    };
  });
}
