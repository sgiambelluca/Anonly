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
  it("carga la configuración antes de leer y enviar checkUpdates", () => {
    const calls: string[] = [];

    bootstrapAutomaticChecksPreference({
      load: () => calls.push("load"),
      getCheckUpdates: () => {
        calls.push("getCheckUpdates");
        return true;
      },
      sendAutomaticChecksPreference: (enabled) => calls.push(`send:${enabled}`),
    });

    // El orden es la propiedad que importa: invertirlo mandaría el default
    // del store en vez del valor de una sesión anterior.
    expect(calls).toEqual(["load", "getCheckUpdates", "send:true"]);
  });

  it("envía lo que getCheckUpdates devuelve DESPUÉS de cargar, no un valor fijo", () => {
    const sendAutomaticChecksPreference = vi.fn();

    bootstrapAutomaticChecksPreference({
      load: () => undefined,
      getCheckUpdates: () => false,
      sendAutomaticChecksPreference,
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
    });

    expect(load).toHaveBeenCalledTimes(1);
  });
});
