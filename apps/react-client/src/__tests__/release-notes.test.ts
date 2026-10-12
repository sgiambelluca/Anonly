/**
 * Las novedades de cada versión (ADR-216 §3-§5, `Components.md` §2.9b).
 *
 * La condición 1 es el gate del release: `pnpm run version` sube la versión de
 * `apps/desktop-shell/package.json` y este test falla hasta que alguien escribe
 * la entrada de esa versión en `releaseNotes.ts`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RELEASE_NOTES, type ReleaseNotesEntry } from "../components/screens/releaseNotes.js";
import {
  compareVersions,
  isValidReleaseDate,
  parseVersion,
} from "../components/screens/releaseNotesView.js";

/** Tope de ADR-216 §3: una oración por novedad. */
const MAX_TEXT_LENGTH = 140;

function readPackageVersion(relativeToThisFile: string): string {
  const parsed: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL(relativeToThisFile, import.meta.url)), "utf8"),
  );
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const { version } = parsed;
    if (typeof version === "string") return version;
  }
  throw new Error(`Sin "version" en ${relativeToThisFile}`);
}

/** Todos los textos que el usuario lee: el resumen y cada novedad. */
function userTexts(entry: ReleaseNotesEntry): ReadonlyArray<string> {
  return [
    ...(entry.summary !== undefined ? [entry.summary] : []),
    ...entry.notes.map((note) => note.text),
  ];
}

describe("RELEASE_NOTES (ADR-216 §5)", () => {
  it("1. la primera entrada es la versión de la aplicación (apps/react-client/package.json)", () => {
    // Es la que lee `readAppVersion()` en vite.config.ts. Si falla: se subió la
    // versión (`pnpm run version`) y falta escribir sus novedades al principio
    // de `releaseNotes.ts` (`RELEASING.md`).
    expect(RELEASE_NOTES[0]?.version).toBe(readPackageVersion("../../package.json"));
  });

  it("1. y coincide con la de apps/desktop-shell/package.json, la que manda en el release", () => {
    // Changesets los versiona juntos (`fixed`).
    expect(RELEASE_NOTES[0]?.version).toBe(
      readPackageVersion("../../../desktop-shell/package.json"),
    );
  });

  it("2. las versiones tienen la forma X.Y.Z, no se repiten y van de mayor a menor", () => {
    const versions = RELEASE_NOTES.map((entry) => entry.version);
    for (const version of versions) expect(parseVersion(version)).not.toBeNull();
    expect(new Set(versions).size).toBe(versions.length);
    for (let index = 1; index < versions.length; index += 1) {
      const previous = versions[index - 1] ?? "";
      const current = versions[index] ?? "";
      expect(compareVersions(previous, current)).toBeGreaterThan(0);
    }
  });

  it("2. las fechas son válidas y no crecen hacia las versiones viejas", () => {
    for (const entry of RELEASE_NOTES) {
      expect(isValidReleaseDate(entry.date), `${entry.version}: ${entry.date}`).toBe(true);
    }
    for (let index = 1; index < RELEASE_NOTES.length; index += 1) {
      const newer = RELEASE_NOTES[index - 1]?.date ?? "";
      const older = RELEASE_NOTES[index]?.date ?? "";
      // `AAAA-MM-DD` ordena igual como texto que como fecha.
      expect(older <= newer, `${older} no puede ser posterior a ${newer}`).toBe(true);
    }
  });

  it("3. cada entrada tiene un resumen o al menos una novedad", () => {
    for (const entry of RELEASE_NOTES) {
      expect(
        entry.summary !== undefined || entry.notes.length > 0,
        `${entry.version} está vacía`,
      ).toBe(true);
    }
  });

  it("4. ningún texto está vacío, supera los 140 caracteres ni contiene «ADR-»", () => {
    for (const entry of RELEASE_NOTES) {
      for (const text of userTexts(entry)) {
        expect(text.trim().length, `${entry.version}: texto vacío`).toBeGreaterThan(0);
        expect(text.length, `${entry.version}: «${text}»`).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
        expect(text, `${entry.version}: «${text}»`).not.toContain("ADR-");
      }
    }
  });

  it("4. todas las novedades son de un tipo conocido", () => {
    for (const entry of RELEASE_NOTES) {
      for (const note of entry.notes) {
        expect(["new", "improvement", "fix"]).toContain(note.kind);
      }
    }
  });

  it("la 1.0.0 y la 1.0.1 figuran con su fecha de ADR-216 §4", () => {
    // Se busca cada una: el test no fija la lista completa, así que agregar
    // la entrada de un release nuevo no obliga a tocarlo.
    const dateOf = (version: string): string | undefined =>
      RELEASE_NOTES.find((entry) => entry.version === version)?.date;
    expect(dateOf("1.0.1")).toBe("2026-10-02");
    expect(dateOf("1.0.0")).toBe("2026-10-02");
  });

  it("la 1.0.0 es solo el resumen, sin novedades listadas", () => {
    const first = RELEASE_NOTES.find((entry) => entry.version === "1.0.0");
    expect(first?.summary).toBe("Primera versión estable.");
    expect(first?.notes).toEqual([]);
  });

  it("la 1.0.1 trae las tres novedades de ADR-216 §4, con su tipo", () => {
    const entry = RELEASE_NOTES.find((candidate) => candidate.version === "1.0.1");
    expect(entry?.notes).toEqual([
      {
        kind: "improvement",
        text: "Las actualizaciones muestran el avance de la descarga y se instalan sin asistente.",
      },
      {
        kind: "improvement",
        text: "Con «Instalar automáticamente», la actualización se instala al cerrar Anonly (en macOS, al abrirlo).",
      },
      { kind: "fix", text: "Si la instalación se corta en Windows, se vuelve a correr sola." },
    ]);
  });
});
