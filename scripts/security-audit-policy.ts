/** The only local remediation accepted by the audit gate (ADR-201). */
export const BRACES_ADVISORY = "GHSA-vfj7-8cjw-p6xm";

interface Finding {
  readonly package: string;
  readonly advisory: string;
  readonly severity: string;
  readonly locallyFixed: boolean;
}

export interface AuditDecision {
  readonly findings: ReadonlyArray<Finding>;
  readonly blocked: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function evaluateAudit(report: unknown, bracesPatchVerified: boolean): AuditDecision {
  if (
    !record(report) ||
    !record(report.advisories) ||
    !record(report.metadata) ||
    !record(report.metadata.vulnerabilities)
  ) {
    throw new Error("Invalid audit response: missing advisories or vulnerability totals");
  }
  const findings: Finding[] = [];
  for (const advisory of Object.values(report.advisories)) {
    if (
      !record(advisory) ||
      typeof advisory.module_name !== "string" ||
      typeof advisory.github_advisory_id !== "string" ||
      typeof advisory.severity !== "string" ||
      !["info", "low", "moderate", "high", "critical"].includes(advisory.severity)
    ) {
      throw new Error("Invalid advisory in audit response");
    }
    const locallyFixed =
      bracesPatchVerified &&
      advisory.module_name === "braces" &&
      advisory.github_advisory_id === BRACES_ADVISORY &&
      advisory.severity === "high" &&
      Array.isArray(advisory.cves) &&
      advisory.cves.length === 1 &&
      advisory.cves[0] === "CVE-2026-93687" &&
      Array.isArray(advisory.findings) &&
      advisory.findings.length > 0 &&
      advisory.findings.every((finding: unknown) => record(finding) && finding.version === "3.0.3");
    findings.push({
      package: advisory.module_name,
      advisory: advisory.github_advisory_id,
      severity: advisory.severity,
      locallyFixed,
    });
  }
  for (const severity of ["high", "critical"] as const) {
    const count = report.metadata.vulnerabilities[severity];
    if (
      typeof count !== "number" ||
      count !== findings.filter((f) => f.severity === severity).length
    ) {
      throw new Error("Invalid audit response: inconsistent vulnerability totals");
    }
  }
  return {
    findings,
    blocked: findings.some(
      (finding) => !finding.locallyFixed && ["high", "critical"].includes(finding.severity),
    ),
  };
}
