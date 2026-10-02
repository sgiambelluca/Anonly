import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkReleaseAssets, prepareReleaseAssets } from "./prepare-release-assets.mjs";

/** @param {import("node:test").TestContext} t */
async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "anonly-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * `latest.yml` con la forma que genera electron-builder más la extensión Ed25519.
 * @param {string} name
 * @param {Buffer} bytes
 * @param {{ signedFile?: string; sha512?: string; size?: number }} [overrides]
 */
function windowsManifest(name, bytes, overrides = {}) {
  const sha512 = overrides.sha512 ?? createHash("sha512").update(bytes).digest("base64");
  const size = overrides.size ?? bytes.length;
  return [
    "version: 1.0.0",
    "files:",
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-10-02T03:27:58.169Z'",
    "anonlyEd25519:",
    "  schema: 1",
    '  keyId: "abc"',
    `  file: ${JSON.stringify(overrides.signedFile ?? name)}`,
    `  sha512: ${JSON.stringify(sha512)}`,
    '  signature: "firma"',
    "",
  ].join("\n");
}

const installer = Buffer.from([0, 10, 255, 3]);

await test("hashes use published names and preserve installer and manifest bytes", async (t) => {
  const directory = await temporaryDirectory(t);
  const manifest = windowsManifest("Anonly-Setup-1.0.0.exe", installer);
  await writeFile(join(directory, "Anonly Setup 1.0.0.exe"), installer);
  await writeFile(join(directory, "Anonly Setup 1.0.0.exe.blockmap"), "map");
  await writeFile(join(directory, "latest.yml"), manifest);
  await prepareReleaseAssets(directory);
  assert.deepEqual(await readFile(join(directory, "Anonly-Setup-1.0.0.exe")), installer);
  assert.equal(await readFile(join(directory, "Anonly-Setup-1.0.0.exe.blockmap"), "utf8"), "map");
  assert.equal(await readFile(join(directory, "latest.yml"), "utf8"), manifest);
  assert.ok(
    !(await readdir(directory)).some((name) => name.includes(" ") || name.includes("Setup.")),
  );
  const hashes = await readFile(join(directory, "SHA256SUMS.txt"), "utf8");
  assert.equal(hashes.trim().split("\n").length, 3);
  for (const row of hashes.trim().split("\n")) {
    const [expected, filename] = row.split("  ");
    assert.ok(expected && filename);
    const actual = createHash("sha256")
      .update(await readFile(join(directory, filename)))
      .digest("hex");
    assert.equal(actual, expected);
  }
  await prepareReleaseAssets(directory);
  assert.equal(await readFile(join(directory, "SHA256SUMS.txt"), "utf8"), hashes);
});

await test("colliding upload names fail before modifying any files", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "Anonly Setup.exe"), "one");
  await writeFile(join(directory, "Anonly-Setup.exe"), "two");
  await assert.rejects(prepareReleaseAssets(directory), /collide/);
  assert.equal(await readFile(join(directory, "Anonly Setup.exe"), "utf8"), "one");
  assert.equal(await readFile(join(directory, "Anonly-Setup.exe"), "utf8"), "two");
  assert.equal((await readdir(directory)).length, 2);
});

await test("empty or unsafe asset sets are rejected", async (t) => {
  const directory = await temporaryDirectory(t);
  await assert.rejects(prepareReleaseAssets(directory), /No release assets/);
  await writeFile(join(directory, "bad;name.exe"), "data");
  await assert.rejects(prepareReleaseAssets(directory), /Unsupported/);
});

await test("normalization cannot overwrite the hash manifest", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "sha256sums.txt"), "must not be overwritten");
  await assert.rejects(prepareReleaseAssets(directory), /reserved/);
  assert.equal(
    await readFile(join(directory, "sha256sums.txt"), "utf8"),
    "must not be overwritten",
  );
});

await test("the 1.0.0 case fails: installer with dots, manifest with dashes", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "Anonly.Setup.1.0.0.exe"), installer);
  await writeFile(
    join(directory, "latest.yml"),
    windowsManifest("Anonly-Setup-1.0.0.exe", installer),
  );
  await assert.rejects(prepareReleaseAssets(directory), /Anonly-Setup-1\.0\.0\.exe.*no está/);
  await assert.rejects(checkReleaseAssets(directory), /no está/);
  // Falló antes de escribir nada.
  assert.ok(!(await readdir(directory)).includes("SHA256SUMS.txt"));
});

await test("a manifest naming a missing file fails (latest.yml path and signed file)", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "Anonly Setup 1.0.0.exe"), installer);
  await writeFile(
    join(directory, "latest.yml"),
    windowsManifest("Anonly-Setup-1.0.0.exe", installer, { signedFile: "Otro.exe" }),
  );
  await assert.rejects(prepareReleaseAssets(directory), /anonlyEd25519\.file.*Otro\.exe/);
});

await test("a wrong sha512 or size in latest.yml fails", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "Anonly Setup 1.0.0.exe"), installer);
  await writeFile(
    join(directory, "latest.yml"),
    windowsManifest("Anonly-Setup-1.0.0.exe", installer, { size: installer.length + 1 }),
  );
  await assert.rejects(checkReleaseAssets(directory), /tamaño/);
  await writeFile(
    join(directory, "latest.yml"),
    windowsManifest("Anonly-Setup-1.0.0.exe", installer, {
      sha512: createHash("sha512").update("otro").digest("base64"),
    }),
  );
  await assert.rejects(checkReleaseAssets(directory), /sha512/);
});

await test("latest-mac.yml and appcast.xml must name published files", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "Anonly-1.0.0-universal.zip"), "zip");
  await writeFile(
    join(directory, "latest-mac.yml"),
    [
      "version: 1.0.0",
      "files:",
      "  - url: Anonly-1.0.0-universal.zip",
      "    sha512: abc",
      "    size: 3",
      "    blockMapSize: 10",
      "path: Anonly-1.0.0-universal.zip",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(directory, "appcast.xml"),
    '<rss><channel><item><enclosure url="https://example.test/dl/v1.0.0/Anonly-1.0.0-universal.zip" length="3"/></item></channel></rss>',
  );
  await checkReleaseAssets(directory);
  await writeFile(
    join(directory, "appcast.xml"),
    '<rss><channel><item><enclosure url="https://example.test/dl/Falta.zip" length="3"/></item></channel></rss>',
  );
  await assert.rejects(checkReleaseAssets(directory), /appcast\.xml.*Falta\.zip/);
});

await test("an unreadable manifest fails instead of guessing", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "latest.yml"), "version: 1.0.0\n");
  await assert.rejects(checkReleaseAssets(directory), /files/);
  await writeFile(join(directory, "latest.yml"), "files:\n  - url: A.exe\n    ???\npath: A.exe\n");
  await assert.rejects(checkReleaseAssets(directory), /no reconocida/);
});

await test("check mode does not modify the directory", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "Anonly Setup 1.0.0.exe"), installer);
  await writeFile(
    join(directory, "latest.yml"),
    windowsManifest("Anonly-Setup-1.0.0.exe", installer),
  );
  await checkReleaseAssets(directory);
  assert.deepEqual((await readdir(directory)).sort(), ["Anonly Setup 1.0.0.exe", "latest.yml"]);
});

await test("an anonlyEd25519 block without a readable file line fails instead of skipping the check", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "Anonly Setup 1.0.0.exe"), installer);
  const sinFile = windowsManifest("Anonly-Setup-1.0.0.exe", installer)
    .split("\n")
    .filter((line) => !line.startsWith("  file:"))
    .join("\n");
  await writeFile(join(directory, "latest.yml"), sinFile);
  await assert.rejects(checkReleaseAssets(directory), /anonlyEd25519.*file/);
  await writeFile(
    join(directory, "latest.yml"),
    windowsManifest("Anonly-Setup-1.0.0.exe", installer).replace(/ {2}file: .*/, "  file: "),
  );
  await assert.rejects(checkReleaseAssets(directory), /anonlyEd25519.*file/);
});
