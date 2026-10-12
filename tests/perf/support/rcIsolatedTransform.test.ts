import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertRcRendererIdentity,
  assertRcTransformIdentity,
  createRcTransformIdentity,
  parseRcSourceMode,
  requirePersistedRcSourceMode,
  RC_ADOPTED_CONTROL,
  RC_ADOPTED_PREDICATE,
  RC_PREDICATE,
  RC_REPLACEMENT,
  transformRcSource,
} from "./rcIsolatedTransform.js";

const adoptedSource = readFileSync(
  "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
  "utf8",
);
const legacySource = adoptedSource.replace(RC_ADOPTED_PREDICATE, RC_PREDICATE);

describe("RC exact isolated transform", () => {
  it("keeps the historical experimental control byte-identical and changes only its predicate", () => {
    expect(transformRcSource(legacySource, "A", "experimental")).toBe(legacySource);
    const changed = transformRcSource(legacySource, "RC", "experimental");
    expect(changed.replace(RC_REPLACEMENT, RC_PREDICATE)).toBe(legacySource);
    expect(changed.split(RC_REPLACEMENT)).toHaveLength(2);
  });

  it("keeps adopted RC byte-identical and removes only its clause for A", () => {
    expect(transformRcSource(adoptedSource, "RC", "adopted")).toBe(adoptedSource);
    const control = transformRcSource(adoptedSource, "A", "adopted");
    expect(control.replace(RC_ADOPTED_CONTROL, RC_ADOPTED_PREDICATE)).toBe(adoptedSource);
    expect(control).not.toContain(RC_ADOPTED_PREDICATE);
  });

  it("rejects missing altered duplicated mixed or wrong-mode source predicates", () => {
    const malformed = [
      adoptedSource.replace(RC_ADOPTED_PREDICATE, "false"),
      adoptedSource.replace("!firstPass.osdHadVerdict &&", "firstPass.osdHadVerdict &&"),
      adoptedSource + RC_ADOPTED_PREDICATE,
      adoptedSource.replace(
        RC_ADOPTED_PREDICATE,
        `${RC_ADOPTED_CONTROL} || ${RC_ADOPTED_PREDICATE}`,
      ),
    ];
    for (const bad of malformed) {
      expect(() => transformRcSource(bad, "A", "adopted")).toThrow(
        "RC predicate identity mismatch",
      );
      expect(() => transformRcSource(bad, "RC", "adopted")).toThrow(
        "RC predicate identity mismatch",
      );
    }
    expect(() => transformRcSource(adoptedSource, "A", "experimental")).toThrow(
      "RC predicate identity mismatch",
    );
    expect(() => transformRcSource(legacySource, "A", "adopted")).toThrow(
      "RC predicate identity mismatch",
    );
    const mixedAdopted = `${adoptedSource}\n      !isRegion &&\n      !firstPass.osdHadVerdict &&\n      ${RC_PREDICATE}`;
    const mixedLegacy = `${legacySource}\n      !isRegion &&\n      !firstPass.osdHadVerdict &&\n      ${RC_ADOPTED_PREDICATE}`;
    expect(() => transformRcSource(mixedAdopted, "RC", "adopted")).toThrow(
      "RC predicate identity mismatch",
    );
    expect(() => transformRcSource(mixedLegacy, "A", "experimental")).toThrow(
      "RC predicate identity mismatch",
    );
  });

  it("uses a closed explicit source-mode enum", () => {
    expect(parseRcSourceMode(undefined)).toBe("experimental");
    expect(parseRcSourceMode("experimental")).toBe("experimental");
    expect(parseRcSourceMode("adopted")).toBe("adopted");
    expect(() => parseRcSourceMode("auto")).toThrow("RC source mode unsupported");
    expect(requirePersistedRcSourceMode("experimental")).toBe("experimental");
    expect(requirePersistedRcSourceMode("adopted")).toBe("adopted");
    for (const absentOrInvalid of [undefined, null, "auto"])
      expect(() => requirePersistedRcSourceMode(absentOrInvalid)).toThrow(
        "RC persisted source mode missing or unsupported",
      );
  });

  it("registers mode and hashes, and rejects a cross-arm or cross-mode identity", () => {
    const identity = createRcTransformIdentity(adoptedSource, "RC", "adopted");
    expect(identity).toMatchObject({ schema: 1, arm: "RC", mode: "adopted", matches: 1 });
    expect(identity.sourceSha256).toBe(identity.transformedSha256);
    expect(() => assertRcTransformIdentity(identity, adoptedSource, "RC", "adopted")).not.toThrow();
    expect(() => assertRcTransformIdentity(identity, adoptedSource, "A", "adopted")).toThrow(
      "RC transform identity mismatch",
    );
    expect(() => assertRcTransformIdentity(identity, adoptedSource, "RC", "experimental")).toThrow(
      "RC transform identity mismatch",
    );
  });

  it("requires adopted RC renderer identity to equal the normal VITE_E2E build", () => {
    const normal = "a".repeat(64);
    expect(() => assertRcRendererIdentity("adopted", normal, normal)).not.toThrow();
    expect(() => assertRcRendererIdentity("adopted", normal, "b".repeat(64))).toThrow(
      "RC renderer identity mismatch",
    );
    expect(() => assertRcRendererIdentity("experimental", normal, "b".repeat(64))).not.toThrow();
    expect(() => assertRcRendererIdentity("adopted", "invalid", normal)).toThrow(
      "RC renderer identity mismatch",
    );
  });
});
