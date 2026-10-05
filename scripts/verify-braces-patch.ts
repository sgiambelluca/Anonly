import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { parse } from "yaml";

const PATCH_ID = "orvbgohcz6onzqdkhlbaumhpzq";
const PATCH_FILE = "patches/braces@3.0.3.patch";
const PATCH_SHA256 = "bfdb0c171556074c2785f98d0a7355209223df8e29dbc2ff489240c16a47da97";
// Upstream PR #72, commit 28d440b5dd449dbf1fe6f3506cf94ecca4d02660 (ADR-201).
const FILE_HASHES = {
  "lib/compile.js": "b651f7715e6db8942ce61d3394357b4d81c8ece88240aa31a458ea1165edd195",
  "lib/constants.js": "f9fb688959232eee3e6ad7906a5b0e3234815db49ee857ef86983d65b917dc7c",
  "lib/expand.js": "7ea3e14c2b2b256ef244fd3d83b8fcaa20aa2232b4e6d768c3bb6ab567f66cf5",
  "lib/parse.js": "72aabaadaa555cdfbd07fbd7c7f743373e4dc8eec04a97550cc57bbeec30eb6c",
  "lib/stringify.js": "49dc2d8bafa74f34715a18a845bcb82ce66caaf3bab4cf117998e06b1f9a50a9",
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function verifyBracesLock(lock: unknown): void {
  assert(
    record(lock) && record(lock.patchedDependencies) && record(lock.snapshots),
    "Missing patch or snapshots in lockfile",
  );
  const patch = lock.patchedDependencies["braces@3.0.3"];
  assert(
    record(patch) && patch.hash === PATCH_ID && patch.path === PATCH_FILE,
    "Unexpected braces patch in lockfile",
  );
  assert.deepEqual(
    Object.keys(lock.snapshots).filter((key) => key.startsWith("braces@")),
    [`braces@3.0.3(patch_hash=${PATCH_ID})`],
    "Every braces resolution must use the reviewed patch",
  );
}

export function verifyBracesFiles(packageDirectory: string): void {
  const metadata: unknown = JSON.parse(
    readFileSync(resolve(packageDirectory, "package.json"), "utf8"),
  );
  assert(
    record(metadata) && metadata.name === "braces" && metadata.version === "3.0.3",
    "Unexpected installed braces version",
  );
  for (const [file, expected] of Object.entries(FILE_HASHES)) {
    assert.equal(
      sha256(resolve(packageDirectory, file)),
      expected,
      `Unverified braces file: ${file}`,
    );
  }
}

export function verifyBracesBehavior(module: unknown): void {
  assert.equal(typeof module, "function");
  const call = (method: string, ...args: unknown[]): unknown => {
    assert(typeof module === "function");
    const fn: unknown = Reflect.get(module, method);
    assert(typeof fn === "function", `Missing braces.${method}`);
    const result: unknown = Reflect.apply(fn, module, args);
    return result;
  };
  const nested = (depth: number): string => "{".repeat(depth) + "a" + "}".repeat(depth);
  for (const method of ["parse", "compile", "expand", "stringify"]) {
    assert.doesNotThrow(() => call(method, nested(100)));
    assert.throws(() => call(method, nested(101)), /exceeds max depth/);
    assert.throws(() => call(method, nested(4500)), /exceeds max depth/);
    assert.throws(() => call(method, nested(101), { maxDepth: 10_000 }), /exceeds max depth/);
    assert.throws(() => call(method, "((a))", { maxDepth: 1.5 }), /exceeds max depth/);
  }
  assert.deepEqual(call("expand", "src/{one,two}.ts"), ["src/one.ts", "src/two.ts"]);
  assert.equal(call("compile", "src/{one,two}.ts"), "src/(one|two).ts");
  assert.equal(call("stringify", "{a,{b}}", { escapeInvalid: true }), "{a,{b}}");
  assert.deepEqual(call("expand", "foo/({a,b})"), ["foo/(a)", "foo/(b)"]);
  let ast: object = { type: "text", value: "a" };
  for (let i = 0; i < 101; i++) ast = { type: "brace", nodes: [ast] };
  for (const method of ["compile", "expand", "stringify"]) {
    assert.throws(() => call(method, { type: "root", nodes: [ast] }), /exceeds max depth/);
  }
  const cyclic: { type: string; nodes: object[]; parent?: object } = {
    type: "paren",
    nodes: [{ type: "text", value: "a" }],
  };
  cyclic.parent = cyclic;
  assert.throws(
    () =>
      runInNewContext(
        "expand(ast)",
        {
          expand: (value: unknown): unknown => call("expand", value),
          ast: cyclic,
        },
        { timeout: 250 },
      ),
    /parent chain contains a cycle/,
  );
}

export function verifyBracesPatch(root: string): void {
  const lock: unknown = parse(readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8"));
  verifyBracesLock(lock);
  assert.equal(sha256(resolve(root, PATCH_FILE)), PATCH_SHA256, "Unreviewed braces patch bytes");
  const rootRequire = createRequire(resolve(root, "package.json"));
  const appRequire = createRequire(resolve(root, "apps/react-client/package.json"));
  const chains = [
    { loader: rootRequire, packages: ["lint-staged", "micromatch"] },
    { loader: rootRequire, packages: ["@changesets/cli", "@changesets/config", "micromatch"] },
    { loader: appRequire, packages: ["tailwindcss", "micromatch"] },
    { loader: appRequire, packages: ["tailwindcss", "chokidar"] },
  ];
  const directories = new Set<string>();
  for (const chain of chains) {
    let loader = chain.loader;
    for (const name of chain.packages) loader = createRequire(loader.resolve(name));
    const entry = loader.resolve("braces");
    directories.add(dirname(entry));
  }
  for (const directory of directories) {
    verifyBracesFiles(directory);
    const module: unknown = rootRequire(resolve(directory, "index.js"));
    verifyBracesBehavior(module);
  }
}
