/**
 * `pnpm gates`: corre los gates y le imprime poco al agente que lo invoca.
 *
 * Lo que imprime un comando queda en el contexto de quien lo corre y se relee
 * en cada llamada siguiente. Por eso este runner muestra UNA línea por gate y
 * el detalle solo de lo que falla; la salida completa de cada gate va a
 * `.gates-logs/` (ignorada por git, se pisa en cada corrida).
 *
 * Uso:
 *   pnpm gates                          # cadena de CLAUDE.md §Gates, corta en la primera falla
 *   pnpm gates --keep-going             # corre todos aunque alguno falle
 *   pnpm gates --module <ruta>          # gates acotados a una ruta (p. ej. un motor)
 *
 * Modo módulo: eslint <ruta>, typecheck del paquete que contiene la ruta,
 * vitest <ruta> (filtro posicional, nunca `--dir`: ADR-033) y prettier --check <ruta>.
 *
 * Nunca esconde una falla: el exit code es distinto de cero si falla algún
 * gate, y si el filtro no reconoce nada en una falla se imprimen las últimas
 * líneas tal cual. Un gate que no aplica se imprime como `n/a` con su motivo.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR_NAME = ".gates-logs";
const MAX_DETAIL_LINES = 40;

export type GateKind = "eslint" | "tsc" | "vitest" | "prettier";

export interface GateSpec {
  readonly name: string;
  readonly kind: GateKind;
  /** Argumentos que se le pasan a `pnpm`. */
  readonly pnpmArgs: readonly string[];
}

export interface NotApplicableGate {
  readonly name: string;
  readonly notApplicable: string;
}

export type GatePlanItem = GateSpec | NotApplicableGate;

export interface GateResult {
  readonly name: string;
  readonly status: "ok" | "FALLA" | "n/a";
  readonly durationMs: number;
  readonly detail: readonly string[];
  readonly logFile?: string;
}

export interface GatesArgs {
  readonly module?: string;
  readonly keepGoing: boolean;
}

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

export function parseArgs(argv: readonly string[]): GatesArgs {
  let module: string | undefined;
  let keepGoing = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--keep-going") {
      keepGoing = true;
    } else if (arg === "--module") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--module requiere una ruta");
      }
      module = value;
      i += 1;
    } else if (arg.startsWith("--module=")) {
      module = arg.slice("--module=".length);
      if (module === "") throw new Error("--module requiere una ruta");
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return module === undefined ? { keepGoing } : { module, keepGoing };
}

// ---------------------------------------------------------------------------
// Plan de gates
// ---------------------------------------------------------------------------

export function fullPlan(): readonly GateSpec[] {
  return [
    { name: "lint", kind: "eslint", pnpmArgs: ["lint"] },
    { name: "typecheck", kind: "tsc", pnpmArgs: ["typecheck"] },
    { name: "test", kind: "vitest", pnpmArgs: ["test"] },
    { name: "test:contract", kind: "vitest", pnpmArgs: ["test:contract"] },
    { name: "format:check", kind: "prettier", pnpmArgs: ["format:check"] },
  ];
}

/** Sube desde `absPath` hasta el primer package.json que no sea el de la raíz. */
export function findPackageDir(absPath: string, repoRoot: string): string | undefined {
  let current = existsSync(absPath) && statSync(absPath).isFile() ? dirname(absPath) : absPath;
  const root = resolve(repoRoot);
  while (resolve(current) !== root && resolve(current).startsWith(root + sep)) {
    if (existsSync(join(current, "package.json"))) return current;
    current = dirname(current);
  }
  return undefined;
}

function hasScript(pkgDir: string, script: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts?.[script] !== undefined;
  } catch {
    return false;
  }
}

export function modulePlan(modulePath: string, repoRoot: string): readonly GatePlanItem[] {
  const rel = modulePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  const abs = resolve(repoRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`La ruta no existe: ${rel}`);
  }
  const pkgDir = findPackageDir(abs, repoRoot);
  let typecheck: GatePlanItem;
  if (pkgDir === undefined) {
    typecheck = {
      name: "typecheck",
      notApplicable: `${rel} no está dentro de un paquete con package.json (no se tipa por separado; usar pnpm typecheck)`,
    };
  } else if (!hasScript(pkgDir, "typecheck")) {
    typecheck = {
      name: "typecheck",
      notApplicable: `el paquete ${relative(repoRoot, pkgDir).replace(/\\/g, "/")} no define script typecheck`,
    };
  } else {
    const pkgRel = relative(repoRoot, pkgDir).replace(/\\/g, "/");
    typecheck = {
      name: "typecheck",
      kind: "tsc",
      pnpmArgs: ["--filter", `./${pkgRel}`, "typecheck"],
    };
  }
  return [
    { name: "eslint", kind: "eslint", pnpmArgs: ["exec", "eslint", rel, "--max-warnings=0"] },
    typecheck,
    { name: "vitest", kind: "vitest", pnpmArgs: ["exec", "vitest", "run", rel] },
    { name: "prettier", kind: "prettier", pnpmArgs: ["exec", "prettier", "--check", rel] },
  ];
}

// ---------------------------------------------------------------------------
// Filtro / resumen
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function nonEmptyLines(text: string): string[] {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");
}

function summarizeEslint(lines: readonly string[]): string[] {
  const out: string[] = [];
  let file: string | undefined;
  for (const line of lines) {
    const issue = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}(\S+))?$/.exec(line);
    if (issue !== null && file !== undefined) {
      const rule = issue[5] ?? "(sin regla)";
      out.push(`${file}:${issue[1]} ${rule} - ${issue[4]}`);
      continue;
    }
    if (/^✖ \d+ problems?/.test(line)) {
      out.push(line);
      continue;
    }
    if (!/^\s/.test(line) && !line.startsWith(">") && !line.startsWith("ELIFECYCLE")) {
      if (/[\\/]/.test(line) || /\.[cm]?[jt]sx?$/.test(line)) file = line.trim();
    }
  }
  return out;
}

function summarizeTsc(lines: readonly string[]): string[] {
  return lines.filter(
    (l) => /\(\d+,\d+\): error TS\d+/.test(l) || /:\d+:\d+ - error TS\d+/.test(l),
  );
}

function summarizeVitest(lines: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (/^\s*FAIL\s/.test(line)) {
      let taken = 0;
      out.push(line.trim());
      i += 1;
      while (
        i < lines.length &&
        taken < 8 &&
        !/^\s*FAIL\s/.test(lines[i] as string) &&
        !/^\s*⎯+/.test(lines[i] as string)
      ) {
        out.push(`  ${(lines[i] as string).trim()}`);
        taken += 1;
        i += 1;
      }
      continue;
    }
    if (/^\s*(Test Files|Tests)\s/.test(line)) out.push(line.trim());
    i += 1;
  }
  const hasFail = out.some((l) => l.startsWith("FAIL"));
  if (!hasFail) return [];
  // Con FAIL, además de los bloques, se suman errores sueltos (no atribuibles a un test).
  for (const e of vitestErrorLines(lines)) if (!out.includes(e)) out.push(e);
  return out;
}

/** Líneas de error de vitest que no pertenecen a un bloque FAIL (unhandled, thresholds). */
function vitestErrorLines(lines: readonly string[]): string[] {
  return lines
    .filter(
      (l) =>
        /Unhandled/i.test(l) ||
        /^\s*(\w*Error|ERROR):/.test(l) ||
        /Coverage for .*does not meet/i.test(l) ||
        /ERROR:.*threshold/i.test(l) ||
        /threshold/i.test(l),
    )
    .map((l) => l.trim());
}

function summarizePrettier(lines: readonly string[]): string[] {
  return lines.filter((l) => /^\[warn\]/.test(l) || /^\[error\]/.test(l));
}

/**
 * Reduce la salida completa de un gate fallido a las líneas útiles. Si el
 * filtro no reconoce nada, devuelve las últimas 40 líneas tal cual.
 */
export function summarizeFailure(kind: GateKind, output: string): readonly string[] {
  const lines = nonEmptyLines(output);
  let picked: string[];
  switch (kind) {
    case "eslint":
      picked = summarizeEslint(lines);
      break;
    case "tsc":
      picked = summarizeTsc(lines);
      break;
    case "vitest": {
      picked = summarizeVitest(lines);
      if (picked.length === 0) {
        // Falla sin líneas FAIL (unhandled errors, threshold de cobertura): las
        // causas reconocidas primero y el resto de la cola tal cual.
        const errors = [...new Set(vitestErrorLines(lines))].slice(0, 10);
        const tail = lines.slice(-(MAX_DETAIL_LINES - errors.length));
        return [...errors.filter((e) => !tail.some((t) => t.trim() === e)), ...tail];
      }
      break;
    }
    case "prettier":
      picked = summarizePrettier(lines);
      break;
  }
  if (picked.length === 0) return lines.slice(-MAX_DETAIL_LINES);
  if (picked.length > MAX_DETAIL_LINES) {
    const extra = picked.length - MAX_DETAIL_LINES;
    return [...picked.slice(0, MAX_DETAIL_LINES), `... (+${extra} líneas más, ver log)`];
  }
  return picked;
}

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m${String(rest).padStart(2, "0")}s`;
}

/** Arma el reporte final (puro: sin I/O). */
export function formatReport(
  results: readonly GateResult[],
  skipped: readonly string[],
  logDir: string,
): string {
  const lines: string[] = [];
  const nameWidth = Math.max(0, ...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.status.padEnd(5);
    const duration = r.status === "n/a" ? "" : formatDuration(r.durationMs);
    lines.push(`${status}  ${r.name.padEnd(nameWidth)}  ${duration}`.trimEnd());
    if (r.status !== "ok") {
      for (const d of r.detail) lines.push(`    ${d}`);
      if (r.status === "FALLA" && r.logFile !== undefined) lines.push(`    log: ${r.logFile}`);
    }
  }
  if (skipped.length > 0) lines.push(`omitidos tras la falla: ${skipped.join(", ")}`);
  const failed = results.filter((r) => r.status === "FALLA").length;
  const na = results.filter((r) => r.status === "n/a").length;
  const okCount = results.filter((r) => r.status === "ok").length;
  lines.push(
    `gates: ${okCount} ok, ${failed} FALLA${na > 0 ? `, ${na} n/a` : ""}${skipped.length > 0 ? `, ${skipped.length} omitidos` : ""}`,
  );
  lines.push(`logs completos: ${logDir}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

interface RunOutput {
  readonly code: number;
  readonly output: string;
}

function runPnpm(args: readonly string[], cwd: string): Promise<RunOutput> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  delete env["FORCE_COLOR"];
  // Bajo `pnpm <script>`, npm_execpath apunta al pnpm.cjs real: se lanza con el
  // node actual y se evita el .cmd de Windows (que exige shell).
  const execPath = process.env["npm_execpath"];
  const viaNode = execPath !== undefined && /pnpm[^\\/]*\.c?js$/.test(execPath);
  const command = viaNode ? process.execPath : "pnpm";
  const commandArgs = viaNode ? [execPath, ...args] : [...args];
  const useShell = !viaNode && process.platform === "win32";
  return new Promise((resolvePromise) => {
    const chunks: Buffer[] = [];
    const child = spawn(command, commandArgs, { cwd, env, shell: useShell, windowsHide: true });
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", (err) => {
      chunks.push(Buffer.from(`No se pudo lanzar pnpm: ${err.message}\n`));
      resolvePromise({ code: 1, output: Buffer.concat(chunks).toString("utf8") });
    });
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

async function resetLogDir(logDir: string): Promise<void> {
  await mkdir(logDir, { recursive: true });
  for (const f of await readdir(logDir)) {
    if (f.endsWith(".log")) await rm(join(logDir, f), { force: true });
  }
}

function slug(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "-");
}

export async function runGates(
  plan: readonly GatePlanItem[],
  keepGoing: boolean,
  repoRoot: string,
): Promise<{ readonly report: string; readonly exitCode: number }> {
  const logDir = join(repoRoot, LOG_DIR_NAME);
  await resetLogDir(logDir);
  const results: GateResult[] = [];
  const skipped: string[] = [];
  let stop = false;
  let index = 0;
  for (const item of plan) {
    index += 1;
    if ("notApplicable" in item) {
      results.push({
        name: item.name,
        status: "n/a",
        durationMs: 0,
        detail: [`no aplica: ${item.notApplicable}`],
      });
      continue;
    }
    if (stop) {
      skipped.push(item.name);
      continue;
    }
    const started = Date.now();
    const { code, output } = await runPnpm(item.pnpmArgs, repoRoot);
    const durationMs = Date.now() - started;
    const logPath = join(logDir, `${String(index).padStart(2, "0")}-${slug(item.name)}.log`);
    await writeFile(logPath, `$ pnpm ${item.pnpmArgs.join(" ")}\n(exit ${code})\n\n${output}`);
    if (code === 0) {
      results.push({ name: item.name, status: "ok", durationMs, detail: [] });
    } else {
      results.push({
        name: item.name,
        status: "FALLA",
        durationMs,
        detail: summarizeFailure(item.kind, output),
        logFile: relative(repoRoot, logPath).replace(/\\/g, "/"),
      });
      if (!keepGoing) stop = true;
    }
  }
  const failed = results.some((r) => r.status === "FALLA");
  return {
    report: formatReport(results, skipped, `${LOG_DIR_NAME}/`),
    exitCode: failed ? 1 : 0,
  };
}

async function main(): Promise<void> {
  let args: GatesArgs;
  let plan: readonly GatePlanItem[];
  try {
    args = parseArgs(process.argv.slice(2));
    plan = args.module === undefined ? fullPlan() : modulePlan(args.module, REPO_ROOT);
  } catch (err) {
    process.stderr.write(`gates: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
    return;
  }
  const { report, exitCode } = await runGates(plan, args.keepGoing, REPO_ROOT);
  process.stdout.write(`${report}\n`);
  process.exitCode = exitCode;
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  void main();
}
