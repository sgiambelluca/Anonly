import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Hash en streaming de un archivo, sin cargarlo entero (el instalador pesa cientos de MB).
 * @param {string} path
 * @param {"sha256" | "sha512"} algorithm
 * @param {"hex" | "base64"} encoding
 */
async function hashFile(path, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) {
    if (!Buffer.isBuffer(chunk)) throw new Error("Expected binary asset contents.");
    hash.update(chunk);
  }
  return hash.digest(encoding);
}

/**
 * Nombre que electron-builder le da a un archivo en sus manifiestos (ADR-198 §1):
 * cada espacio pasa a guion. El `.blockmap` sigue a su instalador porque el
 * actualizador lo pide como el nombre del instalador más `.blockmap`.
 * @param {string} name
 */
function publishedName(name) {
  return name.replaceAll(" ", "-");
}

/** @param {string} value */
function unquote(value) {
  const text = value.trim();
  const quote = text[0];
  if (text.length >= 2 && (quote === '"' || quote === "'") && text.endsWith(quote)) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Último segmento de una URL o ruta: el nombre del archivo que el manifiesto pide.
 * @param {string} reference
 */
function baseName(reference) {
  const withoutQuery = reference.split(/[?#]/, 1)[0] ?? "";
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
}

/**
 * Lee `latest.yml` / `latest-mac.yml` con expresiones acotadas a las líneas que
 * hacen falta (ADR-198 §3). Sin parser de YAML: si una línea no se entiende, falla.
 * @param {string} text
 * @param {string} label
 * @returns {{ files: { name: string; sha512?: string; size?: number }[]; path: string; signedFile?: string }}
 */
export function readYamlManifest(text, label) {
  /** @type {{ name: string; sha512?: string; size?: number }[]} */
  const files = [];
  let path;
  let signedFile;
  let hasSignature = false;
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const top = /^([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(raw);
    if (top) {
      section = top[1] ?? "";
      if (section === "anonlyEd25519") hasSignature = true;
      if (section === "path") path = baseName(unquote(top[2] ?? ""));
      continue;
    }
    if (section === "files") {
      const entry = /^\s*-\s+url:\s*(\S.*)$/.exec(raw);
      if (entry) {
        files.push({ name: baseName(unquote(entry[1] ?? "")) });
        continue;
      }
      const current = files[files.length - 1];
      const sha = /^\s+sha512:\s*(\S.*)$/.exec(raw);
      const size = /^\s+size:\s*(\d+)\s*$/.exec(raw);
      if (current && sha) current.sha512 = unquote(sha[1] ?? "");
      else if (current && size) current.size = Number(size[1]);
      else if (current && /^\s+[A-Za-z][A-Za-z0-9]*:/.test(raw)) continue;
      else throw new Error(`${label}: línea de "files" no reconocida.`);
    } else if (section === "anonlyEd25519") {
      const file = /^\s+file:\s*(\S.*)$/.exec(raw);
      if (file) signedFile = baseName(unquote(file[1] ?? ""));
    }
  }
  if (files.length === 0) throw new Error(`${label}: no nombra ningún archivo en "files".`);
  if (path === undefined || path === "") throw new Error(`${label}: falta "path".`);
  if (hasSignature && (signedFile === undefined || signedFile === "")) {
    throw new Error(`${label}: el bloque anonlyEd25519 no tiene un "file" legible.`);
  }
  return { files, path, ...(signedFile === undefined ? {} : { signedFile }) };
}

/**
 * Nombres de archivo de cada `enclosure` del appcast.
 * @param {string} text
 */
export function readAppcastNames(text) {
  const names = [...text.matchAll(/<enclosure\b[^>]*?\burl="([^"]+)"/g)].map((match) =>
    decodeURIComponent(baseName(match[1] ?? "")),
  );
  if (names.length === 0) throw new Error("appcast.xml: no tiene ningún enclosure.");
  return names;
}

/**
 * Comprueba que cada archivo que un manifiesto nombra existe con ese nombre
 * exacto en el conjunto a publicar (ADR-198 §2), y que `latest.yml` declara el
 * sha512 y el tamaño reales. Un manifiesto ausente no es un error de acá.
 * @param {string} directory
 * @param {ReadonlyMap<string, string>} publishedToCurrent nombre publicado -> nombre actual en disco
 */
async function verifyManifests(directory, publishedToCurrent) {
  /** @param {string} name @param {string} source */
  const requirePublished = (name, source) => {
    if (!publishedToCurrent.has(name)) {
      throw new Error(`${source} nombra "${name}", que no está en los archivos a publicar.`);
    }
  };
  /** @param {string} manifest */
  const read = async (manifest) => {
    const current = publishedToCurrent.get(manifest);
    return current === undefined ? undefined : readFile(join(directory, current), "utf8");
  };

  const windows = await read("latest.yml");
  if (windows !== undefined) {
    const parsed = readYamlManifest(windows, "latest.yml");
    for (const file of parsed.files) {
      requirePublished(file.name, "latest.yml");
      if (file.sha512 === undefined || file.size === undefined) {
        throw new Error(`latest.yml: a "${file.name}" le falta sha512 o size.`);
      }
      const path = join(directory, publishedToCurrent.get(file.name) ?? file.name);
      if ((await stat(path)).size !== file.size) {
        throw new Error(`latest.yml: el tamaño de "${file.name}" no coincide con el archivo.`);
      }
      if ((await hashFile(path, "sha512", "base64")) !== file.sha512) {
        throw new Error(`latest.yml: el sha512 de "${file.name}" no coincide con el archivo.`);
      }
    }
    requirePublished(parsed.path, "latest.yml (path)");
    if (parsed.signedFile !== undefined) requirePublished(parsed.signedFile, "anonlyEd25519.file");
  }

  const mac = await read("latest-mac.yml");
  if (mac !== undefined) {
    const parsed = readYamlManifest(mac, "latest-mac.yml");
    for (const file of parsed.files) requirePublished(file.name, "latest-mac.yml");
    requirePublished(parsed.path, "latest-mac.yml (path)");
  }

  const appcast = await read("appcast.xml");
  if (appcast !== undefined) {
    for (const name of readAppcastNames(appcast)) requirePublished(name, "appcast.xml");
  }
}

/**
 * Valida el conjunto completo antes de tocar nada: nombres, colisiones y
 * manifiestos. No renombra ni escribe.
 * @param {string} directory
 */
async function planReleaseAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("Only regular release files are allowed.");
  }
  const files = entries.filter((entry) => entry.name !== "SHA256SUMS.txt");
  if (files.length === 0) throw new Error("No release assets found.");
  const names = new Set();
  const planned = files.map((entry) => {
    const name = publishedName(entry.name);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new Error("Unsupported release asset filename.");
    }
    if (name.toLowerCase() === "sha256sums.txt") {
      throw new Error("The hash manifest filename is reserved.");
    }
    if (names.has(name.toLowerCase())) {
      throw new Error("Release asset filenames collide after normalization.");
    }
    names.add(name.toLowerCase());
    return { before: entry.name, after: name };
  });
  await verifyManifests(directory, new Map(planned.map((file) => [file.after, file.before])));
  return planned;
}

/**
 * Comprueba el conjunto sin modificarlo (corre también en la ejecución manual).
 * @param {string} directory
 */
export async function checkReleaseAssets(directory) {
  await planReleaseAssets(directory);
}

/**
 * Normalize upload names before hashing, without changing signed contents.
 * @param {string} directory
 */
export async function prepareReleaseAssets(directory) {
  const planned = await planReleaseAssets(directory);
  // El conjunto completo ya se validó arriba; recién ahora se renombra.
  for (const file of planned) {
    if (file.before !== file.after) {
      await rename(join(directory, file.before), join(directory, file.after));
    }
  }
  const rows = [];
  for (const file of planned.sort((left, right) => left.after.localeCompare(right.after, "en"))) {
    rows.push(`${await hashFile(join(directory, file.after), "sha256", "hex")}  ${file.after}`);
  }
  await writeFile(join(directory, "SHA256SUMS.txt"), rows.join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const directory = check ? args[1] : args[0];
  if (args.length !== (check ? 2 : 1) || !directory) {
    throw new Error("Usage: prepare-release-assets.mjs [--check] DIRECTORY");
  }
  if (check) await checkReleaseAssets(resolve(directory));
  else await prepareReleaseAssets(resolve(directory));
}
