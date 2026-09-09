import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareReleaseAssets } from "./prepare-release-assets.mjs";

/** @param {import("node:test").TestContext} t */
async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "anonly-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

await test("hashes use published names and preserve installer and manifest bytes", async (t) => {
  const directory = await temporaryDirectory(t);
  const installer = Buffer.from([0, 10, 255, 3]);
  const manifest = "path: Anonly Setup 0.9.2.exe\nanonlyEd25519: unchanged\n";
  await writeFile(join(directory, "Anonly Setup 0.9.2.exe"), installer);
  await writeFile(join(directory, "latest.yml"), manifest);
  await prepareReleaseAssets(directory);
  assert.deepEqual(await readFile(join(directory, "Anonly.Setup.0.9.2.exe")), installer);
  assert.equal(await readFile(join(directory, "latest.yml"), "utf8"), manifest);
  const hashes = await readFile(join(directory, "SHA256SUMS.txt"), "utf8");
  assert.equal(hashes.trim().split("\n").length, 2);
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
  await writeFile(join(directory, "Anonly.Setup.exe"), "two");
  await assert.rejects(prepareReleaseAssets(directory), /collide/);
  assert.equal(await readFile(join(directory, "Anonly Setup.exe"), "utf8"), "one");
  assert.equal(await readFile(join(directory, "Anonly.Setup.exe"), "utf8"), "two");
  assert.equal((await readdir(directory)).length, 2);
});

await test("empty or unsafe asset sets are rejected", async (t) => {
  const directory = await temporaryDirectory(t);
  await assert.rejects(prepareReleaseAssets(directory), /No release assets/);
  await writeFile(join(directory, "bad\nname.exe"), "data");
  await assert.rejects(prepareReleaseAssets(directory), /Unsupported/);
});

await test("normalization cannot overwrite the hash manifest", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, "SHA256SUMS txt"), "must not be overwritten");
  await assert.rejects(prepareReleaseAssets(directory), /reserved/);
  assert.equal(
    await readFile(join(directory, "SHA256SUMS txt"), "utf8"),
    "must not be overwritten",
  );
});
