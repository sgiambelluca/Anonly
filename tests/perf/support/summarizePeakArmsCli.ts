/**
 * `tsx tests/perf/support/summarizePeakArmsCli.ts <RUN_DIR> [control] [candidato]` lee
 * `<RUN_DIR>/runs/*.json` y escribe `<RUN_DIR>/summary.json`, además de
 * imprimir cada corrida. Solo agrega números ya medidos: no reescribe crudos.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseRunFileName,
  summarizeCampaign,
  toTemperatureRow,
  type LabeledReport,
  type ProfileReportInput,
} from "./peakArmsSummary.js";

async function main(): Promise<void> {
  const runDir = process.argv[2];
  if (runDir === undefined) throw new Error("arnés de pico: falta el directorio de la campaña");
  const runsDir = join(runDir, "runs");
  const names = (await readdir(runsDir)).filter((name) => name.endsWith(".json")).sort();
  const reports: LabeledReport[] = [];
  for (const name of names) {
    const label = parseRunFileName(name);
    if (label === undefined) continue;
    const report = JSON.parse(await readFile(join(runsDir, name), "utf8")) as ProfileReportInput;
    reports.push({ ...label, report });
    for (const temperature of ["cold", "hot"] as const) {
      const row = toTemperatureRow(report[temperature]);
      process.stdout.write(
        `${name} ${temperature} ok=${row.ok} peak=${row.peakMb} parse=${row.parsePeakMb} ` +
          `ocr=${row.ocrPeakMb} tab=${row.tabPeakMb} postReady=${row.postReadyPeakMb} ` +
          `base=${row.baselineMb} ready=${row.readyMs}ms groups=${row.groupCount} ` +
          `ocrText=${row.ocrTextSha256.slice(0, 12)}\n`,
      );
    }
  }
  const control = process.argv[3] ?? "base";
  const candidate = process.argv[4] ?? "head";
  const summary = summarizeCampaign(reports, control, candidate);
  await writeFile(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
