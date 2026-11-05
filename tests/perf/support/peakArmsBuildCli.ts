/**
 * Campaña de reducción de pico: construye el renderer de un brazo
 * (`peakArmsTransform.ts`) en un directorio propio. Transforma, en memoria,
 * `pdf-engine/src/pdf.engine.ts` (C-1) y `src/orchestrator.ts` (C-2) en el
 * bundle principal **y** en los de workers: `pdf.engine.ts` entra a los dos (el
 * worker de parseo y el `PdfEngine` que importa el façade).
 * `apps/react-client/dist` no se toca acá: el runner copia el brazo antes de
 * cada corrida.
 *
 * Uso: `tsx tests/perf/support/peakArmsBuildCli.ts <base|c1|c2|head|c3|c4|c4r> <outDir>`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import baseConfig from "../../../apps/react-client/vite.config.js";

import {
  createPeakArmIdentity,
  parsePeakArm,
  transformPeakSource,
  type PeakArm,
  type PeakSourceFile,
} from "./peakArmsTransform.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = resolve(REPO_ROOT, "apps/react-client");
/** Principal y worker de Render, observado en el build de c4 (`transformsSeen`). */
const RENDER_KERNEL_BUNDLES = 2;

/**
 * `bundles`: cuántas veces tiene que pasar el archivo por el plugin. `pdf.engine.ts`
 * entra al bundle principal y al del worker de parseo; si el plugin dejara de
 * aplicarse a uno de los dos, el brazo mediría otra cosa y el build se niega.
 */
const SOURCES: ReadonlyArray<{
  readonly file: PeakSourceFile;
  readonly path: string;
  readonly bundles: number;
}> = [
  {
    file: "pdf-engine",
    path: resolve(REPO_ROOT, "packages/anonymization-core/pdf-engine/src/pdf.engine.ts"),
    bundles: 2,
  },
  {
    file: "orchestrator",
    path: resolve(REPO_ROOT, "packages/anonymization-core/src/orchestrator.ts"),
    bundles: 1,
  },
  {
    file: "render-kernel",
    path: resolve(REPO_ROOT, "packages/anonymization-core/render-engine/src/worker/kernel.ts"),
    bundles: RENDER_KERNEL_BUNDLES,
  },
];

interface ViteBuildApi {
  build(config: unknown): Promise<unknown>;
}

function isViteBuildApi(value: unknown): value is ViteBuildApi {
  return typeof value === "object" && value !== null && "build" in value;
}

interface LoadedSource {
  readonly file: PeakSourceFile;
  readonly target: string;
  readonly source: string;
  readonly transformed: string;
}

function createPlugin(sources: ReadonlyArray<LoadedSource>, seen: Map<PeakSourceFile, number>) {
  return {
    name: "anonly-experiment-peak-arms",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const normalized = id.replaceAll("\\", "/").split("?")[0];
      const entry = sources.find((candidate) => candidate.target === normalized);
      if (entry === undefined) return null;
      if (code !== entry.source)
        throw new Error(
          `arnés de pico: el fuente de ${entry.file} leído por Vite no es el esperado`,
        );
      seen.set(entry.file, (seen.get(entry.file) ?? 0) + 1);
      return entry.transformed === entry.source ? null : { code: entry.transformed, map: null };
    },
  };
}

async function main(): Promise<void> {
  const arm: PeakArm = parsePeakArm(process.argv[2]);
  const outDir = process.argv[3];
  if (outDir === undefined) throw new Error("arnés de pico: falta el directorio de salida");
  const absoluteOut = resolve(outDir);
  const sources: LoadedSource[] = [];
  for (const { file, path } of SOURCES) {
    const source = await readFile(path, "utf8");
    sources.push({
      file,
      target: path.replaceAll("\\", "/"),
      source,
      transformed: transformPeakSource(source, file, arm),
    });
  }
  const seen = new Map<PeakSourceFile, number>();
  const plugin = createPlugin(sources, seen);

  const requireFromApp = createRequire(resolve(APP_ROOT, "package.json"));
  const viteModule: unknown = await import(pathToFileURL(requireFromApp.resolve("vite")).href);
  if (!isViteBuildApi(viteModule))
    throw new Error("arnés de pico: API de build de Vite no disponible");

  const baseWorker = baseConfig.worker ?? {};
  const baseWorkerPlugins = baseWorker.plugins;
  const config = {
    ...baseConfig,
    configFile: false,
    root: APP_ROOT,
    plugins: [...(baseConfig.plugins ?? []), plugin],
    build: { ...(baseConfig.build ?? {}), outDir: absoluteOut, emptyOutDir: true },
    worker: {
      ...baseWorker,
      // `worker.plugins` es una función en Vite 6+: cada bundle de worker pide
      // una lista nueva. Se le agrega el plugin del experimento.
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
  for (const { file, bundles } of SOURCES) {
    const count = seen.get(file) ?? 0;
    if (count !== bundles)
      throw new Error(
        `arnés de pico: ${file} pasó ${count} veces por el build, se esperaban ${bundles}`,
      );
  }
  const identity = {
    arm,
    transformsSeen: Object.fromEntries(seen),
    files: sources.map((entry) => createPeakArmIdentity(entry.source, entry.file, arm)),
  };
  await writeFile(
    resolve(absoluteOut, "..", `transform-${arm}.json`),
    JSON.stringify(identity, null, 2),
  );
}

await main();
