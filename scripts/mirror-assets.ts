/**
 * Mirror de assets first-party de Tesseract.js (ADR-018).
 *
 * Descarga los assets pinneados en `assets.lock.json` (URL de origen +
 * revisión + sha256), verifica el hash contra el pin, y los deposita en
 * `apps/react-client/public/`. Nunca se sirven estos assets desde jsDelivr
 * ni ningún otro CDN de terceros en runtime — este script es la única vía
 * por la que esos bytes entran al build (ocr-engine los consume luego desde
 * el origen propio vía `langPath`/`corePath`/`workerPath`, ver
 * `packages/anonymization-core/ocr-engine/src/ocr.engine.ts`).
 *
 * Uso:
 *   pnpm assets:mirror
 *
 * Idempotente: si el destino ya existe y su sha256 coincide con el pin, no
 * vuelve a descargar. Si un hash no coincide tras la descarga, el asset NO
 * se escribe a disco y el proceso termina con exit code 1 — nunca se
 * deposita un archivo cuyo contenido no fue verificado.
 *
 * **No borra nada**, y por eso además REVISA: un archivo que quedó de un lock
 * anterior se sigue sirviendo desde `public/` como si estuviera pineado. Ver
 * `findStaleAssets`.
 *
 * Actualizar un asset = editar su entrada en `assets.lock.json` (URL,
 * revision, sha256, sizeBytes) en un PR revisable, no editar este script.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { dirname as posixDirname, basename as posixBasename } from "node:path/posix";
import { fileURLToPath } from "node:url";

export interface AssetLockEntry {
  readonly id: string;
  readonly url: string;
  readonly revision: string;
  readonly sha256: string;
  readonly destination: string;
  readonly sizeBytes: number;
}

export interface AssetsLock {
  readonly version: number;
  readonly assets: ReadonlyArray<AssetLockEntry>;
}

export type MirrorResult = "skipped" | "downloaded";

export interface MirrorOutcome {
  readonly id: string;
  readonly result: MirrorResult;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_FILE_PATH = resolve(REPO_ROOT, "assets.lock.json");

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function readAssetsLock(lockFilePath: string): Promise<AssetsLock> {
  const raw = await readFile(lockFilePath, "utf-8");
  return JSON.parse(raw) as AssetsLock;
}

async function readExistingHash(destinationPath: string): Promise<string | null> {
  try {
    const existing = await readFile(destinationPath);
    return sha256Hex(existing);
  } catch {
    return null;
  }
}

async function downloadAndVerify(entry: AssetLockEntry): Promise<Uint8Array> {
  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(`GET ${entry.url} devolvió HTTP ${response.status}.`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const actualHash = sha256Hex(buffer);

  if (actualHash !== entry.sha256) {
    throw new Error(
      `Hash mismatch para "${entry.id}" (${entry.url}): esperado ${entry.sha256}, obtenido ${actualHash}. ` +
        "No se escribe el archivo. El asset pudo haber cambiado en el origen o assets.lock.json está desactualizado.",
    );
  }
  if (buffer.byteLength !== entry.sizeBytes) {
    throw new Error(
      `Tamaño inesperado para "${entry.id}": esperado ${entry.sizeBytes} bytes, obtenido ${buffer.byteLength}.`,
    );
  }

  return buffer;
}

export async function mirrorAsset(entry: AssetLockEntry, rootDir: string): Promise<MirrorResult> {
  const destinationPath = resolve(rootDir, entry.destination);

  const existingHash = await readExistingHash(destinationPath);
  if (existingHash === entry.sha256) {
    return "skipped";
  }

  const data = await downloadAndVerify(entry);
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, data);
  return "downloaded";
}

export async function mirrorAssets(
  lock: AssetsLock,
  rootDir: string,
): Promise<ReadonlyArray<MirrorOutcome>> {
  const outcomes: MirrorOutcome[] = [];
  for (const entry of lock.assets) {
    const result = await mirrorAsset(entry, rootDir);
    outcomes.push({ id: entry.id, result });
  }
  return outcomes;
}

/*
 * Assets que quedaron en un destino del lock y que el lock ya NO declara.
 *
 * El mirror nunca borró un archivo, y `public/` está en `.gitignore`: un
 * archivo que salió del lock sobrevive en la máquina que lo había bajado, se
 * sigue sirviendo desde el mismo origen y nadie se entera. Eso convierte un
 * asset que falta en un bug que funciona en una máquina y en ninguna otra —
 * que es exactamente lo que pasó cuando ADR-119 dejó al worker de
 * reconocimiento pidiendo `tesseract-core-simd-lstm.wasm.js` después de que
 * ADR-090 lo sacara del lock (errata 2026-09-03 de los dos ADR).
 *
 * Se mira **por directorio declarado**, no recursivo: los directorios que el
 * lock no toca no son asunto de este script (`public/pdfjs/`, que llena
 * `apps/react-client/scripts/copy-pdfjs-assets.ts` desde `pnpm-lock.yaml`, es
 * el caso vivo). Un subdirectorio se saltea porque, si tiene assets del lock,
 * ya entra por su propia entrada.
 *
 * Los archivos ocultos se ignoran: ningún asset del lock empieza con punto, y
 * un `.DS_Store` que rompa el comando es la forma más rápida de que alguien
 * apague la revisión.
 */
export async function findStaleAssets(
  lock: AssetsLock,
  rootDir: string,
): Promise<ReadonlyArray<string>> {
  const declaredByDir = new Map<string, Set<string>>();
  for (const entry of lock.assets) {
    const dir = posixDirname(entry.destination);
    const names = declaredByDir.get(dir) ?? new Set<string>();
    names.add(posixBasename(entry.destination));
    declaredByDir.set(dir, names);
  }

  const stale: string[] = [];
  for (const [dir, declared] of declaredByDir) {
    let entries;
    try {
      entries = await readdir(resolve(rootDir, dir), { withFileTypes: true });
    } catch {
      // El directorio todavía no existe: no hay nada mirroreado, no hay sobra.
      continue;
    }
    for (const dirent of entries) {
      if (dirent.isDirectory()) continue;
      if (dirent.name.startsWith(".")) continue;
      if (declared.has(dirent.name)) continue;
      stale.push(`${dir}/${dirent.name}`);
    }
  }
  return stale.sort();
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

async function main(): Promise<void> {
  const lock = await readAssetsLock(LOCK_FILE_PATH);
  process.stdout.write(`Verificando ${lock.assets.length} asset(s) de assets.lock.json...\n`);

  const outcomes = await mirrorAssets(lock, REPO_ROOT);

  for (const outcome of outcomes) {
    process.stdout.write(`  [${outcome.result}] ${outcome.id}\n`);
  }

  const stale = await findStaleAssets(lock, REPO_ROOT);
  if (stale.length > 0) {
    throw new Error(
      `Hay ${stale.length} archivo(s) en los destinos del mirror que assets.lock.json ya no declara:\n` +
        stale.map((path) => `  ${path}\n`).join("") +
        "Este script nunca borra, así que esos archivos se siguen sirviendo desde el mismo origen " +
        "como si estuvieran pineados: un asset que falta funciona en esta máquina y en ninguna otra. " +
        "Borralos y volvé a correr `pnpm assets:mirror`:\n" +
        `  rm ${stale.join(" ")}\n`,
    );
  }

  process.stdout.write("Listo.\n");
}

if (isMainModule()) {
  try {
    await main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
