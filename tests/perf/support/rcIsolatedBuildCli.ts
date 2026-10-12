import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import baseConfig from "../../../apps/react-client/vite.config.js";
import { createRcTransformPlugin } from "../rc-isolated.vite.config.js";

import {
  RC_REPO_ROOT,
  activateRcBuild,
  activateRcShell,
  recordRcNormalRenderer,
  restoreRcBuilds,
  validateRcSourceMode,
  verifyRcBuildIdentity,
  writeRcBuildIdentity,
} from "./rcIsolatedFiles.js";
import { parseRcSourceMode, type RcArm } from "./rcIsolatedTransform.js";

interface ViteBuildApi {
  build(config: unknown): Promise<unknown>;
}

function isViteBuildApi(value: unknown): value is ViteBuildApi {
  return typeof value === "object" && value !== null && "build" in value;
}

async function buildRcArm(directory: string, arm: RcArm, mode: "experimental" | "adopted") {
  const appRoot = resolve(RC_REPO_ROOT, "apps/react-client");
  const enginePath = resolve(
    RC_REPO_ROOT,
    "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
  );
  const source = await readFile(enginePath, "utf8");
  const identityFile = resolve(directory, `transform-${arm}.json`);
  const plugin = createRcTransformPlugin({
    arm,
    mode,
    identityFile,
    sourceFile: enginePath,
    source,
  });
  const requireFromApp = createRequire(resolve(appRoot, "package.json"));
  const viteEntry = requireFromApp.resolve("vite");
  const viteModule: unknown = await import(pathToFileURL(viteEntry).href);
  if (!isViteBuildApi(viteModule) || typeof viteModule.build !== "function")
    throw new Error("RC Vite build API unavailable");
  const config = {
    ...baseConfig,
    configFile: false,
    root: appRoot,
    plugins: [...(baseConfig.plugins ?? []), plugin],
  };
  const previousCwd = process.cwd();
  try {
    process.chdir(appRoot);
    process.env.VITE_E2E = "1";
    await viteModule.build(config);
  } finally {
    process.chdir(previousCwd);
  }
}

try {
  const directory = process.argv[2];
  if (directory === undefined) throw new Error("RC build directory missing");
  if (process.argv[3] === "restore") await restoreRcBuilds(directory);
  else if (process.argv[3] === "shell") await activateRcShell(directory);
  else if (process.argv[3] === "verify") await verifyRcBuildIdentity(directory);
  else if (process.argv[3] === "control") await activateRcBuild(directory, "A");
  else if (process.argv[3] === "normal") await recordRcNormalRenderer(directory);
  else if (process.argv[3] === "arm") {
    const arm = process.argv[4];
    if (arm !== "A" && arm !== "RC") throw new Error("RC build arm unsupported");
    const mode = parseRcSourceMode(process.env.ANONLY_RC_SOURCE_MODE);
    await buildRcArm(directory, arm, mode);
  } else if (process.argv[3] === "preflight") {
    const mode = process.argv[4];
    if (mode !== "experimental" && mode !== "adopted")
      throw new Error("RC source mode unsupported");
    await validateRcSourceMode(mode);
  } else {
    const mode = process.argv[3];
    if (mode !== "experimental" && mode !== "adopted")
      throw new Error("RC source mode unsupported");
    await writeRcBuildIdentity(directory, mode);
  }
} catch {
  console.error("RC build identity unavailable");
  process.exitCode = 1;
}
