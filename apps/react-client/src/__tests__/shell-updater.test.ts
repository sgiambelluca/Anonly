/**
 * `updater/index.ts` — la frontera con el actualizador del contenedor.
 *
 * Lo que importa probar acá no es que funcione cuando todo está bien, sino que
 * **degrade sin romper**: la app corre sin shell en los tests, en el navegador
 * y en cualquier build web futura, y `window` es territorio compartido donde
 * puede aparecer cualquier cosa con ese nombre.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { getShellUpdater, sendAutomaticChecksPreference } from "../updater/index.js";

const globalWithWindow = globalThis as { window?: unknown };

function setWindow(value: unknown): void {
  globalWithWindow.window = value;
}

afterEach(() => {
  delete globalWithWindow.window;
});

describe("getShellUpdater", () => {
  it("devuelve el puente cuando el shell lo expone completo", () => {
    const bridge = {
      onEvent: () => undefined,
      check: () => undefined,
      install: () => undefined,
      setAutomaticChecks: () => undefined,
    };
    setWindow({ anonlyUpdater: bridge });
    expect(getShellUpdater()).toBe(bridge);
  });

  it("devuelve null sin contenedor: es el caso normal en el navegador", () => {
    setWindow({});
    expect(getShellUpdater()).toBeNull();
  });

  it("devuelve null si falta cualquiera de los cuatro métodos", () => {
    // Un puente a medias es peor que ninguno: la UI mostraría controles de
    // actualización que revientan al usarse.
    const complete = {
      onEvent: () => undefined,
      check: () => undefined,
      install: () => undefined,
      setAutomaticChecks: () => undefined,
    };
    for (const missing of ["onEvent", "check", "install", "setAutomaticChecks"] as const) {
      const partial: Record<string, unknown> = { ...complete };
      delete partial[missing];
      setWindow({ anonlyUpdater: partial });
      expect(getShellUpdater(), `falta ${missing}`).toBeNull();
    }
  });

  it("devuelve null ante un `anonlyUpdater` que no es un objeto con métodos", () => {
    for (const impostor of [null, undefined, 42, "updater", [], { onEvent: "no soy función" }]) {
      setWindow({ anonlyUpdater: impostor });
      expect(getShellUpdater()).toBeNull();
    }
  });
});

describe("sendAutomaticChecksPreference (ADR-188 §2)", () => {
  it("llama a setAutomaticChecks del puente con el valor recibido", () => {
    const setAutomaticChecks = vi.fn();
    setWindow({
      anonlyUpdater: {
        onEvent: () => undefined,
        check: () => undefined,
        install: () => undefined,
        setAutomaticChecks,
      },
    });

    sendAutomaticChecksPreference(true);

    expect(setAutomaticChecks).toHaveBeenCalledWith(true);
  });

  it("no envía nada fuera del contenedor de escritorio", () => {
    setWindow({});
    // No hay `anonlyUpdater`: no debe tirar, y no hay a quién llamarle nada.
    expect(() => sendAutomaticChecksPreference(false)).not.toThrow();
  });
});
