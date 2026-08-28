/**
 * Harness **ciego** para documentos reales.
 *
 * `MEASURE_FILES=/ruta/a.pdf,/ruta/b.pdf pnpm test:measure real-docs`
 *
 * **Nunca imprime contenido.** Ni texto, ni valores de entidad, ni
 * fragmentos: solo conteos, porcentajes y tiempos. Existe para poder medir
 * sobre expedientes reales —los únicos que responden las preguntas que el
 * dataset sintético no puede— sin que el documento salga de la máquina ni
 * quede en el repo.
 *
 * Los errores se reportan por **clase**, nunca por mensaje: las librerías de
 * PDF a veces incluyen texto del documento en la excepción.
 *
 * Sin `MEASURE_FILES` el test se saltea, así que vive en la suite sin pedir
 * nada.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { rasterizeToScannedPdf } from "../e2e/support/scannedPdf.js";
import {
  checkFragments,
  checkIndexInType,
  checkNoOverlapBetweenEnabledGroups,
} from "../invariants/checks.js";

import { TIMED_EVENTS, type BrowserCollector, type MeasuredDocument } from "./collect.js";

function requestedFiles(): ReadonlyArray<string> {
  const raw = process.env.MEASURE_FILES;
  if (raw === undefined || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

test("documentos reales — solo agregados, nunca contenido", async ({ page }) => {
  const files = requestedFiles();
  test.skip(files.length === 0, "sin MEASURE_FILES: nada que medir");

  for (const file of files) {
    const buffer = (await readFile(file)).buffer as ArrayBuffer;
    const measured = await measureFile(page, file, buffer);
    report(basename(file), measured);
    reportInvariants(measured);
  }
  expect(files.length).toBeGreaterThan(0);
});

/** Conteo de entidades POR TIPO. Los valores nunca salen de esta función. */
function countByType(measured: MeasuredDocument): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const grouped = new Set<string>();
  for (const group of measured.groups) {
    if (!group.enabled) continue;
    for (const member of group.members) grouped.add(member.occurrenceId);
  }
  for (const occurrence of measured.occurrences) {
    if (!grouped.has(occurrence.id)) continue;
    counts.set(occurrence.entityType, (counts.get(occurrence.entityType) ?? 0) + 1);
  }
  return counts;
}

function report(name: string, m: MeasuredDocument): void {
  const at = (event: string): number | undefined => m.timings.find((t) => t.event === event)?.last;
  const rel = (v: number | undefined): string =>
    v === undefined ? "—" : `${(v - m.startedAt).toFixed(0)} ms`;
  const span = (a: string, b: string): string => {
    const x = at(a);
    const y = at(b);
    return x === undefined || y === undefined ? "—" : `${(y - x).toFixed(0)} ms`;
  };
  const ocrPages = m.timings.find((t) => t.event === "OCR_PAGE_FINISHED")?.count ?? 0;

  console.log(`\n${name}   ${m.ok ? "" : "(PIPELINE_FAILED)"}`);
  console.log(`  total hasta READY ....... ${rel(m.readyAt)}`);
  console.log(`  parseo de PDF ........... ${rel(at("DOCUMENT_PARSED"))}`);
  console.log(
    `  OCR ..................... ${span("OCR_STARTED", "OCR_FINISHED")}  (${ocrPages} páginas)`,
  );
  console.log(`  carga del modelo NER .... ${rel(at("NER_MODEL_READY"))}`);
  console.log(`  inferencia NER .......... ${span("NER_MODEL_READY", "NER_FINISHED")}`);
  console.log(
    `  entidades agrupadas ..... ${[...countByType(m)].map(([t, n]) => `${t}:${n}`).join("  ") || "(ninguna)"}`,
  );
}

async function measureFile(
  page: Page,
  documentId: string,
  pdfBuffer: ArrayBuffer,
): Promise<MeasuredDocument> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => "__anonlyCore" in globalThis, undefined, { timeout: 60_000 });

  const file =
    process.env.MEASURE_SCAN === "1"
      ? await rasterizeToScannedPdf(page, new Uint8Array(pdfBuffer))
      : {
          name: "documento.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(pdfBuffer),
        };

  await page.evaluate(
    ({ timed, id }: { timed: ReadonlyArray<readonly [string, string]>; id: string }) => {
      const core = globalThis.__anonlyCore;
      if (core === undefined) throw new Error("__anonlyCore ausente");
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

  await page.waitForFunction(
    () => {
      const m = globalThis.__anonlyMeasure;
      return (
        m !== undefined && (m.timings.has("PIPELINE_READY") || m.timings.has("PIPELINE_FAILED"))
      );
    },
    undefined,
    { timeout: 900_000 },
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

/**
 * Los invariantes que **no necesitan las páginas**, sobre un documento real.
 *
 * Es el punto entero de tener invariantes: no piden ground truth, así que
 * corren sobre un expediente de verdad sin que nadie lea su contenido. Las
 * violaciones se reportan por tipo, página y medida — nunca por texto.
 *
 * `checkValueStartsAtWord` queda afuera **a propósito y no por olvido**:
 * necesita las `Page`, y los eventos del bus no las llevan (`PAGE_PARSED` trae
 * `wordCount`, no las `Word`). Ese corre en Node, sobre el dataset
 * (`tests/invariants/dataset.test.ts`).
 */
function reportInvariants(m: MeasuredDocument): void {
  const snapshot = { pages: [], occurrences: [], groups: m.groups };
  const violations = [
    // `checkFragments` mira ocurrencias; acá se le pasan las de los grupos,
    // que es lo que el bus entrega con `fragments` ya propagados.
    ...checkFragments({
      ...snapshot,
      occurrences: m.occurrences,
    }),
    ...checkIndexInType(snapshot),
    ...checkNoOverlapBetweenEnabledGroups(snapshot),
  ];

  if (violations.length === 0) {
    console.log("  invariantes ............. sin violaciones");
    return;
  }
  console.log(`  invariantes ............. ${violations.length} VIOLACIONES`);
  for (const v of violations.slice(0, 10)) {
    console.log(`    ${v.invariant}`);
    console.log(`      ${v.where} — ${v.detail}`);
  }
}
