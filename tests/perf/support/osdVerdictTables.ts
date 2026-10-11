/**
 * M-O1: el resumen de la campaña como texto plano para leer en la terminal y pegar en un informe. Puro.
 * Los números salen de `summarizeCampaign`; acá solo se alinean.
 */

import type {
  ComparatorCounts,
  Distribution,
  FiredCounts,
  LeakCase,
  OutcomeCounts,
  VerdictCounts,
} from "./osdVerdictAnalysis.js";
import type { CampaignSummary } from "./osdVerdictCampaign.js";

export function renderTable(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? "").length)),
  );
  const line = (row: ReadonlyArray<string>) =>
    row
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[0] ?? 0) : cell.padStart(widths[column] ?? 0),
      )
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
}

const sortKeys = (record: Readonly<Record<string, unknown>>): string[] =>
  Object.keys(record).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

const fixed = (value: number | null, digits = 1): string =>
  value === null ? "-" : value.toFixed(digits).replace(".", ",");

const fraction = (part: number, whole: number): string => `${part}/${whole}`;

function verdictRow(name: string, cell: VerdictCounts): string[] {
  return [
    name,
    String(cell.pdfs),
    String(cell.noVerdict),
    String(cell.withVerdict),
    String(cell.correct),
    String(cell.wrong),
  ];
}

function verdictRows(table: Readonly<Record<string, VerdictCounts>>): string[][] {
  return sortKeys(table).flatMap((key) => {
    const cell = table[key];
    return cell === undefined ? [] : [verdictRow(key, cell)];
  });
}

function outcomeRows(table: Readonly<Record<string, OutcomeCounts>>): string[][] {
  return sortKeys(table).flatMap((key) => {
    const cell = table[key];
    return cell === undefined ? [] : [outcomeRow(key, cell)];
  });
}

function outcomeRow(name: string, cell: OutcomeCounts): string[] {
  return [
    name,
    String(cell.observations),
    String(cell.recovered),
    String(cell.warned),
    String(cell.silentLeak),
    String(cell.silentLeakWithDniEntity),
  ];
}

const firedCell = (counts: FiredCounts): string => fraction(counts.fired, counts.readings);

function comparatorCell(counts: ComparatorCounts | undefined): string {
  return counts === undefined
    ? "-"
    : `${counts.correct} / ${counts.tiedWithCorrect} / ${counts.wrong} de ${counts.pdfs}`;
}

function distributionCell(value: Distribution): string {
  return value.n === 0
    ? "0"
    : `${value.n}: media ${fixed(value.meanSec)} mediana ${fixed(value.medianSec)} p90 ${fixed(value.p90Sec)} máx ${fixed(value.maxSec)} s`;
}

export function formatSummary(summary: CampaignSummary): string {
  const out: string[] = [];
  const section = (title: string) => out.push("", `## ${title}`, "");
  const { check, q1, q2 } = summary;

  section("Campaña");
  out.push(
    `PDF esperados ${check.expectedPdfs}; observaciones esperadas ${check.expectedObservations}, completas ${check.completedObservations}.`,
    `faltan ${check.missing.length}; inesperadas ${check.unexpected.length}; repetidas ${check.duplicated.length}; fallas del instrumento ${check.issues.length}; avisos ${check.warnings.length}.`,
    check.complete ? "COMPLETA" : "INCOMPLETA",
  );

  const outcomeHeader = [
    "",
    "observaciones",
    "recupera solo",
    "avisa",
    "fuga silenciosa",
    "fuga con DNI",
  ];
  const verdictHeader = ["", "PDF", "sin veredicto", "con veredicto", "correcto", "equivocado"];
  section("P1. Veredictos naturales equivocados (producción, PDF con texto)");
  out.push(renderTable(verdictHeader, [verdictRow("total", q1.total)]));
  for (const [title, table] of [
    ["por conjunto", q1.bySet],
    ["por geometría o densidad", q1.byLabel],
    ["por dpi", q1.byDpi],
    ["por giro físico", q1.byRotation],
  ] as const)
    out.push("", title, renderTable(verdictHeader, verdictRows(table)));
  out.push(
    "",
    q1.wrong.length === 0
      ? "Ningún veredicto equivocado."
      : `Veredictos equivocados:\n${q1.wrong.map((w) => `  ${w.key}: afirmó ${w.verdict}, correcto ${w.correctAngle}, crudo ${w.rawOrientation}/${w.rawConfidence}, ink ${w.inkRatio}`).join("\n")}`,
  );

  section("P1 bis. Producción sin forzar nada: qué entrega la cadena de hoy");
  const productionTables = [
    ["por veredicto natural", summary.production.byNaturalVerdict],
    ["por conjunto", summary.production.bySet],
    ["por geometría o densidad", summary.production.byLabel],
    ["por dpi", summary.production.byDpi],
    ["por giro físico", summary.production.byRotation],
  ] as const;
  out.push(renderTable(outcomeHeader, [outcomeRow("total", summary.production.total)]));
  for (const [title, table] of productionTables)
    out.push("", title, renderTable(outcomeHeader, outcomeRows(table)));

  section("P2. Veredicto forzado a un ángulo equivocado: qué entrega el producto");
  out.push(renderTable(outcomeHeader, [outcomeRow("total", q2.total)]));
  for (const [title, table] of [
    ["por conjunto", q2.bySet],
    ["por geometría o densidad", q2.byLabel],
    ["por dpi", q2.byDpi],
    ["por giro físico", q2.byRotation],
    ["por distancia del ángulo forzado al correcto", q2.byOffset],
  ] as const)
    out.push("", title, renderTable(outcomeHeader, outcomeRows(table)));
  out.push(
    "",
    `PDF con alguna fuga: ${fraction(q2.pdfsWithLeak.withLeak, q2.pdfsWithLeak.pdfs)}`,
    renderTable(
      ["", "PDF", "con fuga"],
      sortKeys(q2.pdfsWithLeak.byLabel).map((label) => [
        label,
        String(q2.pdfsWithLeak.byLabel[label]?.pdfs ?? 0),
        String(q2.pdfsWithLeak.byLabel[label]?.withLeak ?? 0),
      ]),
    ),
    "",
    "Control: veredicto forzado al ángulo correcto",
    renderTable(outcomeHeader, [outcomeRow("correcto", q2.forcedCorrect)]),
  );

  section("P3. Señales sobre la primera lectura");
  out.push(
    renderTable(
      [
        "señal",
        "equivocadas",
        "equiv. con palabra confiable",
        "fugas",
        "correctas (de más)",
        "denso",
        "escasa vieja",
        "escasa nueva",
      ],
      summary.q3.map((row) => [
        row.id,
        firedCell(row.wrongAngle),
        firedCell(row.wrongAngleAccepted),
        firedCell(row.silentLeaks),
        firedCell(row.correctAngle),
        firedCell(row.correctAngleBySubset.dense ?? { readings: 0, fired: 0 }),
        firedCell(row.correctAngleBySubset["old-sparse"] ?? { readings: 0, fired: 0 }),
        firedCell(row.correctAngleBySubset["new-sparse"] ?? { readings: 0, fired: 0 }),
      ]),
    ),
    "",
    "Cada celda es «dispara / primeras lecturas». Equivocadas: tres por PDF; correctas: una por PDF.",
  );

  section("P3 bis. Comparación de las cuatro primeras lecturas");
  out.push(
    renderTable(
      ["comparador", "total", "denso", "escasa vieja", "escasa nueva"],
      summary.q3bis.map((row) => [
        row.id,
        comparatorCell(row.total),
        comparatorCell(row.bySubset.dense),
        comparatorCell(row.bySubset["old-sparse"]),
        comparatorCell(row.bySubset["new-sparse"]),
      ]),
    ),
    "",
    "Cada celda es «gana el correcto solo / empata con el correcto / otro ángulo» de PDF.",
  );

  section("P4. Tiempo extra de tres lecturas más, por página que la señal dispara");
  out.push(
    "Con los tiempos de las primeras lecturas, medidos en frío (cota alta):",
    renderTable(
      [
        "señal",
        "en ángulo equivocado",
        "en ángulo correcto",
        "medio por página bien orientada (s)",
      ],
      summary.q4.map((row) => [
        row.id,
        distributionCell(row.onWrongAngle),
        distributionCell(row.onCorrectAngle),
        fixed(row.meanExtraPerCorrectPageSec, 2),
      ]),
    ),
    "",
    "Con tiempos en caliente (reconocimientos que no fueron el primero de su observación):",
    renderTable(
      [
        "señal",
        "en ángulo equivocado",
        "en ángulo correcto",
        "medio por página bien orientada (s)",
        "sin muestra",
      ],
      summary.q4.map((row) => [
        row.id,
        distributionCell(row.warm.onWrongAngle),
        distributionCell(row.warm.onCorrectAngle),
        fixed(row.warm.meanExtraPerCorrectPageSec, 2),
        String(row.warm.withoutSample),
      ]),
    ),
    "",
    "Tiempos de las primeras lecturas, en frío (cada una en su propia instancia de Electron):",
    `  todas: ${distributionCell(summary.readingTimes.firstReadings)}`,
    ...sortKeys(summary.readingTimes.firstReadingsByDpi).map(
      (dpi) =>
        `  ${dpi} dpi: ${distributionCell(summary.readingTimes.firstReadingsByDpi[dpi] ?? { n: 0, totalSec: 0, meanSec: null, medianSec: null, p90Sec: null, maxSec: null })}`,
    ),
    `  primer reconocimiento de cada observación: ${distributionCell(summary.readingTimes.firstAttempt)}`,
    `  reconocimientos siguientes de la misma observación: ${distributionCell(summary.readingTimes.laterAttempts)}`,
  );

  section("Controles sin texto");
  out.push(
    renderTable(
      ["", "observaciones", "unreadableInk", "palabra confiable final", "DNI"],
      summary.controls.map((row) => [
        row.label,
        String(row.observations),
        String(row.withUnreadableInk),
        String(row.withFinalReliableWords),
        String(row.withDniEntity),
      ]),
    ),
  );

  section("Evidencia de rama: PDF cuyo OSD natural no dio veredicto");
  out.push(
    summary.branchEvidence.length === 0
      ? "Ninguno."
      : summary.branchEvidence
          .map(
            (item) =>
              `${item.key}: producción [${item.productionAngles.join(",")}]; veredicto forzado a 0 [${item.forcedZeroAngles.join(",")}]`,
          )
          .join("\n"),
  );
  return `${out.join("\n")}\n`;
}

/** La lectura entera queda en el JSON de la observación; acá solo el comienzo. */
const LEAK_TEXT_CHARS = 70;
const shorten = (text: string): string =>
  JSON.stringify(text.length > LEAK_TEXT_CHARS ? `${text.slice(0, LEAK_TEXT_CHARS)}…` : text);

const LEAK_HEADER = [
  "PDF",
  "giro",
  "correcto",
  "forzado",
  "resultado",
  "DNI",
  "ángulos",
  "conf. página 1ª lectura",
  "pal. confiables 1ª lectura",
  "conf. página final",
  "pal. confiables final",
  "lectura final",
];

function leakRows(cases: ReadonlyArray<LeakCase>): string[][] {
  return cases.map((item) => [
    item.key,
    String(item.physicalRotation),
    String(item.correctAngle),
    item.forcedAngle === null ? "-" : String(item.forcedAngle),
    item.outcome,
    item.dniEntity === null ? "-" : item.dniEntity ? "sí" : "no",
    `[${item.attemptedAngles.join(",")}]`,
    fixed(item.firstReadingPageConfidence, 2),
    String(item.firstReadingReliableWords),
    fixed(item.finalPageConfidence, 2),
    String(item.finalReliableWords),
    shorten(item.finalText),
  ]);
}

/**
 * Una línea por observación que no recuperó los datos esperados, en tres bloques: con un veredicto
 * forzado a un ángulo equivocado (la pregunta 2), con el ángulo correcto (el control) y la producción
 * sin forzar nada.
 */
export function formatLeaks(summary: CampaignSummary): string {
  const blocks: ReadonlyArray<readonly [string, ReadonlyArray<LeakCase>]> = [
    ["Veredicto forzado a un ángulo equivocado", summary.q2.nonRecovered],
    ["Veredicto forzado al ángulo correcto (control)", summary.q2.forcedCorrectNotRecovered],
    ["Producción, sin forzar nada", summary.production.notRecovered],
  ];
  const render = ([title, cases]: readonly [string, ReadonlyArray<LeakCase>]): string =>
    cases.length === 0
      ? [`## ${title}`, "", "Ninguna observación sin los datos esperados.", ""].join("\n")
      : [`## ${title}`, "", renderTable(LEAK_HEADER, leakRows(cases)), ""].join("\n");
  return blocks.map(render).join("\n");
}

export function resultLine(summary: CampaignSummary): string {
  const { check, q1, q2 } = summary;
  return `M-O1: ${check.completedObservations}/${check.expectedObservations} observaciones; ${check.complete ? "completa" : "INCOMPLETA"}; veredictos naturales equivocados ${q1.wrong.length}/${q1.total.pdfs}; fugas silenciosas ${q2.total.silentLeak}/${q2.total.observations}.`;
}
