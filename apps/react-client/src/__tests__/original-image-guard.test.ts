import { describe, expect, it } from "vitest";

import { mustClearOriginalImage } from "../components/viewer/originalImageGuard.js";

// Enmienda a ADR-213: bajo Anonimizado nunca se muestra la imagen original, ni por un cuadro.

describe("mustClearOriginalImage", () => {
  it("clears a canvas that still shows an original image under the Anonymized view", () => {
    expect(mustClearOriginalImage({ viewing: "anonymized", painted: "original" })).toBe(true);
  });

  it("keeps an anonymized image under the Anonymized view", () => {
    expect(mustClearOriginalImage({ viewing: "anonymized", painted: "anonymized" })).toBe(false);
  });

  it("has nothing to clear on an empty canvas", () => {
    expect(mustClearOriginalImage({ viewing: "anonymized", painted: null })).toBe(false);
  });

  it("never clears under the Original view, whatever it shows", () => {
    for (const painted of ["original", "anonymized", null] as const) {
      expect(mustClearOriginalImage({ viewing: "original", painted })).toBe(false);
    }
  });
});
