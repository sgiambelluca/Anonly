import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Normalize upload names before hashing, without changing signed contents.
 * @param {string} directory
 */
export async function prepareReleaseAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("Only regular release files are allowed.");
  }
  const files = entries.filter((entry) => entry.name !== "SHA256SUMS.txt");
  if (files.length === 0) throw new Error("No release assets found.");
  const names = new Set();
  const planned = files.map((entry) => {
    const name = entry.name.replaceAll(" ", ".");
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
  // Validate the complete set before renaming any file.
  for (const file of planned) {
    if (file.before !== file.after) {
      await rename(join(directory, file.before), join(directory, file.after));
    }
  }
  const rows = [];
  for (const file of planned.sort((left, right) => left.after.localeCompare(right.after, "en"))) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(join(directory, file.after))) {
      if (!Buffer.isBuffer(chunk)) throw new Error("Expected binary asset contents.");
      hash.update(chunk);
    }
    rows.push(`${hash.digest("hex")}  ${file.after}`);
  }
  await writeFile(join(directory, "SHA256SUMS.txt"), rows.join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (process.argv.length !== 3 || !directory) {
    throw new Error("Usage: prepare-release-assets.mjs DIRECTORY");
  }
  await prepareReleaseAssets(resolve(directory));
}
