/**
 * Campo `identity.commit` de la línea de base (ADR-147 §1, precisión del
 * 2026-10-07). Se comprueba la FORMA, no un valor fijo: el encabezado y la
 * branch cambian con cada commit.
 */
import { execFileSync } from "node:child_process";

import { describe, it, expect } from "vitest";

import { readCommit } from "./identity.js";

describe("readCommit (ADR-147 §1)", () => {
  it("devuelve «<encabezado> (branch <nombre>)» y no un hash", () => {
    const commit = readCommit();

    expect(commit).toMatch(/^.+ \(branch \S+\)$/);
    expect(commit).not.toMatch(/^[0-9a-f]{40}$/);

    const subject = execFileSync("git", ["log", "-1", "--format=%s", "HEAD"], {
      encoding: "utf-8",
    }).trim();
    expect(commit.startsWith(`${subject} (branch `)).toBe(true);
  });
});
