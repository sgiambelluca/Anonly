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
  it.each(["high", "critical"])(
    "counts multiple findings for a single unresolved %s advisory",
    (severity) => {
      const other = {
        ...advisory,
        module_name: "sharp",
        github_advisory_id: "GHSA-other",
        severity,
        findings: [{ version: "0.35.4" }, { version: "0.35.4" }],
      };
      const result = evaluateAudit(
        report([advisory, other], severity === "high" ? 3 : 1, severity === "critical" ? 2 : 0),
        true,
      );
      expect(result.blocked).toBe(true);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[1]?.locallyFixed).toBe(false);
    },
  );
  it("counts findings rather than the dependency paths within each finding", () => {
    const multiplePaths = {
      ...advisory,
      findings: [{ version: "3.0.3", paths: ["a>braces", "b>braces", "c>braces"] }],
    };
    expect(evaluateAudit(report([multiplePaths]), true).blocked).toBe(false);
    expect(() => evaluateAudit(report([multiplePaths], 3), true)).toThrow(
      "inconsistent vulnerability totals",
    );
  });
  it("accepts multiple patched braces findings only when every resolution is verified", () => {
    const multiple = {
      ...advisory,
      findings: [{ version: "3.0.3" }, { version: "3.0.3" }],
    };
    expect(evaluateAudit(report([multiple], 2), true).blocked).toBe(false);
    expect(evaluateAudit(report([multiple], 2), false).blocked).toBe(true);
    expect(
      evaluateAudit(
        report([{ ...multiple, findings: [{ version: "3.0.3" }, { version: "3.0.2" }] }], 2),
        true,
      ).blocked,
    ).toBe(true);
    expect(() => evaluateAudit(report([multiple]), true)).toThrow(
      "inconsistent vulnerability totals",
    );
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
    report([{ ...advisory, findings: [] }]),
    report([{ ...advisory, findings: [{}] }]),
    report([{ ...advisory, findings: undefined }]),
    report([{ ...advisory, findings: [null] }]),
    report([{ ...advisory, findings: [{ version: 303 }] }]),
    report([{ ...advisory, findings: [{ version: "" }] }]),
    report([], 1),
    report([advisory], 0),
    { advisories: {}, metadata: { vulnerabilities: { high: "0", critical: 0 } } },
  ])("fails closed for malformed or inconsistent audit data: %j", (value) => {
    expect(() => evaluateAudit(value, true)).toThrow();
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid vulnerability counters: %s",
    (count) => {
      expect(() => evaluateAudit(report([], count), true)).toThrow();
      expect(() => evaluateAudit(report([], 0, count), true)).toThrow();
    },
  );
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
