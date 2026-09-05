import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { desdeLaRaiz } from "./repoRoot";

const BUILDER = desdeLaRaiz("apps/desktop-shell/electron-builder.yml");
const UNIVERSAL_BRIDGE = desdeLaRaiz(
  "apps/desktop-shell/native/scripts/build-sparkle-universal.sh",
);

describe("empaquetado universal de macOS", () => {
  it("genera un solo target universal para DMG y ZIP", async () => {
    const config = await readFile(BUILDER, "utf8");

    expect(config).toContain("- target: dmg\n      arch: [universal]");
    expect(config).toContain("- target: zip\n      arch: [universal]");
    expect(config).not.toContain("arch: [arm64, x64]");
    expect(config).toContain('x64ArchFiles: "**/sparkle_bridge.node"');
  });

  it("compila y valida los dos slices del bridge antes de lipo", async () => {
    const script = await readFile(UNIVERSAL_BRIDGE, "utf8");

    expect(script).toContain("build_arch arm64");
    expect(script).toContain("build_arch x64");
    expect(script).toContain("lipo -create");
    expect(script).toContain('lipo -archs "$OUTPUT"');
  });
});
