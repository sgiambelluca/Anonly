/**
 * `App.tsx` no tiene tests de render (sin jsdom/testing-library, R-12), así
 * que la secuencia de arranque de ADR-188 §2 —cargar la configuración
 * persistida y DESPUÉS avisarle al shell la preferencia de búsqueda
 * automática— se prueba sobre la función pura que la implementa, con dobles
 * inyectados.
 */

import { describe, expect, it, vi } from "vitest";

import { bootstrapAutomaticChecksPreference } from "../appStartup.js";

describe("bootstrapAutomaticChecksPreference (ADR-188 §2)", () => {
  it("carga la configuración antes de leer y enviar la preferencia de búsqueda", () => {
    const calls: string[] = [];

    bootstrapAutomaticChecksPreference({
      load: () => calls.push("load"),
      getCheckUpdates: () => {
        calls.push("getCheckUpdates");
        return true;
      },
      sendAutomaticChecksPreference: (enabled) => calls.push(`send:${enabled}`),
      getInstallOnQuit: () => {
        calls.push("getInstallOnQuit");
        return true;
      },
      sendInstallOnQuitPreference: (enabled) => calls.push(`sendInstallOnQuit:${enabled}`),
    });

    // El orden es la propiedad que importa: invertirlo mandaría el default
    // del store en vez del valor de una sesión anterior.
    expect(calls).toEqual([
      "load",
      "getCheckUpdates",
      "send:true",
      "getInstallOnQuit",
      "sendInstallOnQuit:true",
    ]);
  });

  it("envía lo que getCheckUpdates devuelve DESPUÉS de cargar, no un valor fijo", () => {
    const sendAutomaticChecksPreference = vi.fn();

    bootstrapAutomaticChecksPreference({
      load: () => undefined,
      getCheckUpdates: () => false,
      sendAutomaticChecksPreference,
      getInstallOnQuit: () => false,
      sendInstallOnQuitPreference: () => undefined,
    });

    expect(sendAutomaticChecksPreference).toHaveBeenCalledTimes(1);
    expect(sendAutomaticChecksPreference).toHaveBeenCalledWith(false);
  });

  it("llama a load exactamente una vez, sin importar qué devuelva getCheckUpdates", () => {
    const load = vi.fn();

    bootstrapAutomaticChecksPreference({
      load,
      getCheckUpdates: () => true,
      sendAutomaticChecksPreference: () => undefined,
      getInstallOnQuit: () => false,
      sendInstallOnQuitPreference: () => undefined,
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("avisa al contenedor si se instala al cerrar con el valor leído DESPUÉS de cargar (ADR-197 §3)", () => {
    const sendInstallOnQuitPreference = vi.fn();

    bootstrapAutomaticChecksPreference({
      load: () => undefined,
      getCheckUpdates: () => true,
      sendAutomaticChecksPreference: () => undefined,
      getInstallOnQuit: () => true,
      sendInstallOnQuitPreference,
    });

    expect(sendInstallOnQuitPreference).toHaveBeenCalledTimes(1);
    expect(sendInstallOnQuitPreference).toHaveBeenCalledWith(true);
  });
});
