import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  decideStartupRecovery,
  PENDING_INSTALL_FILE,
  regExePath,
  runOnceAddArgs,
  runOnceDeleteArgs,
  serializePendingInstallMark,
  type PendingInstallMark,
} from "./pending-install";

/**
 * Glue de la recuperación ante una instalación cortada (ADR-197 §5.c). Todo lo
 * decidible vive en `pending-install.ts`; acá solo se toca el disco y el
 * registro. Sin Electron: recibe la carpeta de datos por parámetro.
 */

/** `reg.exe` por ruta absoluta, argumentos como lista y sin shell. */
function runReg(args: ReadonlyArray<string>): void {
  execFileSync(regExePath(process.env["SystemRoot"]), [...args], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
    timeout: 10_000,
  });
}

/** Deja la marca en la carpeta de datos, de forma síncrona. */
export function writePendingInstallMark(userDataDir: string, mark: PendingInstallMark): void {
  writeFileSync(join(userDataDir, PENDING_INSTALL_FILE), serializePendingInstallMark(mark), "utf8");
}

/** Escribe la entrada `RunOnce` que vuelve a correr el instalador en silencio. */
export function registerRunOnceRecovery(installerPath: string): void {
  runReg(runOnceAddArgs(installerPath));
}

/**
 * Al arrancar: si hay marca, se borran ella y la entrada `RunOnce`, sea cual
 * sea la versión que arrancó. Nunca tira: que la limpieza falle no puede
 * impedir que la aplicación abra.
 */
export function cleanupInstallRecovery(
  userDataDir: string,
  runningVersion: string,
  log: (message: string) => void,
): void {
  const markPath = join(userDataDir, PENDING_INSTALL_FILE);
  let markText: string | null = null;
  try {
    markText = readFileSync(markPath, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT")
      log(`[anonly] updater: no se pudo leer la marca de instalación: ${String(error)}`);
  }

  const decision = decideStartupRecovery(markText, runningVersion);
  if (decision.kind === "none") return;

  log(`[anonly] updater: marca de instalación previa (${decision.outcome}); se limpia`);
  try {
    // Falla (código 1) si el valor ya no existe, que es el caso normal cuando
    // el instalador terminó bien y lo borró: no es un error.
    runReg(runOnceDeleteArgs());
  } catch {
    // sin entrada que borrar
  }
  try {
    rmSync(markPath, { force: true });
  } catch (error) {
    log(`[anonly] updater: no se pudo borrar la marca de instalación: ${String(error)}`);
  }
}

/**
 * Retira la marca y la entrada `RunOnce` cuando el instalador no llegó a
 * lanzarse (ADR-197 §5.c): sin instalación en curso no hay nada que recuperar.
 * Nunca tira.
 */
export function clearInstallRecovery(userDataDir: string, log: (message: string) => void): void {
  try {
    runReg(runOnceDeleteArgs());
  } catch {
    // sin entrada que borrar
  }
  try {
    rmSync(join(userDataDir, PENDING_INSTALL_FILE), { force: true });
  } catch (error) {
    log(`[anonly] updater: no se pudo borrar la marca de instalación: ${String(error)}`);
  }
}
