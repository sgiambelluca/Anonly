/**
 * Plugin de Vite que emite `licenses/THIRD_PARTY_LICENSES.txt` en el `dist`
 * (ADR-196 §1 a §3). La lógica pura vive en `third-party-licenses.ts`; acá solo
 * está el pegamento con Rollup y el disco.
 *
 * Cuatro fuentes, todas obligatorias (ADR-196 §2, §2quater):
 *  1. los paquetes de `node_modules` que **entran de verdad** a los bundles
 *     (el principal y los de los workers; no el árbol declarado);
 *  2. el cierre transitivo de `dependencies` de `apps/desktop-shell`;
 *  3. la tabla a mano de lo que no pasa por el bundle (`ASSET_FAMILIES`);
 *  4. lo que llega compilado dentro de otro paquete (`EMBEDDING_HOSTS`) y los
 *     avisos que el propio artefacto trae junto a sí.
 *
 * Si algo falta o no está admitido, el build falla **sin** generar el archivo
 * (§3).
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, Rollup } from "vite";

import {
  ASSET_FAMILIES,
  EMBEDDING_HOSTS,
  collectEmptyTextProblems,
  collectHostProblems,
  collectProblems,
  createBundleRegistry,
  findBackupForName,
  isLicenseFileName,
  isNoticeFileName,
  readAuthorField,
  readLicenseField,
  readRepositoryField,
  renderDeclaredOnlyText,
  renderLicenseFile,
  type DeclaredMeta,
  type LicenseEntry,
  type PackageInfo,
  type StaticComponent,
  type StaticVersion,
  type TextFile,
} from "./third-party-licenses.js";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(APP_ROOT, "..", "..");
const OUTPUT_FILE = "licenses/THIRD_PARTY_LICENSES.txt";

type JsonRecord = Readonly<Record<string, unknown>>;

function readJson(path: string): JsonRecord | null {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return typeof parsed === "object" && parsed !== null ? (parsed as JsonRecord) : null;
}

function stringField(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * Carpeta de `name` visible desde `fromDir`, subiendo por `node_modules` como
 * Node (con pnpm, las dependencias de un paquete son hermanas suyas dentro de
 * `.pnpm/<x>/node_modules/`). Devuelve la ruta real, sin symlinks.
 */
function findPackageDir(fromDir: string, name: string): string | null {
  // No se sube más allá de la raíz del repo: un paquete instalado fuera de él
  // no es una dependencia de este proyecto.
  const stop = realpathSync(REPO_ROOT);
  let current = realpathSync(fromDir);
  for (;;) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(current);
    if (current === stop || parent === current) return null;
    current = parent;
  }
}

function readTextFiles(dir: string, matches: (name: string) => boolean): ReadonlyArray<TextFile> {
  return readdirSync(dir)
    .filter((name) => matches(name) && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

function readPackage(dir: string, fallbackName: string): PackageInfo {
  const json = readJson(join(dir, "package.json"));
  return {
    name: stringField(json, "name") ?? fallbackName,
    version: stringField(json, "version") ?? "desconocida",
    license: readLicenseField(json),
    author: readAuthorField(json),
    repository: readRepositoryField(json),
    licenseFiles: readTextFiles(dir, isLicenseFileName),
    noticeFiles: readTextFiles(dir, isNoticeFileName),
  };
}

/**
 * Completa con el texto de respaldo (ADR-196 §2bis) un componente que no trae
 * archivo de licencia. Solo si la fila existe **y** es de esa versión; si no,
 * deja todo como está y `collectProblems` informa la falla.
 */
function withBackup(
  name: string,
  version: string,
  licenseFiles: ReadonlyArray<TextFile>,
  noticeFiles: ReadonlyArray<TextFile>,
  declared: DeclaredMeta,
): {
  readonly licenseFiles: ReadonlyArray<TextFile>;
  readonly noticeFiles: ReadonlyArray<TextFile>;
} {
  if (licenseFiles.length > 0) return { licenseFiles, noticeFiles };
  const backup = findBackupForName(name);
  if (backup === null || backup.version !== version) return { licenseFiles, noticeFiles };
  const read = (file: string): TextFile => {
    const path = join(REPO_ROOT, file);
    return { name: basename(path), text: readFileSync(path, "utf8") };
  };
  if (backup.declaredOnly === true) {
    const standard = read(backup.licenseFile);
    return {
      licenseFiles: [
        {
          name: "texto estándar SPDX (sin texto propio del proyecto)",
          text: renderDeclaredOnlyText(declared, standard.text),
        },
      ],
      noticeFiles,
    };
  }
  return {
    licenseFiles: [read(backup.licenseFile)],
    noticeFiles: backup.noticeFile === undefined ? noticeFiles : [read(backup.noticeFile)],
  };
}

function dependencyNames(dir: string): ReadonlyArray<string> {
  const deps = readJson(join(dir, "package.json"))?.["dependencies"];
  return typeof deps === "object" && deps !== null ? Object.keys(deps) : [];
}

/** Cierre transitivo de `dependencies` de `apps/desktop-shell` (ADR-196 §2.2). */
function desktopShellClosure(): ReadonlyMap<string, string> {
  const shellDir = join(REPO_ROOT, "apps", "desktop-shell");
  const found = new Map<string, string>();
  const pending: Array<{ readonly from: string; readonly name: string }> = dependencyNames(
    shellDir,
  ).map((name) => ({ from: shellDir, name }));
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) break;
    const dir = findPackageDir(next.from, next.name);
    if (dir === null) {
      throw new Error(
        `[third-party-licenses] No se encontró "${next.name}" (dependencia de producción de desktop-shell) desde ${next.from}.`,
      );
    }
    if (found.has(dir)) continue;
    found.set(dir, next.name);
    for (const name of dependencyNames(dir)) pending.push({ from: dir, name });
  }
  return found;
}

function readLockAssetIds(): ReadonlyArray<string> {
  const lock = readJson(join(REPO_ROOT, "assets.lock.json"));
  const assets = lock?.["assets"];
  if (!Array.isArray(assets)) {
    throw new Error("[third-party-licenses] assets.lock.json no tiene la lista `assets`.");
  }
  return assets.map((asset: unknown) => {
    const id = typeof asset === "object" && asset !== null ? (asset as JsonRecord)["id"] : null;
    if (typeof id !== "string") {
      throw new Error("[third-party-licenses] assets.lock.json tiene una entrada sin `id`.");
    }
    return id;
  });
}

function lockRevision(assetId: string): string {
  const lock = readJson(join(REPO_ROOT, "assets.lock.json"));
  const assets = lock?.["assets"];
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (typeof asset !== "object" || asset === null) continue;
      const record = asset as JsonRecord;
      if (record["id"] === assetId && typeof record["revision"] === "string") {
        return record["revision"];
      }
    }
  }
  throw new Error(`[third-party-licenses] assets.lock.json no tiene revisión para "${assetId}".`);
}

function resolveStaticVersion(version: StaticVersion, packageVersion: string | null): string {
  if ("literal" in version) return version.literal;
  if ("lockAssetId" in version) return lockRevision(version.lockAssetId);
  return packageVersion ?? "desconocida";
}

function resolveStaticComponent(component: StaticComponent): LicenseEntry {
  const note = component.note === undefined ? {} : { note: component.note };
  const { source } = component;

  if (source.kind === "repo-file") {
    const path = join(REPO_ROOT, source.file);
    return {
      name: component.name,
      version: resolveStaticVersion(component.version, null),
      license: component.license,
      ...note,
      licenseFiles: [{ name: basename(path), text: readFileSync(path, "utf8") }],
      noticeFiles: [],
    };
  }

  let dir = join(REPO_ROOT, source.from);
  for (const hop of source.via ?? []) {
    const next = findPackageDir(dir, hop);
    if (next === null)
      throw new Error(`[third-party-licenses] No se encontró "${hop}" desde ${dir}.`);
    dir = next;
  }
  const pkgDir = findPackageDir(dir, source.pkg);
  if (pkgDir === null) {
    throw new Error(`[third-party-licenses] No se encontró "${source.pkg}" desde ${dir}.`);
  }
  const info = readPackage(pkgDir, source.pkg);
  const licenseFiles =
    source.files === undefined
      ? info.licenseFiles
      : source.files.map((file) => ({
          name: file,
          text: readFileSync(join(pkgDir, file), "utf8"),
        }));
  return {
    name: component.name,
    version: resolveStaticVersion(component.version, info.version),
    license: component.license,
    ...note,
    licenseFiles,
    noticeFiles: source.files === undefined ? info.noticeFiles : [],
  };
}

/**
 * Avisos que el artefacto trae junto a sí y componentes embebidos (ADR-196
 * §2quater). Agrega los avisos al componente anfitrión y una entrada por cada
 * embebido; las fallas van a `problems`.
 */
function addEmbeddedEntries(entries: LicenseEntry[], problems: string[]): void {
  const installed = new Map<string, string | null>();
  const hostDirs = new Map<string, string>();
  for (const host of EMBEDDING_HOSTS) {
    const dir = findPackageDir(join(REPO_ROOT, host.from), host.name);
    installed.set(host.name, dir === null ? null : readPackage(dir, host.name).version);
    if (dir !== null) hostDirs.set(host.name, dir);
  }
  problems.push(...collectHostProblems(installed));

  for (const host of EMBEDDING_HOSTS) {
    const dir = hostDirs.get(host.name);
    if (dir === undefined || installed.get(host.name) !== host.version) continue;

    const index = entries.findIndex((e) => e.name === host.name && e.version === host.version);
    const hostEntry = entries[index];
    if (hostEntry === undefined) {
      problems.push(`${host.name}@${host.version}: el anfitrión no figura entre los componentes.`);
    } else {
      const extra: TextFile[] = [];
      for (const relative of host.artifactNotices) {
        const path = join(dir, relative);
        if (!existsSync(path)) {
          problems.push(`${host.name}@${host.version}: falta el archivo de avisos ${relative}.`);
          continue;
        }
        extra.push({ name: relative, text: readFileSync(path, "utf8") });
      }
      const known = new Set(hostEntry.noticeFiles.map((file) => file.name));
      entries[index] = {
        ...hostEntry,
        noticeFiles: [...hostEntry.noticeFiles, ...extra.filter((file) => !known.has(file.name))],
      };
    }

    for (const embedded of host.embedded) {
      const embeddedDir = findPackageDir(dir, embedded.name);
      const info = embeddedDir === null ? null : readPackage(embeddedDir, embedded.name);
      const version = embedded.embeddedVersion ?? info?.version;
      if (version === undefined) {
        problems.push(
          `${embedded.name} (embebido en ${host.name}): no está instalado y la tabla no fija su versión.`,
        );
        continue;
      }
      if (info !== null && info.license !== null && info.license !== embedded.license) {
        problems.push(
          `${embedded.name}@${info.version}: declara "${info.license}" y la tabla de embebidos dice "${embedded.license}".`,
        );
      }
      const notes = [`Embebido, ya compilado, en ${host.name}@${host.version}.`];
      // De dónde sale la versión (ADR-196 §2quater): verificada en el artefacto,
      // declarada por la tabla del anfitrión, o asumida la del paquete instalado.
      if (embedded.versionVerifiedInArtifact === true) {
        notes.push(
          `Versión ${version}: verificada en el artefacto (un comentario suyo nombra la ruta del paquete).`,
        );
      } else if (embedded.embeddedVersion !== undefined) {
        const missing = info === null ? " (el paquete no está instalado)" : "";
        notes.push(
          `Versión ${version}: la declara la tabla del anfitrión${missing}; no se pudo verificar contra el artefacto.`,
        );
      } else {
        notes.push(
          `Versión ${version}: se asume la del paquete instalado; no se pudo verificar contra el artefacto.`,
        );
      }
      if (info !== null && info.version !== version) {
        notes.push(
          `El texto de licencia es el del paquete instalado ${embedded.name}@${info.version}.`,
        );
      }
      const withText = withBackup(
        embedded.name,
        version,
        info?.licenseFiles ?? [],
        info?.noticeFiles ?? [],
        {
          license: embedded.license,
          author: info?.author ?? null,
          repository: info?.repository ?? null,
        },
      );
      if (withText.licenseFiles.length === 0) {
        problems.push(
          `${embedded.name}@${version} (embebido en ${host.name}): no tiene archivo de licencia ni fila de respaldo de esa versión.`,
        );
      }
      entries.push({
        name: embedded.name,
        version,
        license: embedded.license,
        note: notes.join(" "),
        ...withText,
      });
    }
  }
}

/**
 * Plugin de licencias. `main` va en `plugins` y emite el archivo; `worker` va
 * en `worker.plugins` y solo registra lo que entra a cada bundle de worker
 * (los workers se construyen aparte y no pasan por los hooks del principal).
 * Los dos comparten el mismo registro.
 */
export function thirdPartyLicenses(): { readonly main: Plugin; readonly worker: () => Plugin[] } {
  const registry = createBundleRegistry();

  const worker = (): Plugin[] => [
    {
      name: "anonly:third-party-licenses-worker",
      apply: "build",
      generateBundle(_options, bundle: Rollup.OutputBundle) {
        registry.collect(bundle);
      },
    },
  ];

  const main: Plugin = {
    name: "anonly:third-party-licenses",
    apply: "build",
    generateBundle(_options, bundle: Rollup.OutputBundle) {
      registry.collect(bundle);

      const packages = new Map<string, PackageInfo>(); // dir real -> info
      for (const [dir, name] of registry.bundled) {
        const real = existsSync(dir) ? realpathSync(dir) : dir;
        packages.set(real, readPackage(real, name));
      }
      for (const [dir, name] of desktopShellClosure()) {
        if (!packages.has(dir)) packages.set(dir, readPackage(dir, name));
      }

      const lockIds = readLockAssetIds();
      const problems = [...collectProblems([...packages.values()], lockIds)];

      const entries: LicenseEntry[] = [...packages.values()].map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? "",
        ...withBackup(pkg.name, pkg.version, pkg.licenseFiles, pkg.noticeFiles, {
          license: pkg.license,
          author: pkg.author ?? null,
          repository: pkg.repository ?? null,
        }),
      }));
      for (const family of ASSET_FAMILIES) {
        for (const component of family.components) {
          const resolved = resolveStaticComponent(component);
          const entry = {
            ...resolved,
            ...withBackup(
              resolved.name,
              resolved.version,
              resolved.licenseFiles,
              resolved.noticeFiles,
              { license: resolved.license, author: null, repository: null },
            ),
          };
          if (entry.licenseFiles.length === 0) {
            problems.push(
              `${entry.name}@${entry.version}: no tiene archivo de licencia ni fila de respaldo de esa versión (ADR-196 §2bis).`,
            );
          }
          entries.push(entry);
        }
      }

      addEmbeddedEntries(entries, problems);
      problems.push(...collectEmptyTextProblems(entries));

      if (problems.length > 0) {
        this.error(
          `Licencias de terceros (ADR-196 §3):\n${[...new Set(problems)].map((p) => `  - ${p}`).join("\n")}`,
        );
      }

      this.emitFile({
        type: "asset",
        fileName: OUTPUT_FILE,
        source: renderLicenseFile(entries),
      });
    },
  };

  return { main, worker };
}
