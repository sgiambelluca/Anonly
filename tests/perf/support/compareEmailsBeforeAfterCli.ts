/**
 * Compara una campaña de emails antes y después de ADR-211, celda por celda (M-E3).
 * Uso: `tsx compareEmailsBeforeAfterCli.ts <dpi-down|native> <carpeta-antes> <carpeta-después> [nombre]`.
 * Escribe `comparison.json` y `comparison.txt` en la carpeta de «después» y los imprime. Sale con 0 si no
 * hay emails agregados que la línea de base no tenía (los que ya tenía se informan igual), ni pérdidas nuevas, ni otras entidades que cambien, ni celdas
 * inválidas o con otro texto leído; con 1 si algo de eso aparece (se informa, no se corrige); con 2 si
 * no pudo comparar. Las celdas de corpus reales (R2, R3) no se leen: este arnés es solo de sintéticos.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  compareCampaign,
  comparisonLines,
  viewOfDpiDownCell,
  viewOfNativeCell,
  type CellView,
  type RawDpiDownCell,
  type RawNativeCell,
} from "./emailsBeforeAfter.js";

type Kind = "dpi-down" | "native";

function readCells(dir: string, kind: Kind): Map<string, CellView> {
  const prefix = kind === "dpi-down" ? "ocr-dpi-down-cell-" : "ocr-emails-native-cell-";
  const views = new Map<string, CellView>();
  for (const name of readdirSync(dir).filter(
    (file) => file.startsWith(prefix) && file.endsWith(".json"),
  )) {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
    if (kind === "dpi-down") {
      const raw = parsed as RawDpiDownCell & { readonly corpusKind?: string };
      if (raw.corpusKind === "real") continue;
      const view = viewOfDpiDownCell(raw);
      views.set(view.id, view);
    } else {
      const view = viewOfNativeCell(parsed as RawNativeCell);
      views.set(view.id, view);
    }
  }
  return views;
}

function main(): number {
  const [kindArg, beforeArg, afterArg, nameArg] = process.argv.slice(2);
  if (
    (kindArg !== "dpi-down" && kindArg !== "native") ||
    beforeArg === undefined ||
    afterArg === undefined
  )
    throw new Error(
      "Uso: compareEmailsBeforeAfterCli.ts <dpi-down|native> <carpeta-antes> <carpeta-después> [nombre]",
    );
  const beforeDir = resolve(beforeArg);
  const afterDir = resolve(afterArg);
  for (const dir of [beforeDir, afterDir])
    if (!existsSync(dir)) throw new Error("La carpeta no existe.");
  const comparison = compareCampaign(
    nameArg ?? kindArg,
    readCells(beforeDir, kindArg),
    readCells(afterDir, kindArg),
  );
  const lines = comparisonLines(comparison);
  writeFileSync(
    join(afterDir, "comparison.json"),
    `${JSON.stringify({ generatedAtUtc: new Date().toISOString(), ...comparison }, null, 2)}\n`,
  );
  writeFileSync(join(afterDir, "comparison.txt"), `${lines.join("\n")}\n`);
  writeSync(1, `${lines.join("\n")}\n`);
  const { totals } = comparison;
  const clean =
    totals.newlyAdded === 0 &&
    totals.newlyLost === 0 &&
    totals.otherChanges === 0 &&
    totals.cellsInvalid.length === 0 &&
    totals.cellsWithDifferentText.length === 0;
  return clean ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
