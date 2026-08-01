import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  copyDirIdempotent,
  resolvePdfjsRoot,
} from "../../apps/react-client/scripts/copy-pdfjs-assets.js";

describe("copy-pdfjs-assets", () => {
  describe("resolvePdfjsRoot", () => {
    it("resolves the installed pdfjs-dist package directory via module resolution, not a hardcoded path", async () => {
      const root = resolvePdfjsRoot();

      expect(existsSync(join(root, "package.json"))).toBe(true);
      const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8")) as {
        readonly name: string;
      };
      expect(pkg.name).toBe("pdfjs-dist");

      // El path real depende de dónde pnpm haya materializado el paquete
      // (store con hash, ADR-053 §4) — no se asserta contra ese literal.
      // Lo que importa es que trae los dos directorios que
      // copy-pdfjs-assets.ts necesita copiar.
      expect(existsSync(join(root, "cmaps"))).toBe(true);
      expect(existsSync(join(root, "standard_fonts"))).toBe(true);
    });
  });

  describe("copyDirIdempotent", () => {
    let srcDir: string;
    let destDir: string;

    beforeEach(async () => {
      srcDir = await mkdtemp(join(tmpdir(), "anonly-copy-pdfjs-src-"));
      const destParent = await mkdtemp(join(tmpdir(), "anonly-copy-pdfjs-dest-"));
      // No existe todavía: ejercita el mkdir({ recursive: true }) del helper.
      destDir = join(destParent, "pdfjs-out");
    });

    afterEach(async () => {
      await rm(srcDir, { recursive: true, force: true });
      await rm(destDir, { recursive: true, force: true });
    });

    it("copies every file on the first run", async () => {
      await writeFile(join(srcDir, "a.bcmap"), "contenido-a");
      await writeFile(join(srcDir, "b.bcmap"), "contenido-b-mas-largo");

      const outcome = await copyDirIdempotent(srcDir, destDir);

      expect(outcome).toEqual({ copied: 2, skipped: 0 });
      await expect(readFile(join(destDir, "a.bcmap"), "utf-8")).resolves.toBe("contenido-a");
      await expect(readFile(join(destDir, "b.bcmap"), "utf-8")).resolves.toBe(
        "contenido-b-mas-largo",
      );
    });

    it("skips every file on a second run when the destination size still matches", async () => {
      await writeFile(join(srcDir, "a.bcmap"), "contenido-a");
      await copyDirIdempotent(srcDir, destDir); // primera corrida: copia real

      const outcome = await copyDirIdempotent(srcDir, destDir);

      expect(outcome).toEqual({ copied: 0, skipped: 1 });
    });

    it("recopies a file whose destination size no longer matches the source", async () => {
      await writeFile(join(srcDir, "a.bcmap"), "contenido-a");
      await copyDirIdempotent(srcDir, destDir); // primera corrida: copia real

      // Simula un destino desactualizado: mismo nombre, tamaño distinto.
      await writeFile(join(destDir, "a.bcmap"), "contenido-viejo-de-otro-tamano");

      const outcome = await copyDirIdempotent(srcDir, destDir);

      expect(outcome).toEqual({ copied: 1, skipped: 0 });
      await expect(readFile(join(destDir, "a.bcmap"), "utf-8")).resolves.toBe("contenido-a");
    });

    it("creates nested destination directories and recurses into nested sources", async () => {
      await mkdir(join(srcDir, "nested"), { recursive: true });
      await writeFile(join(srcDir, "nested", "c.bcmap"), "contenido-anidado");

      const outcome = await copyDirIdempotent(srcDir, destDir);

      expect(outcome).toEqual({ copied: 1, skipped: 0 });
      await expect(readFile(join(destDir, "nested", "c.bcmap"), "utf-8")).resolves.toBe(
        "contenido-anidado",
      );
    });
  });
});
