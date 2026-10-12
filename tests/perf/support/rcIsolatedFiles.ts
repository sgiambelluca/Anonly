/** Frozen artifact switching outside all measured windows. Fixed repository paths only. */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { RcArm, RcSourceMode } from "./rcIsolatedTransform.js";
import {
  assertRcRendererIdentity,
  assertRcTransformIdentity,
  requirePersistedRcSourceMode,
  transformRcSource,
} from "./rcIsolatedTransform.js";
export const rcHash = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
export const RC_REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export async function recordRcNormalRenderer(directory: string): Promise<void> {
  await writeFile(
    resolve(directory, "normal-renderer.sha256"),
    (await rcTreeHash(resolve(RC_REPO_ROOT, "apps/react-client/dist"))) + "\n",
  );
}
export async function validateRcSourceMode(sourceMode: RcSourceMode): Promise<void> {
  const source = await readFile(
    resolve(RC_REPO_ROOT, "packages/anonymization-core/ocr-engine/src/ocr.engine.ts"),
    "utf8",
  );
  transformRcSource(source, "A", sourceMode);
  transformRcSource(source, "RC", sourceMode);
}
export async function rcTreeHash(directory: string): Promise<string> {
  const root = resolve(directory);
  const records: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isSymbolicLink()) throw new Error("RC artifact symlink refused");
      if (item.isDirectory()) await walk(path);
      else
        records.push(
          `${relative(root, path).replaceAll("\\", "/")} ${rcHash(await readFile(path))}`,
        );
    }
  }
  await walk(root);
  if (records.length === 0) throw new Error("RC artifact empty");
  return rcHash(records.sort().join("\n"));
}
export async function activateRcBuild(directory: string, arm: RcArm): Promise<void> {
  await verifyRcBuildIdentity(directory);
  if (arm !== "A" && arm !== "RC") throw new Error("RC invalid build arm");
  const source = resolve(directory, "arms", arm);
  const allowed = resolve(directory, "arms") + sep;
  const target = resolve(RC_REPO_ROOT, "apps/react-client/dist");
  if (
    !source.startsWith(allowed) ||
    !target.startsWith(resolve(RC_REPO_ROOT) + sep) ||
    relative(resolve(RC_REPO_ROOT), target).replaceAll("\\", "/") !== "apps/react-client/dist"
  )
    throw new Error("RC artifact boundary mismatch");
  const identity = JSON.parse(
    await readFile(resolve(directory, "build-identity.json"), "utf8"),
  ) as { arms: Record<RcArm, string> };
  if ((await rcTreeHash(source)) !== identity.arms[arm])
    throw new Error("RC frozen artifact mismatch");
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  if ((await rcTreeHash(target)) !== identity.arms[arm])
    throw new Error("RC active artifact mismatch");
}
export async function verifyRcBuildIdentity(directory: string): Promise<void> {
  const identity = JSON.parse(
    await readFile(resolve(directory, "build-identity.json"), "utf8"),
  ) as {
    arms: Record<RcArm, string>;
    shellSha256: string;
    files: Record<string, string>;
    sourceMode: RcSourceMode;
    normalRendererSha256: string;
  };
  const sourceMode = requirePersistedRcSourceMode(identity.sourceMode);
  if (
    (await readFile(resolve(directory, "source-mode.txt"), "utf8")).trim() !== sourceMode ||
    (await readFile(resolve(directory, "normal-renderer.sha256"), "utf8")).trim() !==
      identity.normalRendererSha256
  )
    throw new Error("RC build mode identity mismatch");
  const source = await readFile(
    resolve(RC_REPO_ROOT, "packages/anonymization-core/ocr-engine/src/ocr.engine.ts"),
    "utf8",
  );
  for (const file of [
    "tests/perf/rc-isolated.vite.config.ts",
    "tests/perf/support/rcIsolatedTransform.ts",
    "tests/perf/support/rcIsolatedBuildCli.ts",
    "tests/perf/support/rcIsolatedFiles.ts",
    "tests/perf/run-rc-isolated.sh",
    "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
  ]) {
    if (rcHash(await readFile(resolve(RC_REPO_ROOT, file))) !== identity.files[file])
      throw new Error("RC frozen source mismatch");
  }
  for (const arm of ["A", "RC"] as const) {
    if ((await rcTreeHash(resolve(directory, "arms", arm))) !== identity.arms[arm])
      throw new Error("RC frozen artifact mismatch");
    const transformation = JSON.parse(
      await readFile(resolve(directory, `transform-${arm}.json`), "utf8"),
    ) as unknown;
    assertRcTransformIdentity(transformation, source, arm, sourceMode);
  }
  assertRcRendererIdentity(sourceMode, identity.normalRendererSha256, identity.arms.RC);
  if ((await rcTreeHash(resolve(directory, "frozen-shell"))) !== identity.shellSha256)
    throw new Error("RC frozen shell mismatch");
}
export async function writeRcBuildIdentity(
  directory: string,
  sourceMode: RcSourceMode,
): Promise<void> {
  if ((await readFile(resolve(directory, "source-mode.txt"), "utf8")).trim() !== sourceMode)
    throw new Error("RC build mode identity mismatch");
  const arms = {
    A: await rcTreeHash(resolve(directory, "arms/A")),
    RC: await rcTreeHash(resolve(directory, "arms/RC")),
  };
  const files = [
    "tests/perf/rc-isolated.vite.config.ts",
    "tests/perf/support/rcIsolatedTransform.ts",
    "tests/perf/support/rcIsolatedBuildCli.ts",
    "tests/perf/support/rcIsolatedFiles.ts",
    "tests/perf/run-rc-isolated.sh",
    "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
  ];
  const normalRendererSha256 = (
    await readFile(resolve(directory, "normal-renderer.sha256"), "utf8")
  ).trim();
  assertRcRendererIdentity(sourceMode, normalRendererSha256, arms.RC);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "build-identity.json"),
    JSON.stringify(
      {
        schema: 1,
        sourceMode,
        normalRendererSha256,
        arms,
        shellSha256: await rcTreeHash(resolve(RC_REPO_ROOT, "apps/desktop-shell/dist")),
        originalClientSha256: await rcTreeHash(resolve(directory, "dist-original")),
        originalShellSha256: await rcTreeHash(resolve(directory, "shell-dist-original")),
        files: Object.fromEntries(
          await Promise.all(
            files.map(async (file) => [file, rcHash(await readFile(resolve(RC_REPO_ROOT, file)))]),
          ),
        ),
      },
      null,
      2,
    ),
  );
}
export async function activateRcShell(directory: string): Promise<void> {
  const identity = JSON.parse(
    await readFile(resolve(directory, "build-identity.json"), "utf8"),
  ) as { shellSha256: string };
  const source = resolve(directory, "frozen-shell");
  const target = resolve(RC_REPO_ROOT, "apps/desktop-shell/dist");
  if (
    !target.startsWith(resolve(RC_REPO_ROOT) + sep) ||
    relative(resolve(RC_REPO_ROOT), target).replaceAll("\\", "/") !== "apps/desktop-shell/dist"
  )
    throw new Error("RC shell boundary mismatch");
  if ((await rcTreeHash(source)) !== identity.shellSha256)
    throw new Error("RC frozen shell mismatch");
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  if ((await rcTreeHash(target)) !== identity.shellSha256)
    throw new Error("RC activated shell mismatch");
}
export async function restoreRcBuilds(directory: string): Promise<void> {
  const identity = JSON.parse(
    await readFile(resolve(directory, "build-identity.json"), "utf8"),
  ) as { originalClientSha256: string; originalShellSha256: string };
  for (const [name, backup, hash] of [
    ["react-client", "dist-original", identity.originalClientSha256],
    ["desktop-shell", "shell-dist-original", identity.originalShellSha256],
  ] as const) {
    const target = resolve(RC_REPO_ROOT, "apps", name, "dist");
    if (
      !target.startsWith(resolve(RC_REPO_ROOT) + sep) ||
      relative(resolve(RC_REPO_ROOT), target).replaceAll("\\", "/") !== `apps/${name}/dist`
    )
      throw new Error("RC restore boundary mismatch");
    const source = resolve(directory, backup);
    if ((await rcTreeHash(source)) !== hash) throw new Error("RC original artifact mismatch");
    await rm(target, { recursive: true, force: true });
    await cp(source, target, { recursive: true });
    if ((await rcTreeHash(target)) !== hash) throw new Error("RC restored artifact mismatch");
  }
  await writeFile(
    resolve(directory, "cleanup.json"),
    JSON.stringify({ clientRestored: true, shellRestored: true }),
  );
}
