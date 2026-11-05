/**
 * C-1 (`docs/roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md`): construye el
 * renderer de un brazo en un directorio propio, con la transformación de
 * `parseCleanupTransform.ts` aplicada **solo** dentro del bundle del worker de
 * parseo. `apps/react-client/dist` no se toca acá: el script de campaña copia
 * el brazo que toca antes de cada corrida.
 *
 * Uso: `tsx tests/perf/support/parseCleanupBuildCli.ts <A|B> <outDir>`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import baseConfig from "../../../apps/react-client/vite.config.js";

import {
  createParseCleanupIdentity,
  parseParseCleanupArm,
  transformParseCleanupSource,
  type ParseCleanupArm,
} from "./parseCleanupTransform.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = resolve(REPO_ROOT, "apps/react-client");
const ENGINE_PATH = resolve(REPO_ROOT, "packages/anonymization-core/pdf-engine/src/pdf.engine.ts");

interface ViteBuildApi {
  build(config: unknown): Promise<unknown>;
}

function isViteBuildApi(value: unknown): value is ViteBuildApi {
  return typeof value === "object" && value !== null && "build" in value;
}

function createPlugin(source: string, arm: ParseCleanupArm, counter: { seen: number }) {
  const target = ENGINE_PATH.replaceAll("\\", "/");
  const transformed = transformParseCleanupSource(source, arm);
  return {
    name: "anonly-experiment-c1-parse-cleanup",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (id.replaceAll("\\", "/").split("?")[0] !== target) return null;
      if (code !== source) throw new Error("C-1: el fuente leído por Vite no es el esperado");
      counter.seen += 1;
      return transformed === source ? null : { code: transformed, map: null };
    },
  };
}

async function main(): Promise<void> {
  const arm = parseParseCleanupArm(process.argv[2]);
  const outDir = process.argv[3];
  if (outDir === undefined) throw new Error("C-1: falta el directorio de salida");
  const absoluteOut = resolve(outDir);
  const source = await readFile(ENGINE_PATH, "utf8");
  const counter = { seen: 0 };
  const plugin = createPlugin(source, arm, counter);

  const requireFromApp = createRequire(resolve(APP_ROOT, "package.json"));
  const viteModule: unknown = await import(pathToFileURL(requireFromApp.resolve("vite")).href);
  if (!isViteBuildApi(viteModule)) throw new Error("C-1: API de build de Vite no disponible");

  const baseWorker = baseConfig.worker ?? {};
  const baseWorkerPlugins = baseWorker.plugins;
  const config = {
    ...baseConfig,
    configFile: false,
    root: APP_ROOT,
    build: { ...(baseConfig.build ?? {}), outDir: absoluteOut, emptyOutDir: true },
    worker: {
      ...baseWorker,
      // `worker.plugins` es una función en Vite 6+: cada bundle de worker pide
      // una lista nueva. Se le agrega el plugin del experimento a esa lista.
      plugins: () => {
        const inherited =
          typeof baseWorkerPlugins === "function" ? baseWorkerPlugins() : (baseWorkerPlugins ?? []);
        return [...inherited, plugin];
      },
    },
  };

  const previousCwd = process.cwd();
  try {
    process.chdir(APP_ROOT);
    process.env.VITE_E2E = "1";
    await viteModule.build(config);
  } finally {
    process.chdir(previousCwd);
  }
  if (counter.seen !== 1)
    throw new Error(`C-1: pdf.engine.ts se transformó ${counter.seen} veces, se esperaba 1`);
  await writeFile(
    resolve(absoluteOut, "..", `transform-${arm}.json`),
    JSON.stringify(createParseCleanupIdentity(source, arm), null, 2),
  );
}

await main();
