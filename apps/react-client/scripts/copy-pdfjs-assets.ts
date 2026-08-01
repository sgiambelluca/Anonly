/**
 * Copia `cmaps/` y `standard_fonts/` de `pdfjs-dist` a `public/pdfjs/`
 * (ADR-053 §4, §9 — PR B1).
 *
 * pdf.js necesita estos dos directorios para dos casos que hoy no cubre
 * ningún asset servido por la app:
 *   - construir una fuente sustituta cuando el PDF no embebe sus fuentes
 *     (`standard_fonts/`: las standard-14 + Symbol/ZapfDingbats, `.pfb`);
 *   - resolver texto CID contra un CMap predefinido (`cmaps/`, 169 `.bcmap`).
 *
 * Sin este paso, `cMapUrl`/`standardFontDataUrl` (ADR-053 §2, cableados en
 * `render-engine` y `pdf-engine`) apuntan a un 404 y `getDocument()` no
 * puede construir esas fuentes ni esas tablas.
 *
 * Los bytes salen de `node_modules/pdfjs-dist`, una dependencia ya pinneada
 * por `pnpm-lock.yaml`: no pasan por `assets.lock.json` (ese archivo es solo
 * para mirrors de URLs de terceros con sha256 pinneado) ni se commitean —
 * `apps/react-client/public/pdfjs/` está en `.gitignore`, mismo criterio que
 * `public/wasm/` y `public/models/` (ADR-018, precisión del 2026-07-31 en
 * ADR-053 §4).
 *
 * El origen se resuelve con `createRequire` sobre `"pdfjs-dist/package.json"`,
 * nunca con una ruta literal a `node_modules/.pnpm/...`: pnpm usa un store
 * con hash en el path que cambia con la versión y con la máquina.
 *
 * Cableado como `predev`/`prebuild` en `package.json` (no manual, corrido vía
 * `tsx` — mismo runner que `scripts/mirror-assets.ts` en la raíz): si alguien
 * clona el repo y corre `pnpm dev` sin que este paso haya corrido, reaparece
 * el agujero de assets latente descrito en ADR-053 §5.
 *
 * Idempotente por archivo: si el destino ya existe y su tamaño en bytes
 * coincide con el del origen, no se recopia.
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Directorio raíz del paquete `pdfjs-dist` instalado, resuelto vía
 * resolución de módulos de Node (nunca hardcodeado): funciona igual con
 * cualquier layout de `node_modules` que use pnpm (store con hash, symlinks).
 */
export function resolvePdfjsRoot(): string {
  const packageJsonPath = require.resolve("pdfjs-dist/package.json");
  return dirname(packageJsonPath);
}

export interface CopyDirOutcome {
  readonly copied: number;
  readonly skipped: number;
}

/**
 * Copia `srcDir` a `destDir` de forma recursiva e idempotente: un archivo se
 * recopia solo si el destino no existe o si su tamaño no coincide con el del
 * origen. Devuelve cuántos archivos se copiaron y cuántos se saltearon.
 */
export async function copyDirIdempotent(srcDir: string, destDir: string): Promise<CopyDirOutcome> {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });

  let copied = 0;
  let skipped = 0;

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      const nested = await copyDirIdempotent(srcPath, destPath);
      copied += nested.copied;
      skipped += nested.skipped;
      continue;
    }

    if (!entry.isFile()) continue;

    const srcStat = await stat(srcPath);
    const destStat = await stat(destPath).catch(() => null);

    if (destStat !== null && destStat.size === srcStat.size) {
      skipped += 1;
      continue;
    }

    await copyFile(srcPath, destPath);
    copied += 1;
  }

  return { copied, skipped };
}

interface CopyTarget {
  readonly name: string;
  readonly src: string;
  readonly dest: string;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

async function main(): Promise<void> {
  const pdfjsRoot = resolvePdfjsRoot();

  const targets: readonly CopyTarget[] = [
    {
      name: "cmaps",
      src: join(pdfjsRoot, "cmaps"),
      dest: join(APP_ROOT, "public", "pdfjs", "cmaps"),
    },
    {
      name: "standard_fonts",
      src: join(pdfjsRoot, "standard_fonts"),
      dest: join(APP_ROOT, "public", "pdfjs", "standard_fonts"),
    },
  ];

  for (const target of targets) {
    const { copied, skipped } = await copyDirIdempotent(target.src, target.dest);
    process.stdout.write(
      `[pdfjs-assets] ${target.name}: ${copied} copiado(s), ${skipped} sin cambios.\n`,
    );
  }
}

if (isMainModule()) {
  try {
    await main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
