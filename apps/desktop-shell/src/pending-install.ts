/**
 * Recuperación ante una instalación cortada (ADR-197 §5.c, Windows).
 *
 * El instalador NSIS no es atómico: si el proceso muere mientras copia los
 * archivos, la carpeta de instalación queda incompleta. Antes de lanzarlo, el
 * contenedor deja una **marca** en la carpeta de datos y una entrada
 * `RunOnce` que vuelve a correr el mismo instalador en el próximo inicio de
 * sesión. Este módulo es la parte pura: formato de la marca, decisión de
 * arranque y argumentos de `reg.exe`. Escribir y ejecutar vive en
 * `windows-install-recovery.ts`.
 *
 * Las rutas se arman con `path.win32` aunque el test corra en otra
 * plataforma: son rutas de Windows.
 */

import { win32 } from "node:path";

export const PENDING_INSTALL_FILE = "pending-install.json";

export const RUN_ONCE_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";

/** El script de NSIS (`assets/installer.nsh`) borra este mismo valor al terminar bien. */
export const RUN_ONCE_VALUE = "AnonlyUpdateRecovery";

export interface PendingInstallMark {
  readonly version: string;
  readonly installerPath: string;
}

export function serializePendingInstallMark(mark: PendingInstallMark): string {
  return JSON.stringify({ version: mark.version, installerPath: mark.installerPath });
}

/** Lee la marca; `null` si no es JSON o no tiene la forma esperada. */
export function parsePendingInstallMark(text: string): PendingInstallMark | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const version = "version" in value ? value.version : undefined;
    const installerPath = "installerPath" in value ? value.installerPath : undefined;
    if (typeof version !== "string" || typeof installerPath !== "string") return null;
    if (version === "" || installerPath === "") return null;
    return { version, installerPath };
  } catch {
    return null;
  }
}

/**
 * Qué hace la aplicación al arrancar con respecto a la marca (ADR-197 §5.c):
 * si existe, se borran la marca y la entrada `RunOnce`, sea cual sea la
 * versión que arrancó. Si arrancó la nueva, la instalación terminó; si
 * arrancó la anterior, el instalador no llegó a tocar nada y el actualizador
 * vuelve a ofrecer la descarga que sigue en la caché.
 */
export type StartupRecovery =
  | { readonly kind: "none" }
  | {
      readonly kind: "cleanup";
      readonly outcome: "installed" | "not-installed" | "unreadable";
    };

/** `markText` es el contenido de `pending-install.json`, o `null` si el archivo no existe. */
export function decideStartupRecovery(
  markText: string | null,
  runningVersion: string,
): StartupRecovery {
  if (markText === null) return { kind: "none" };
  const mark = parsePendingInstallMark(markText);
  if (mark === null) return { kind: "cleanup", outcome: "unreadable" };
  return {
    kind: "cleanup",
    outcome: mark.version === runningVersion ? "installed" : "not-installed",
  };
}

/**
 * `reg.exe` por ruta absoluta dentro de `%SystemRoot%\System32`: nada que
 * resolver por `PATH`.
 */
export function regExePath(systemRoot: string | undefined): string {
  const root =
    systemRoot !== undefined && win32.isAbsolute(systemRoot) ? systemRoot : "C:\\Windows";
  return win32.join(root, "System32", "reg.exe");
}

/** El comando que `RunOnce` ejecuta: el mismo instalador, en silencio. */
export function recoveryCommand(installerPath: string): string {
  if (!win32.isAbsolute(installerPath) || /["\r\n\0]/.test(installerPath)) {
    throw new Error("ruta de instalador no apta para RunOnce");
  }
  return `"${installerPath}" --updated /S`;
}

/** Argumentos de `reg.exe` para escribir la entrada. Lista, sin shell. */
export function runOnceAddArgs(installerPath: string): ReadonlyArray<string> {
  return [
    "add",
    RUN_ONCE_KEY,
    "/v",
    RUN_ONCE_VALUE,
    "/t",
    "REG_SZ",
    "/d",
    recoveryCommand(installerPath),
    "/f",
  ];
}

/** Argumentos de `reg.exe` para borrar la entrada. Lista, sin shell. */
export function runOnceDeleteArgs(): ReadonlyArray<string> {
  return ["delete", RUN_ONCE_KEY, "/v", RUN_ONCE_VALUE, "/f"];
}
