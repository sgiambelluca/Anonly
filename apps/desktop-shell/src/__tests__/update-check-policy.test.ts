/**
 * Pruebas exigidas por ADR-188 sobre la política pura de búsqueda automática.
 * Sin Electron: exactamente lo que el ADR pide para poder probarse con dobles.
 */

import { describe, expect, it } from "vitest";

import { createMacUpdateCheckPolicy, createWindowsUpdateCheckPolicy } from "../update-check-policy";

describe("createWindowsUpdateCheckPolicy (ADR-188 §3)", () => {
  // "No busca al iniciar" ya lo cubre `windows-updater-automatic-checks.test.ts`
  // contra el `autoUpdater` real (mockeado): ahí sí hay un efecto observable
  // (`checkForUpdates` no llamado). Acá, sobre la política sola, no hay ningún
  // efecto que crear el objeto pueda producir — un test que solo comprobaba
  // `typeof policy.onPreference === "function"` no fallaría ante ninguna
  // regresión real, así que se saca en vez de simularlo.

  it("busca una sola vez con el primer true", () => {
    const policy = createWindowsUpdateCheckPolicy();
    expect(policy.onPreference(true)).toBe(true);
  });

  it("no busca con false", () => {
    const policy = createWindowsUpdateCheckPolicy();
    expect(policy.onPreference(false)).toBe(false);
  });

  it("un true después de una búsqueda ya hecha no repite", () => {
    const policy = createWindowsUpdateCheckPolicy();
    expect(policy.onPreference(true)).toBe(true);
    expect(policy.onPreference(true)).toBe(false);
    expect(policy.onPreference(true)).toBe(false);
  });

  it("un true posterior a un false sigue pudiendo disparar la primera búsqueda", () => {
    const policy = createWindowsUpdateCheckPolicy();
    expect(policy.onPreference(false)).toBe(false);
    expect(policy.onPreference(false)).toBe(false);
    expect(policy.onPreference(true)).toBe(true);
    // Y ya no repite después de esa primera.
    expect(policy.onPreference(true)).toBe(false);
  });

  it("un payload no booleano se ignora, sin cambiar el estado", () => {
    const policy = createWindowsUpdateCheckPolicy();
    for (const impostor of [null, undefined, 1, "true", {}, []]) {
      expect(policy.onPreference(impostor)).toBe(false);
    }
    // El estado sigue "sin buscar todavía": un true real dispara.
    expect(policy.onPreference(true)).toBe(true);
  });
});

describe("createMacUpdateCheckPolicy (ADR-188 §3)", () => {
  it("el primer mensaje válido pide init + set, con el valor recibido", () => {
    const policy = createMacUpdateCheckPolicy();
    expect(policy.onPreference(true)).toEqual({ kind: "init-and-set", enabled: true });
  });

  it("el primer mensaje válido puede ser false: igual pide init + set", () => {
    const policy = createMacUpdateCheckPolicy();
    expect(policy.onPreference(false)).toEqual({ kind: "init-and-set", enabled: false });
  });

  it("los mensajes siguientes solo piden set, con cualquier valor", () => {
    const policy = createMacUpdateCheckPolicy();
    expect(policy.onPreference(true)).toEqual({ kind: "init-and-set", enabled: true });
    expect(policy.onPreference(false)).toEqual({ kind: "set", enabled: false });
    expect(policy.onPreference(true)).toEqual({ kind: "set", enabled: true });
  });

  it("un payload no booleano se ignora y no cuenta como el primer mensaje", () => {
    const policy = createMacUpdateCheckPolicy();
    expect(policy.onPreference("nope")).toEqual({ kind: "ignore" });
    expect(policy.onPreference(null)).toEqual({ kind: "ignore" });
    // El primer mensaje VÁLIDO sigue siendo el primero: todavía pide init.
    expect(policy.onPreference(true)).toEqual({ kind: "init-and-set", enabled: true });
  });
});
