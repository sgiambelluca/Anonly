import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { evaluateAudit } from "./security-audit-policy.js";
import { verifyBracesPatch } from "./verify-braces-patch.js";

try {
  const root = fileURLToPath(new URL("../", import.meta.url));
  // No advisory is accepted until the actual installed patch passes verification.
  verifyBracesPatch(root);
  const audit = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["audit", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (audit.error) throw audit.error;
  if (audit.signal || ![0, 1].includes(audit.status ?? -1)) {
    throw new Error(`Audit failed: ${audit.stdout}\n${audit.stderr}`);
  }
  let report: unknown;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    throw new Error(`Invalid audit response: ${audit.stdout}\n${audit.stderr}`);
  }
  const decision = evaluateAudit(report, true);
  for (const finding of decision.findings) {
    process.stdout.write(
      `${finding.severity}: ${finding.package} ${finding.advisory}` +
        (finding.locallyFixed ? " — local patch verified (ADR-201)\n" : "\n"),
    );
  }
  process.stdout.write(
    decision.blocked
      ? "Unresolved high/critical vulnerabilities\n"
      : "No unresolved high/critical vulnerabilities; braces patch integrity and regression verified\n",
  );
  process.exitCode = decision.blocked ? 1 : 0;
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
