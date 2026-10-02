import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { desdeLaRaiz } from "./repoRoot";

const RELEASE = desdeLaRaiz(".github/workflows/release.yml");

/** El bloque de un paso `- name: <name>`, hasta el paso siguiente. */
function pasoDe(workflow: string, name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {6}- name: /.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

describe("sourcemaps del renderer en release.yml (MVP.md Hito 12)", () => {
  it("los sube como artefacto interno, con nombre que el job release no descarga", async () => {
    const workflow = await readFile(RELEASE, "utf8");
    const step = pasoDe(workflow, "Guardar los sourcemaps del renderer");

    expect(step, "falta el paso de sourcemaps").not.toBe("");
    expect(step).toContain("actions/upload-artifact@");
    expect(step).toContain("path: apps/react-client/dist/**/*.map");
    expect(step).toContain("retention-days: 90");
    expect(step).toContain("if-no-files-found: error");

    const name = /^\s+name: (.+)$/m.exec(step.split("\n").slice(1).join("\n"))?.[1];
    expect(name).toBe("sourcemaps-${{ matrix.platform }}");

    const pattern = /pattern: (\S+)/.exec(workflow)?.[1];
    expect(pattern).toBe("installers-*");
    expect(name?.startsWith("installers-")).toBe(false);
  });
});
