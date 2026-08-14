import { describe, expect, it } from "vitest";

import {
  buildGenderLexicon,
  parseBuenosAiresCsv,
  sanitizeLexiconKeys,
  serializeArtifact,
  sha256Hex,
} from "../../scripts/build-gender-lexicon.js";

// Fixture sintética del shape real de Buenos Aires Data "Nombres Permitidos"
// (NOMBRE;SEXO;ORIGEN;SIGNIFICADO, SEXO ∈ {F,M,A}, ADR-069 §1). No es la
// fuente real — cubre cada regla del build por separado: mapeo directo, fila
// con SEXO inválido, ORIGEN/SIGNIFICADO con comillas escapadas (RFC4180) que
// nunca deben sobrevivir, un compuesto real y dos abreviaturas del registro.
const BA_CSV = [
  "NOMBRE;SEXO;ORIGEN;SIGNIFICADO",
  "JULIA;F;S/O;S/S",
  "JUAN;M;HEBREO;YAHVEH SE HA COMPADECIDO",
  "CRUZ;A;LATINO;NOMBRE DE VARON Y MUJER",
  "RARO;X;S/O;S/S",
  'ABRAHAM;M;HEBREO;"EL PADRE (DIOS) ES EXCELSO, ""EL HEBREO"""',
  "MARIA DE LA O;F;S/O;S/S",
  "FRANC.DE CARACCIOLO;M;S/O;S/S",
  "ATAHUALPA D.L.ANDES;M;S/O;S/S",
  "JUAN2;M;S/O;S/S",
].join("\n");

describe("build-gender-lexicon", () => {
  describe("mapeo directo, sin fusión (ADR-069 §1)", () => {
    it("maps F→f, M→m, A→ambiguous", () => {
      const lexicon = buildGenderLexicon(BA_CSV);
      expect(lexicon.get("julia")).toBe("f");
      expect(lexicon.get("juan")).toBe("m");
      expect(lexicon.get("cruz")).toBe("ambiguous");
    });

    it("discards rows whose SEXO is not F/M/A instead of inventing a value", () => {
      const lexicon = buildGenderLexicon(BA_CSV);
      expect(lexicon.has("raro")).toBe(false);
    });

    it("ignores ORIGEN/SIGNIFICADO entirely, even with embedded commas and escaped quotes", () => {
      const ba = parseBuenosAiresCsv(BA_CSV);
      expect(ba.get("abraham")).toBe("M");
    });
  });

  describe("saneamiento del build (ADR-069 §3, candado 1 de 2)", () => {
    it("discards keys with a token containing a dot or a digit", () => {
      const lexicon = buildGenderLexicon(BA_CSV);
      expect(lexicon.has("franc.de caracciolo")).toBe(false);
      expect(lexicon.has("atahualpa d.l.andes")).toBe(false);
      expect(lexicon.has("juan2")).toBe(false);
    });

    it('preserves real compound names ("maria de la o"): no token filter by length', () => {
      const lexicon = buildGenderLexicon(BA_CSV);
      expect(lexicon.get("maria de la o")).toBe("f");

      // Ningún token de "maria de la o" mide más de un carácter para "o", y
      // el candado no debe reaccionar a eso: solo punto o dígito descartan.
      const sanitized = sanitizeLexiconKeys(new Map([["maria de la o", "f"]]));
      expect(sanitized.get("maria de la o")).toBe("f");
    });
  });

  describe("determinismo del artefacto (ADR-069 §2)", () => {
    it("regenerates deterministically: same input, same hash", () => {
      const hashA = sha256Hex(serializeArtifact(buildGenderLexicon(BA_CSV)));
      const hashB = sha256Hex(serializeArtifact(buildGenderLexicon(BA_CSV)));
      expect(hashA).toBe(hashB);
    });

    it("produces a stable hash regardless of source Map iteration order", () => {
      const lexicon = buildGenderLexicon(BA_CSV);
      const reversed = new Map([...lexicon.entries()].reverse());
      expect(sha256Hex(serializeArtifact(lexicon))).toBe(sha256Hex(serializeArtifact(reversed)));
    });

    it("changes hash if the input changes", () => {
      const original = sha256Hex(serializeArtifact(buildGenderLexicon(BA_CSV)));
      const mutated = sha256Hex(
        serializeArtifact(buildGenderLexicon(`${BA_CSV}\nNUEVONOMBRE;M;S/O;S/S`)),
      );
      expect(mutated).not.toBe(original);
    });
  });

  describe("serializeArtifact — solo nombre → f|m|ambiguous, nada más (ADR-069 §1)", () => {
    it("contains only the label per name, no origin, meaning or counts", () => {
      const lexicon = buildGenderLexicon(BA_CSV);
      const json = serializeArtifact(lexicon);
      const parsed: Record<string, unknown> = JSON.parse(json) as Record<string, unknown>;

      for (const value of Object.values(parsed)) {
        expect(["f", "m", "ambiguous"]).toContain(value);
      }
      expect(Object.keys(parsed).sort()).toEqual([...lexicon.keys()].sort());
      // Ningún fragmento de ORIGEN/SIGNIFICADO sobrevive al build.
      expect(json).not.toContain("HEBREO");
      expect(json).not.toContain("EXCELSO");
    });
  });
});
