/**
 * M-O3: la campaña como un todo. Puro. Qué corridas se esperan (según los documentos presentes), si las que hay
 * son coherentes entre sí (el mismo archivo para todos los brazos de un documento: sin eso la comparación de lo
 * entregado no vale) y el texto plano de las tablas, con los reales primero.
 */

import {
  M3_ARM_DESCRIPTION,
  M3_DOC_DESCRIPTION,
  M2_NOISE_BYTES,
  m3Key,
  m3Plan,
  type M3Doc,
  type M3Run,
  type M3RunId,
} from "./osdVerdictM3.js";
import {
  summarizeRuns,
  type DeliveryResult,
  type M3Summary,
  type PairComparison,
  type Spread,
} from "./osdVerdictM3Analysis.js";
import { renderTable } from "./osdVerdictTables.js";

export function expectedRuns(docs: ReadonlyArray<M3Doc>): ReadonlyArray<M3RunId> {
  return m3Plan().filter((id) => docs.includes(id.doc));
}

export interface M3Check {
  readonly docs: ReadonlyArray<M3Doc>;
  readonly expectedRuns: number;
  readonly completedRuns: number;
  readonly complete: boolean;
  readonly missing: ReadonlyArray<string>;
  readonly unexpected: ReadonlyArray<string>;
  readonly duplicated: ReadonlyArray<string>;
  readonly issues: ReadonlyArray<{ readonly run: string; readonly issue: string }>;
  /** Corridas en las que una importación terminó en `PIPELINE_FAILED`: un resultado, se informa. */
  readonly failedRuns: ReadonlyArray<string>;
}

export function checkM3(runs: ReadonlyArray<M3Run>, docs: ReadonlyArray<M3Doc>): M3Check {
  const expected = expectedRuns(docs);
  const expectedKeys = new Set(expected.map(m3Key));
  const seen = new Map<string, number>();
  for (const run of runs) seen.set(m3Key(run), (seen.get(m3Key(run)) ?? 0) + 1);
  const missing = [...expectedKeys].filter((key) => !seen.has(key));
  const unexpected = [...seen.keys()].filter((key) => !expectedKeys.has(key));
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([key]) => key);
  const issues: Array<{ run: string; issue: string }> = [];
  for (const run of runs) for (const issue of run.issues) issues.push({ run: m3Key(run), issue });
  const byDoc = new Map<M3Doc, M3Run[]>();
  for (const run of runs) byDoc.set(run.doc, [...(byDoc.get(run.doc) ?? []), run]);
  for (const [doc, list] of byDoc) {
    const head = list[0];
    if (head === undefined) continue;
    for (const run of list.slice(1)) {
      if (run.fixtureSha256 !== head.fixtureSha256)
        issues.push({ run: m3Key(run), issue: `${doc}: el archivo difiere del de ${m3Key(head)}` });
      if (run.pageCount !== head.pageCount)
        issues.push({
          run: m3Key(run),
          issue: `${doc}: otra cantidad de páginas que ${m3Key(head)}`,
        });
    }
  }
  return {
    docs,
    expectedRuns: expected.length,
    completedRuns: runs.length,
    complete:
      missing.length === 0 &&
      unexpected.length === 0 &&
      duplicated.length === 0 &&
      issues.length === 0,
    missing,
    unexpected,
    duplicated,
    issues,
    failedRuns: runs.filter((run) => !run.cold.ok || !run.hot.ok).map(m3Key),
  };
}

// ------------------------------------------------------------------ tablas

const MB = 1_000_000;
const mb = (bytes: number | null): string =>
  bytes === null ? "-" : (bytes / MB).toFixed(1).replace(".", ",");
const signedMb = (bytes: number | null): string =>
  bytes === null ? "-" : `${bytes >= 0 ? "+" : "−"}${mb(Math.abs(bytes))}`;
const seconds = (ms: number | null): string =>
  ms === null ? "-" : (ms / 1000).toFixed(1).replace(".", ",");
const factor = (value: number | null): string =>
  value === null ? "-" : value.toFixed(2).replace(".", ",");
const spreadCell = (spread: Spread): string =>
  spread.median === null ? "-" : `${mb(spread.median)} (${mb(spread.min)}–${mb(spread.max)})`;

const DOC_ORDER: ReadonlyArray<M3Doc> = ["R1", "R4", "P2", "P2N"];

function pairLine(pair: PairComparison): string {
  const c = pair.counts;
  const d = pair.direction;
  return `cambian ${c.any}/${pair.pages} (hash ${c.textHash}, palabras ${c.words} [+${d.moreWords}/−${d.fewerWords}], ángulo ${c.angle}, entidades ${c.entities} [+${d.moreEntities}/−${d.fewerEntities}], aviso ${c.warning} [+${d.warningGained}/−${d.warningLost}])`;
}

function deliveryBlock(result: DeliveryResult): string[] {
  const lines = [
    `${result.doc}, A contra ${result.versus} (${result.temperature === "cold" ? "frío" : "caliente"}):`,
    ...result.pairs.map((pair, index) => `  rep ${index + 1}: ${pairLine(pair)}`),
    ...result.floor.map((pair, index) => `  piso A–A, par ${index + 1}: ${pairLine(pair)}`),
    result.beyondFloor.length === 0
      ? "  páginas que cambian en todos los pares y en ningún par del piso: ninguna"
      : `  páginas que cambian en todos los pares y en ningún par del piso (${result.beyondFloor.length}): ${result.beyondFloor.map((c) => `${c.page}[${c.wordsDelta >= 0 ? "+" : ""}${c.wordsDelta} pal., ${c.entitiesDelta >= 0 ? "+" : ""}${c.entitiesDelta} ent.${c.angle ? ", ángulo" : ""}${c.warning ? ", aviso" : ""}]`).join(" ")}`,
  ];
  return lines;
}

export function formatM3(summary: M3Summary, check: M3Check): string {
  const out: string[] = [];
  const section = (title: string) => out.push("", `## ${title}`, "");
  const docs = DOC_ORDER.filter((doc) => summary.memory.cells.some((cell) => cell.doc === doc));

  section("Campaña M-O3");
  out.push(
    `Corridas esperadas ${check.expectedRuns}, completas ${check.completedRuns}; documentos: ${check.docs.join(", ") || "ninguno"}.`,
    `faltan ${check.missing.length}; inesperadas ${check.unexpected.length}; repetidas ${check.duplicated.length}; fallas del instrumento ${check.issues.length}; corridas con una importación fallida ${check.failedRuns.length}${check.failedRuns.length > 0 ? ` (${check.failedRuns.join(", ")})` : ""}.`,
    check.complete ? "COMPLETA" : "INCOMPLETA",
    ...docs.map((doc) => `${doc}: ${M3_DOC_DESCRIPTION[doc]}`),
    ...(["A", "A0", "B", "C"] as const).map((arm) => `${arm}: ${M3_ARM_DESCRIPTION[arm]}`),
  );

  section("1. Memoria: pico M2 en MB decimales, mediana (mín–máx de las repeticiones)");
  out.push(
    renderTable(
      ["documento", "brazo", "corridas", "frío", "caliente", "fallidas"],
      docs.flatMap((doc) =>
        summary.memory.cells
          .filter((cell) => cell.doc === doc)
          .map((cell) => [
            doc,
            cell.arm,
            String(cell.runs),
            spreadCell(cell.cold),
            spreadCell(cell.hot),
            String(cell.failedRuns),
          ]),
      ),
    ),
    "",
    `Diferencias contra el ruido de M2 entre corridas iguales (~${mb(M2_NOISE_BYTES)} MB):`,
    renderTable(
      [
        "documento",
        "diferencia",
        "temperatura",
        "Δ medianas",
        "Δ máximos",
        "rangos disjuntos",
        "veredicto",
      ],
      docs.flatMap((doc) =>
        summary.memory.diffs
          .filter((diff) => diff.doc === doc)
          .map((diff) => [
            doc,
            `${diff.arm} − ${diff.versus}`,
            diff.temperature === "cold" ? "frío" : "caliente",
            signedMb(diff.medianDiffBytes),
            signedMb(diff.maxDiffBytes),
            diff.rangesDisjoint === null ? "-" : diff.rangesDisjoint ? "sí" : "no",
            diff.verdict ?? "-",
          ]),
      ),
    ),
    "",
    "P2 contra el techo de 3,0 GB (ADR-192 §2):",
    renderTable(
      ["documento", "brazo", "temperatura", "máximo", "techo", "margen", "supera"],
      summary.memory.ceiling.map((row) => [
        row.doc,
        row.arm,
        row.temperature === "cold" ? "frío" : "caliente",
        mb(row.maxBytes),
        mb(row.ceilingBytes),
        signedMb(row.marginBytes),
        row.exceeds === null ? "-" : row.exceeds ? "SÍ" : "no",
      ]),
    ),
  );

  section("2. Tiempo hasta Ready, en segundos: mediana (mín–máx)");
  out.push(
    renderTable(
      [
        "documento",
        "brazo",
        "páginas",
        "frío",
        "caliente",
        "s/pág. frío",
        "s/pág. caliente",
        "× A frío",
        "× A caliente",
        "reconoc. frío",
      ],
      summary.time.map((row) => [
        row.doc,
        row.arm,
        String(row.pages),
        row.cold.median === null
          ? "-"
          : `${seconds(row.cold.median)} (${seconds(row.cold.min)}–${seconds(row.cold.max)})`,
        row.hot.median === null
          ? "-"
          : `${seconds(row.hot.median)} (${seconds(row.hot.min)}–${seconds(row.hot.max)})`,
        factor(row.coldSecondsPerPage),
        factor(row.hotSecondsPerPage),
        factor(row.coldFactorVsA),
        factor(row.hotFactorVsA),
        row.recognitionsPerRunCold === null ? "-" : String(row.recognitionsPerRunCold),
      ]),
    ),
  );

  section("3. Reconocimientos por página (corrida en frío)");
  out.push(
    renderTable(
      [
        "documento",
        "brazo",
        "páginas",
        "con las 4 lecturas",
        "reconocimientos por página (cantidad: páginas)",
      ],
      summary.recognitions.map((row) => [
        row.doc,
        row.arm,
        String(row.pagesPerRun),
        row.pagesWithFour === null ? "-" : String(row.pagesWithFour),
        Object.entries(row.histogram)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([count, pages]) => `${count}: ${pages}`)
          .join("; "),
      ]),
    ),
    ...summary.recognitions
      .filter((row) => row.withoutFour.length > 0 && (row.arm === "B" || row.arm === "C"))
      .map(
        (row) =>
          `${row.doc} ${row.arm}, páginas sin las cuatro lecturas: ${row.withoutFour.map((w) => `${w.page} (${w.reason})`).join(", ")}`,
      ),
  );

  section("4. Lo que se entrega: de A a B y de A a C, contra el piso entre repeticiones de A");
  for (const result of summary.deliveries) out.push(...deliveryBlock(result), "");
  out.push("En caliente:");
  for (const result of summary.deliveriesHot) out.push(...deliveryBlock(result), "");
  return `${out.join("\n")}\n`;
}

export function summarizeM3(runs: ReadonlyArray<M3Run>, docs: ReadonlyArray<M3Doc>) {
  const check = checkM3(runs, docs);
  const summary = summarizeRuns(runs);
  return { check, summary, text: formatM3(summary, check) };
}

export function m3ResultLine(check: M3Check): string {
  return `M-O3: ${check.completedRuns}/${check.expectedRuns} corridas; ${check.complete ? "completa" : "INCOMPLETA"}; fallidas ${check.failedRuns.length}.`;
}
