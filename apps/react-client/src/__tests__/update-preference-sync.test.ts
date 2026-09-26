/**
 * `SettingsDialog.applyToStore` no tiene tests de render (sin
 * jsdom/testing-library, R-12), así que la secuencia de guardado de
 * ADR-188 §2 —persistir y, solo si `checkUpdates` cambió, avisar al
 * shell, en ese orden— se prueba sobre la función pura que la implementa.
 */

import { describe, expect, it, vi } from "vitest";

import { syncAutomaticChecksPreference } from "../components/toolbar/updatePreferenceSync.js";

describe("syncAutomaticChecksPreference (ADR-188 §2)", () => {
  it("persiste antes de avisar, cuando checkUpdates cambió", () => {
    const calls: string[] = [];

    syncAutomaticChecksPreference(true, false, {
      persist: () => calls.push("persist"),
      send: (enabled) => calls.push(`send:${enabled}`),
    });

    expect(calls).toEqual(["persist", "send:false"]);
  });

  it("no avisa al shell si checkUpdates no cambió (ADR-188 §2: 'guarda un CAMBIO')", () => {
    const send = vi.fn();

    syncAutomaticChecksPreference(true, true, { persist: () => undefined, send });

    expect(send).not.toHaveBeenCalled();
  });

  it("persiste igual, haya cambiado checkUpdates o no", () => {
    const persist = vi.fn();

    syncAutomaticChecksPreference(false, false, { persist, send: () => undefined });

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("avisa con el valor NUEVO, no con el previo", () => {
    const send = vi.fn();

    syncAutomaticChecksPreference(false, true, { persist: () => undefined, send });

    expect(send).toHaveBeenCalledWith(true);
  });
});
