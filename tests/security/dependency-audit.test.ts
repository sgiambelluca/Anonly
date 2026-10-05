import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BRACES_ADVISORY, evaluateAudit } from "../../scripts/security-audit-policy.js";
import {
  verifyBracesBehavior,
  verifyBracesLock,
  verifyBracesPatch,
} from "../../scripts/verify-braces-patch.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const advisory = {
  module_name: "braces",
  github_advisory_id: BRACES_ADVISORY,
  severity: "high",
  cves: ["CVE-2026-93687"],
  findings: [{ version: "3.0.3" }],
};
function report(advisories: ReadonlyArray<unknown>, high = 1, critical = 0): unknown {
  return {
    advisories: Object.fromEntries(advisories.map((value, i) => [i, value])),
    metadata: { vulnerabilities: { high, critical } },
  };
}

describe("security audit policy (ADR-201)", () => {
  it("accepts only the exact advisory after the installed patch has been verified", () => {
    const result = evaluateAudit(report([advisory]), true);
    expect(result.blocked).toBe(false);
    expect(result.findings[0]?.locallyFixed).toBe(true);
  });
  it("blocks the same advisory without verified patch evidence", () => {
    expect(evaluateAudit(report([advisory]), false).blocked).toBe(true);
  });
  it.each([
    { module_name: "other-package" },
    { github_advisory_id: "GHSA-other-advisory" },
    { cves: ["CVE-other"] },
    { cves: [] },
    { cves: ["CVE-2026-93687", "CVE-other"] },
    { findings: [{ version: "3.0.2" }] },
    { findings: [{ version: "3.0.3" }, { version: "3.0.2" }] },
    { findings: [] },
    { findings: [{}] },
    { findings: undefined },
  ])("blocks mismatching advisory or version: %j", (change) => {
    expect(evaluateAudit(report([{ ...advisory, ...change }]), true).blocked).toBe(true);
  });
  it.each(["high", "critical"])("still blocks a different %s advisory", (severity) => {
    const other = { ...advisory, github_advisory_id: "GHSA-other", severity };
    expect(
      evaluateAudit(
        report([advisory, other], severity === "high" ? 2 : 1, severity === "critical" ? 1 : 0),
        true,
      ).blocked,
    ).toBe(true);
  });
  it("accepts a clean audit and preserves the existing high/critical severity threshold", () => {
    expect(evaluateAudit(report([], 0), false).blocked).toBe(false);
    expect(evaluateAudit(report([{ ...advisory, severity: "moderate" }], 0), false).blocked).toBe(
      false,
    );
  });
  it.each([
    null,
    [],
    {},
    { advisories: {}, metadata: {} },
    report([{ ...advisory, severity: "unknown" }]),
    report([{}]),
    report([null]),
    report([{ ...advisory, module_name: null }]),
    report([{ ...advisory, github_advisory_id: null }]),
    report([{ ...advisory, severity: null }]),
    report([], 1),
    report([advisory], 0),
    { advisories: {}, metadata: { vulnerabilities: { high: "0", critical: 0 } } },
  ])("fails closed for malformed or inconsistent audit data: %j", (value) => {
    expect(() => evaluateAudit(value, true)).toThrow();
  });
});

describe("installed braces remediation (ADR-201)", () => {
  it("verifies patch bytes, every lock resolution, installed consumers and exploit regressions", () => {
    expect(() => verifyBracesPatch(root)).not.toThrow();
  });
  it("rejects a lockfile that keeps an unpatched resolution alongside the patched one", () => {
    const lock = {
      patchedDependencies: {
        "braces@3.0.3": {
          hash: "orvbgohcz6onzqdkhlbaumhpzq",
          path: "patches/braces@3.0.3.patch",
        },
      },
      snapshots: { "braces@3.0.3(patch_hash=orvbgohcz6onzqdkhlbaumhpzq)": {}, "braces@3.0.3": {} },
    };
    expect(() => verifyBracesLock(lock)).toThrow("Every braces resolution");
  });
  it.each([{}, { patchedDependencies: {}, snapshots: {} }])(
    "rejects absent patch evidence",
    (lock) => {
      expect(() => verifyBracesLock(lock)).toThrow();
    },
  );
  it("rejects an implementation whose walkers lost the depth guard", () => {
    const load = createRequire(resolve(root, "package.json"));
    const micromatch = createRequire(
      createRequire(load.resolve("lint-staged")).resolve("micromatch"),
    );
    const module: unknown = micromatch("braces");
    expect(typeof module).toBe("function");
    if (typeof module !== "function") throw new Error("Missing installed braces");
    const broken = Object.assign(() => undefined, {
      parse: Reflect.get(module, "parse"),
      compile: () => "unbounded",
    });
    expect(() => verifyBracesBehavior(broken)).toThrow();
  });
});
