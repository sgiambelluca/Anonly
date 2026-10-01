import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { scannedFixtureHash } from "./scannedFixtureCache.js";

const bytes = new Uint8Array([1, 2, 3, 4]);

describe("scannedFixtureHash", () => {
  it("sin opciones es el hash de siempre, para no invalidar los fixtures cacheados", () => {
    expect(scannedFixtureHash(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex").slice(0, 16),
    );
  });

  it("la escala distingue la clave: 300 dpi no sirve el fixture de 216 dpi", () => {
    expect(scannedFixtureHash(bytes, { scale: 300 / 72 })).not.toBe(scannedFixtureHash(bytes));
    expect(scannedFixtureHash(bytes, { scale: 300 / 72 })).not.toBe(
      scannedFixtureHash(bytes, { scale: 3 }),
    );
  });

  it("la cantidad de páginas distingue la clave", () => {
    expect(scannedFixtureHash(bytes, { pageCount: 20 })).not.toBe(
      scannedFixtureHash(bytes, { pageCount: 21 }),
    );
    expect(scannedFixtureHash(bytes, { pageCount: 20 })).not.toBe(scannedFixtureHash(bytes));
  });

  it("la degradación y los giros distinguen la clave", () => {
    const degradation = {
      recipe: "r",
      seed: 1,
      blurSigmaPx: 1,
      blackLevel: 50,
      whiteLevel: 230,
      noiseSigma: 8,
    };
    const plain = scannedFixtureHash(bytes, { scale: 4 });
    const degraded = scannedFixtureHash(bytes, { scale: 4, degradation });
    expect(degraded).not.toBe(plain);
    expect(
      scannedFixtureHash(bytes, { scale: 4, degradation: { ...degradation, seed: 2 } }),
    ).not.toBe(degraded);
    expect(
      scannedFixtureHash(bytes, { scale: 4, degradation: { ...degradation, blurSigmaPx: 1.5 } }),
    ).not.toBe(degraded);
    expect(scannedFixtureHash(bytes, { scale: 4, rotations: [0, 180] })).not.toBe(plain);
    expect(scannedFixtureHash(bytes, { scale: 4, rotations: [0, 180] })).not.toBe(
      scannedFixtureHash(bytes, { scale: 4, rotations: [180, 0] }),
    );
  });

  it("es determinista", () => {
    expect(scannedFixtureHash(bytes, { scale: 4, pageCount: 2 })).toBe(
      scannedFixtureHash(bytes, { scale: 4, pageCount: 2 }),
    );
  });
});
