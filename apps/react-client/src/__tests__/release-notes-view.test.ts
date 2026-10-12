/**
 * La lógica pura del menú de novedades (ADR-216 §2, `Components.md` §2.9b): el
 * orden, cuál versión lleva "Instalada", la fecha en formato largo y las
 * etiquetas de cada tipo.
 */

import { describe, expect, it } from "vitest";

import type { ReleaseNotesEntry } from "../components/screens/releaseNotes.js";
import {
  compareVersions,
  formatReleaseDate,
  isInstalledVersion,
  isValidReleaseDate,
  orderReleaseNotes,
  parseVersion,
  RELEASE_NOTE_LABEL,
} from "../components/screens/releaseNotesView.js";

function entry(version: string): ReleaseNotesEntry {
  return { version, date: "2026-10-02", summary: "x", notes: [] };
}

describe("formatReleaseDate", () => {
  it("escribe el mes en español y sin cero adelante", () => {
    expect(formatReleaseDate("2026-10-02")).toBe("2 de octubre de 2026");
    expect(formatReleaseDate("2026-09-05")).toBe("5 de septiembre de 2026");
  });

  it("cubre los doce meses", () => {
    const months = [
      "enero",
      "febrero",
      "marzo",
      "abril",
      "mayo",
      "junio",
      "julio",
      "agosto",
      "septiembre",
      "octubre",
      "noviembre",
      "diciembre",
    ];
    months.forEach((name, index) => {
      const month = String(index + 1).padStart(2, "0");
      expect(formatReleaseDate(`2027-${month}-15`)).toBe(`15 de ${name} de 2027`);
    });
  });

  it("no corre el día según la zona horaria", () => {
    // `new Date("2026-10-01")` es medianoche UTC: en Buenos Aires (UTC-3) sería
    // el 30 de septiembre. La fecha se lee del texto y no pasa por `Date`.
    const original = process.env["TZ"];
    try {
      for (const zone of ["America/Argentina/Buenos_Aires", "Pacific/Auckland", "UTC"]) {
        process.env["TZ"] = zone;
        expect(formatReleaseDate("2026-10-01")).toBe("1 de octubre de 2026");
        expect(formatReleaseDate("2026-01-01")).toBe("1 de enero de 2026");
        expect(formatReleaseDate("2026-12-31")).toBe("31 de diciembre de 2026");
      }
    } finally {
      if (original === undefined) delete process.env["TZ"];
      else process.env["TZ"] = original;
    }
  });

  it("una fecha inválida se muestra tal cual en vez de romper", () => {
    expect(formatReleaseDate("octubre")).toBe("octubre");
    expect(formatReleaseDate("2026-13-01")).toBe("2026-13-01");
    expect(formatReleaseDate("2026-04-31")).toBe("2026-04-31");
  });
});

describe("isValidReleaseDate", () => {
  it("acepta fechas del calendario", () => {
    expect(isValidReleaseDate("2026-10-02")).toBe(true);
    expect(isValidReleaseDate("2028-02-29")).toBe(true);
  });

  it("rechaza lo que no es AAAA-MM-DD o no existe", () => {
    expect(isValidReleaseDate("2026-10-2")).toBe(false);
    expect(isValidReleaseDate("02/10/2026")).toBe(false);
    expect(isValidReleaseDate("2026-02-30")).toBe(false);
    expect(isValidReleaseDate("2027-02-29")).toBe(false);
    expect(isValidReleaseDate("2026-00-10")).toBe(false);
    expect(isValidReleaseDate("")).toBe(false);
  });
});

describe("parseVersion y compareVersions", () => {
  it("lee X.Y.Z", () => {
    expect(parseVersion("1.0.1")).toEqual([1, 0, 1]);
    expect(parseVersion("0.9.12")).toEqual([0, 9, 12]);
  });

  it("rechaza lo que no tiene esa forma", () => {
    expect(parseVersion("1.0")).toBeNull();
    expect(parseVersion("1.0.1-beta")).toBeNull();
    expect(parseVersion("v1.0.1")).toBeNull();
  });

  it("compara numéricamente, no como texto", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.1", "1.0.1")).toBe(0);
  });

  it("una versión malformada queda por debajo de las válidas", () => {
    expect(compareVersions("x", "0.0.1")).toBeLessThan(0);
    expect(compareVersions("0.0.1", "x")).toBeGreaterThan(0);
    expect(compareVersions("x", "y")).toBe(0);
  });
});

describe("orderReleaseNotes", () => {
  it("ordena de la más nueva a la más vieja", () => {
    const ordered = orderReleaseNotes([entry("1.0.0"), entry("1.0.10"), entry("1.0.9")]);
    expect(ordered.map((e) => e.version)).toEqual(["1.0.10", "1.0.9", "1.0.0"]);
  });

  it("no muta la lista que recibe", () => {
    const input = [entry("1.0.0"), entry("1.0.1")];
    orderReleaseNotes(input);
    expect(input.map((e) => e.version)).toEqual(["1.0.0", "1.0.1"]);
  });
});

describe("isInstalledVersion", () => {
  it("«Instalada» va solo en la versión igual a la que corre", () => {
    const versions = ["1.0.1", "1.0.0", "0.9.9"];
    expect(versions.filter((version) => isInstalledVersion(version, "1.0.1"))).toEqual(["1.0.1"]);
    expect(versions.filter((version) => isInstalledVersion(version, "1.0.0"))).toEqual(["1.0.0"]);
  });

  it("si la que corre no figura (p. ej. un build local), ninguna la lleva", () => {
    expect(isInstalledVersion("1.0.1", "1.0.2")).toBe(false);
    expect(isInstalledVersion("1.0.1", "")).toBe(false);
  });
});

describe("RELEASE_NOTE_LABEL", () => {
  it("son las tres etiquetas de ADR-216 §3", () => {
    expect(RELEASE_NOTE_LABEL).toEqual({ new: "Nuevo", improvement: "Mejora", fix: "Arreglo" });
  });
});
