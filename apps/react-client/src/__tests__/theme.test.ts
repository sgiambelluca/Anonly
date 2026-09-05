/**
 * `theme.ts` — cómo se aplica el tema al documento.
 *
 * Lo que importa es el caso `"system"`: **quita** el atributo en vez de
 * escribir un valor calculado. Si escribiera `"dark"` porque el sistema está
 * en oscuro, la app dejaría de seguir al sistema en el momento exacto en que
 * el usuario pidió que lo siguiera — y no se enteraría hasta cambiar el modo
 * del SO con la app abierta.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTheme } from "../theme.js";

function stubDocument(): { readonly theme: () => string | undefined } {
  const dataset: Record<string, string> = {};
  vi.stubGlobal("document", { documentElement: { dataset } });
  return { theme: () => dataset["theme"] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyTheme", () => {
  it("escribe el atributo para una elección explícita", () => {
    const doc = stubDocument();
    applyTheme("dark");
    expect(doc.theme()).toBe("dark");
    applyTheme("light");
    expect(doc.theme()).toBe("light");
  });

  it('"system" quita el atributo para que mande la media query', () => {
    const doc = stubDocument();
    applyTheme("dark");
    applyTheme("system");
    expect(doc.theme()).toBeUndefined();
  });

  it("no explota sin document (los tests corren en Node, sin DOM)", () => {
    vi.stubGlobal("document", undefined);
    expect(() => applyTheme("dark")).not.toThrow();
  });
});
