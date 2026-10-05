import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const jsonReport =
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? "test-results/export-verification.json";
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const childEnvironment = { ...process.env };
delete childEnvironment.TSX_TSCONFIG_PATH;

if (process.argv.length !== 2) {
  console.error("El gate test:export-verification no acepta argumentos ni filtros de tests.");
  process.exitCode = 2;
} else {
  const reportPath = resolve(root, jsonReport);
  process.env.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonReport;
  await mkdir(dirname(reportPath), { recursive: true });

  const commands = [
    { label: "Mirror first-party assets", args: ["assets:mirror"] },
    {
      label: "Build renderer (VITE_E2E=1)",
      args: [
        "exec",
        "cross-env",
        "VITE_E2E=1",
        packageManager,
        "--filter",
        "@anonly/react-client",
        "build",
      ],
    },
    { label: "Build desktop shell", args: ["--filter", "@anonly/desktop-shell", "build"] },
    {
      label: "Run dedicated Playwright suite",
      args: ["exec", "playwright", "test", "--config=playwright.export-verification.config.ts"],
    },
  ];
  let runnerFailed = false;
  for (const command of commands) {
    process.stdout.write(`\n> ${command.label}\n`);
    const result = spawnSync(packageManager, command.args, {
      cwd: root,
      env: childEnvironment,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.error !== undefined) {
      console.error(`${command.label} no pudo ejecutarse: ${result.error.message}`);
      runnerFailed = true;
      break;
    }
    if (result.status !== 0) {
      console.error(`${command.label} terminó con código ${String(result.status)}.`);
      runnerFailed = true;
      break;
    }
  }

  process.stdout.write("\n> Assert 21 tests ejecutados, 0 salteados\n");
  const assertion = spawnSync(
    process.execPath,
    [
      "scripts/ci/assert-min-tests.mjs",
      "--report",
      jsonReport,
      "--min",
      "21",
      "--format",
      "playwright",
    ],
    { cwd: root, env: childEnvironment, stdio: "inherit" },
  );
  if (assertion.error !== undefined || assertion.status !== 0) runnerFailed = true;
  if (runnerFailed) process.exitCode = 1;
}
