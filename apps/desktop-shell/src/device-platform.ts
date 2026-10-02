/**
 * La plataforma que el contenedor le informa a la interfaz (ADR-197 §6), por
 * argumento del preload como la RAM (ADR-194 §4). Puro, sin Electron.
 *
 * El preload NO importa este módulo: con `sandbox: true` no puede cargar
 * archivos propios (ADR-132 §3), así que repite la lista de valores. Un test
 * (`device-surface.test.ts`) mantiene las dos copias de acuerdo.
 */

export type DevicePlatform = "windows" | "macos" | "other";

export const PLATFORM_ARG = "--anonly-platform=";

/** De `process.platform` al valor que cruza. Cualquier otra cosa es `"other"`. */
export function toDevicePlatform(platform: string): DevicePlatform {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "other";
}
