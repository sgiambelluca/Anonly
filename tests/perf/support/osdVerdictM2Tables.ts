/**
 * M-O2: el resumen como texto plano para leer en la terminal y pegar en un informe. Puro. Los números salen de
 * `summarizeM2`; acá solo se alinean. Toda tabla que sale de `osdVerdictSim.ts` lo dice en su título:
 * **SIMULACIÓN sobre lecturas medidas, no el producto**. Las de las páginas reales llevan solo agregados.
 */

import type { Distribution } from "./osdVerdictAnalysis.js";
import {
  SCENARIOS,
  SV_THRESHOLDS,
  type CpCell,
  type Spread,
  type SvCell,
  type Triple,
} from "./osdVerdictM2Analysis.js";
import type { M2Summary } from "./osdVerdictM2Campaign.js";
import { renderTable } from "./osdVerdictTables.js";

const SIM = "SIMULACIÓN sobre lecturas medidas, no el producto";

const fixed = (value: number | null, digits = 2): string =>
  value === null ? "-" : value.toFixed(digits).replace(".", ",");

function distributionCell(value: Distribution): string {
  return value.n === 0
    ? "0"
    : `${value.n}: media ${fixed(value.meanSec, 1)} mediana ${fixed(value.medianSec, 1)} p90 ${fixed(value.p90Sec, 1)} máx ${fixed(value.maxSec, 1)} s`;
}

export function spreadCell(value: Spread): string {
  return value.n === 0
    ? "-"
    : `n=${value.n} mín ${fixed(value.min)} p10 ${fixed(value.p10)} mediana ${fixed(value.median)} p90 ${fixed(value.p90)} máx ${fixed(value.max)}`;
}

const tripleCell = (cell: Triple): string =>
  `${cell.recovered} / ${cell.warned} / ${cell.leak} de ${cell.n}`;

const sortKeys = (record: Readonly<Record<string, unknown>>): string[] =>
  Object.keys(record).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

function cpRow(id: string, cell: CpCell | undefined): string[] {
  if (cell === undefined) return [id, "-", "-", "-", "-"];
  return [
    id,
    String(cell.today.n),
    tripleCell(cell.today),
    tripleCell(cell.cp),
    `${cell.changed} (${cell.upscaleUnknown} con agrandado)`,
  ];
}

export function formatM2(summary: M2Summary): string {
  const out: string[] = [];
  const section = (title: string) => out.push("", `## ${title}`, "");
  const { check, validation, rc, cp, sv, margin, real } = summary;

  section("Campaña M-O2");
  out.push(
    `Páginas esperadas ${check.expectedPages}; observaciones esperadas ${check.expectedObservations}, completas ${check.completedObservations}.`,
    `faltan ${check.missing.length}; inesperadas ${check.unexpected.length}; repetidas ${check.duplicated.length}; fallas del instrumento ${check.issues.length}; avisos ${check.warnings.length}.`,
    `Documentos reales presentes: ${summary.realDocs.length === 0 ? "ninguno (corrieron solo las partes sintéticas)" : summary.realDocs.join(", ")}.`,
    check.complete ? "COMPLETA" : "INCOMPLETA",
  );

  section(`Validez de la simulación de la cadena de hoy (${SIM})`);
  out.push(
    `Observaciones medidas comparadas: ${validation.runs}.`,
    `Mismos ángulos leídos: ${validation.sameAngles}/${validation.runs}.`,
    `Misma lectura final (sin las que corrieron el agrandado): ${validation.sameFinal}/${validation.finalCompared}; con agrandado, sin comparar: ${validation.upscaleSkipped}.`,
    validation.disagreements.length === 0
      ? "Sin desacuerdos."
      : `Desacuerdos:\n${validation.disagreements.map((d) => `  ${d.key} ${d.scenario}: ángulos ${d.sameAngles ? "iguales" : "distintos"}, final ${d.sameFinal === null ? "-" : d.sameFinal ? "igual" : "distinta"}`).join("\n")}`,
  );

  section("Parte A. Ruido: tinta y lecturas (medido)");
  out.push(
    renderTable(
      [
        "PDF",
        "tinta",
        "0°: pal/conf/conf%",
        "90°",
        "180°",
        "270°",
        "producción: lecturas",
        "ilegible",
        "entidades",
      ],
      summary.noiseRows.map((row) => {
        const cell = (angle: string) => {
          const reading = row.readings[angle];
          return reading === undefined
            ? "-"
            : `${reading.words}/${reading.reliable}/${fixed(reading.conf)}`;
        };
        return [
          row.key,
          fixed(row.ink, 5),
          cell("0"),
          cell("90"),
          cell("180"),
          cell("270"),
          String(row.productionReadings),
          row.productionUnreadable ? "sí" : "no",
          String(row.productionEntities),
        ];
      }),
    ),
    "",
    "Cada lectura es «palabras / palabras confiables / confianza de página».",
    "",
    "Lecturas de ruido (PDF × 4 ángulos), por tipo:",
    renderTable(
      ["tipo", "lecturas", "con palabras", "con palabra confiable"],
      [
        ...sortKeys(rc.noiseByLabel).map((label) => {
          const cell = rc.noiseByLabel[label];
          return [
            label,
            String(cell?.readings ?? 0),
            String(cell?.withWords ?? 0),
            String(cell?.withReliableWord ?? 0),
          ];
        }),
        [
          "total",
          String(rc.noiseTotal.readings),
          String(rc.noiseTotal.withWords),
          String(rc.noiseTotal.withReliableWord),
        ],
      ],
    ),
    "",
    `Entidades de las observaciones de ruido: ${rc.noiseEntities.withEntities} de ${rc.noiseEntities.observations} observaciones con alguna entidad (${rc.noiseEntities.total} en total).`,
  );

  section(`RC: el renglón de costado (${SIM})`);
  out.push(
    renderTable(
      [
        "conjunto",
        "páginas",
        "las manda RC a los 4 ángulos",
        "recupera hoy",
        "recupera con RC",
        "con lectura fiable",
      ],
      [
        ...sortKeys(rc.byGroup).map((group) => {
          const cell = rc.byGroup[group];
          return [
            group,
            String(cell?.pages ?? 0),
            String(cell?.probedByRc ?? 0),
            String(cell?.recoveredToday ?? 0),
            String(cell?.recoveredRc ?? 0),
            String(cell?.withReliableReading ?? 0),
          ];
        }),
      ],
    ),
    "",
    "Por etiqueta:",
    renderTable(
      [
        "conjunto:etiqueta",
        "páginas",
        "las manda RC",
        "recupera hoy",
        "recupera con RC",
        "con lectura fiable",
      ],
      sortKeys(rc.byLabel).map((label) => {
        const cell = rc.byLabel[label];
        return [
          label,
          String(cell?.pages ?? 0),
          String(cell?.probedByRc ?? 0),
          String(cell?.recoveredToday ?? 0),
          String(cell?.recoveredRc ?? 0),
          String(cell?.withReliableReading ?? 0),
        ];
      }),
    ),
    "",
    "Las páginas que RC suma a los cuatro ángulos:",
    renderTable(
      [
        "PDF",
        "tinta",
        "lecturas hoy",
        "lecturas con RC",
        "ángulo RC",
        "hoy",
        "con RC",
        "lecturas fiables",
      ],
      rc.rows.map((row) => [
        row.key,
        fixed(row.ink, 5),
        String(row.todayReadings),
        String(row.rcReadings),
        String(row.rcAngle),
        row.todayOutcome,
        row.rcOutcome,
        String(row.reliableReadings),
      ]),
    ),
    "",
    `Tiempo de tres lecturas más sobre esas páginas (${rc.time.pages} con medición):`,
    `  en frío (primeras lecturas, cota alta): ${distributionCell(rc.time.cold)}`,
    `  en caliente (reconocimientos posteriores al primero, con muestra): ${distributionCell(rc.time.warm)}`,
  );

  section(`CP: el comparador con confianza de página (${SIM})`);
  out.push(
    "Cada celda es «recupera / avisa / filtra de n». «Cambian» cuenta las lecturas con ángulos o lectura elegida distintos.",
    renderTable(
      ["conjunto|escenario", "n", "hoy (simulado)", "con CP (simulado)", "cambian"],
      [
        ...["m1-text", "margin"].flatMap((group) =>
          SCENARIOS.map((scenario) =>
            cpRow(`${group}|${scenario}`, cp.cells[`${group}|${scenario}`]),
          ),
        ),
      ],
    ),
    "",
    "Por etiqueta:",
    renderTable(
      ["conjunto:etiqueta|escenario", "n", "hoy (simulado)", "con CP (simulado)", "cambian"],
      sortKeys(cp.cells)
        .filter((id) => id.includes(":"))
        .map((id) => cpRow(id, cp.cells[id])),
    ),
    "",
    `Fugas medidas de M-O1 con veredicto equivocado forzado: ${cp.m1Leaks.measuredLeaks}; la simulación de hoy reproduce ${cp.m1Leaks.simulatedTodayLeaks}; CP solo cierra ${cp.m1Leaks.closedByCp} y quedan ${cp.m1Leaks.stillLeakWithCp}.`,
    "",
    `De fuga o aviso a recuperada con CP (${cp.toRecovered.length}):`,
    ...changeLines(cp.toRecovered),
    "",
    `De recuperada a fuga o aviso con CP (${cp.toLeak.length}):`,
    ...changeLines(cp.toLeak),
  );

  section("Parte C. Margen: cuerpo y sello por separado");
  out.push(
    "Cada celda es «n / cuerpo / sello / ambos» (los que traen los datos de esa parte). M1 no tiene cuerpo: cuenta como recuperado.",
    renderTable(
      ["etiqueta|escenario", "medido hoy", `simulado hoy`, "simulado con CP"],
      sortKeys(margin.rows).map((id) => {
        const row = margin.rows[id];
        const cell = (
          part: { n: number; body: number; stamp: number; both: number } | undefined,
        ) => (part === undefined ? "-" : `${part.n} / ${part.body} / ${part.stamp} / ${part.both}`);
        return [id, cell(row?.measured), cell(row?.simToday), cell(row?.simCp)];
      }),
    ),
    `(${SIM}, salvo la columna «medido hoy».)`,
  );

  section(`SV: la señal con veredicto (${SIM})`);
  const sets = ["M-O1 sintético", "margen", "R1", "R2 a R4"];
  out.push(
    "«bien orientadas»: páginas con el veredicto en el ángulo correcto (o de referencia) en las que SV dispara (el costo). «escapan»: lecturas en ángulo equivocado con confianza de página ≥ T.",
    renderTable(
      [
        "conjunto",
        "T",
        "páginas",
        "SV dispara en bien orientadas",
        "lecturas equivocadas",
        "se le escapan",
      ],
      sets.flatMap((set) =>
        SV_THRESHOLDS.flatMap((threshold) => {
          const cell: SvCell | undefined = sv.cells[`${set}|${threshold}`];
          return cell === undefined
            ? []
            : [
                [
                  set,
                  fixed(threshold),
                  String(cell.pages),
                  String(cell.firesOnWellOriented),
                  String(cell.wrongReadings),
                  String(cell.escapes),
                ],
              ];
        }),
      ),
    ),
    "",
    "Con un veredicto equivocado forzado: fugas con hoy, con CP y con SV + CP (sintéticos); y observaciones que terminan en el ángulo correcto o de referencia.",
    renderTable(
      [
        "conjunto",
        "T",
        "observaciones",
        "fugas hoy",
        "fugas CP",
        "fugas SV+CP",
        "en el ángulo correcto: hoy",
        "CP",
        "SV+CP",
      ],
      sets.flatMap((set) =>
        SV_THRESHOLDS.flatMap((threshold) => {
          const cell: SvCell | undefined = sv.cells[`${set}|${threshold}`];
          return cell === undefined
            ? []
            : [
                [
                  set,
                  fixed(threshold),
                  String(cell.wrongReadings),
                  cell.forcedWrong === 0 ? "-" : String(cell.leaksToday),
                  cell.forcedWrong === 0 ? "-" : String(cell.leaksCp),
                  cell.forcedWrong === 0 ? "-" : String(cell.leaksSvCp),
                  String(cell.endsAtCorrectToday),
                  String(cell.endsAtCorrectCp),
                  String(cell.endsAtCorrectSvCp),
                ],
              ];
        }),
      ),
    ),
  );

  section("Parte B. Páginas reales (solo agregados)");
  for (const [name, item] of Object.entries(real)) {
    out.push(`${name}:`);
    if (item === null) {
      out.push("  no disponible");
      continue;
    }
    out.push(
      `  páginas ${item.pages}; sin lectura fiable en ningún ángulo (sin referencia) ${item.noReference}.`,
      `  confianza de página de la lectura de referencia: ${spreadCell(item.referenceConfidence)}`,
      `  confianza de página de las lecturas en ángulo equivocado: ${spreadCell(item.wrongConfidence)}`,
      `  veredicto natural frente a la referencia: coincide ${item.naturalAgrees}; no coincide ${item.naturalDisagrees}; sin veredicto ${item.noVerdict}.`,
      `  tinta: mínimo ${fixed(item.inkMin, 5)}; debajo de 0,002: ${item.inkBelowThreshold}.`,
      `  con veredicto equivocado forzado (hoy, medido; ${item.forcedWrong.observations} observaciones): entrega la referencia ${item.forcedWrong.deliversReference}; otro ángulo sin avisar ${item.forcedWrong.deliversOtherAngleWithoutWarning}; otro ángulo con aviso ${item.forcedWrong.otherAngleWithWarning}; sin identificar ${item.forcedWrong.unknown}.`,
      `  entidades en la lectura final de producción: páginas con alguna ${item.productionEntities.pagesWithEntities}; por página ${spreadCell(item.productionEntities.entities)}`,
    );
  }
  return `${out.join("\n")}\n`;
}

function changeLines(changes: ReadonlyArray<M2Summary["cp"]["toRecovered"][number]>): string[] {
  if (changes.length === 0) return ["  ninguna"];
  return changes.map(
    (change) =>
      `  ${change.key} [${change.scenario}, veredicto ${change.verdict}]: ${change.todayOutcome} (${change.todayAngle}°) -> ${change.cpOutcome} (${change.cpAngle}°)${change.upscaleUnknown ? " [agrandado sin simular]" : ""}`,
  );
}

export function m2ResultLine(summary: M2Summary): string {
  const { check, cp } = summary;
  return `M-O2: ${check.completedObservations}/${check.expectedObservations} observaciones; ${check.complete ? "completa" : "INCOMPLETA"}; CP cierra ${cp.m1Leaks.closedByCp} de ${cp.m1Leaks.measuredLeaks} fugas de M-O1.`;
}
