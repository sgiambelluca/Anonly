/**
 * `SettingsDialog.applyToStore` no tiene tests de render (sin
 * jsdom/testing-library, R-12), así que la secuencia de guardado de
 * ADR-188 §2 —persistir y, solo si `checkUpdates` cambió, avisar al
 * shell, en ese orden— se prueba sobre la función pura que la implementa.
 */

import { describe, expect, it, vi } from "vitest";

import {
  syncAutomaticChecksPreference,
  syncInstallOnQuitPreference,
} from "../components/toolbar/updatePreferenceSync.js";

describe("syncAutomaticChecksPreference (ADR-188 §2)", () => {
  it("persiste antes de avisar, cuando cambió que se busque o no", () => {
    const calls: string[] = [];

    syncAutomaticChecksPreference(true, false, {
      persist: () => calls.push("persist"),
      send: (enabled) => calls.push(`send:${enabled}`),
    });

    expect(calls).toEqual(["persist", "send:false"]);
  });

  it("no avisa al shell si no cambió que se busque (ADR-188 §2; de Avisarme a Instalar no manda nada)", () => {
    const send = vi.fn();

    syncAutomaticChecksPreference(true, true, { persist: () => undefined, send });

    expect(send).not.toHaveBeenCalled();
  });

  it("persiste igual, haya cambiado la búsqueda o no", () => {
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

describe("syncInstallOnQuitPreference (ADR-197 §3)", () => {
  it("avisa con el valor nuevo cuando cambió, en los dos sentidos", () => {
    const send = vi.fn();
    syncInstallOnQuitPreference(false, true, send);
    syncInstallOnQuitPreference(true, false, send);
    expect(send.mock.calls).toEqual([[true], [false]]);
  });

  it("no avisa si no cambió", () => {
    const send = vi.fn();
    syncInstallOnQuitPreference(true, true, send);
    syncInstallOnQuitPreference(false, false, send);
    expect(send).not.toHaveBeenCalled();
  });
});
