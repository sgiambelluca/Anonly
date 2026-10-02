/**
 * Lo que pasa justo antes de lanzar el instalador de una actualización
 * (ADR-197 §5.b y §5.c, Windows), por cualquiera de los dos caminos: el
 * pedido del usuario y el cierre de la aplicación.
 *
 * Es el orden lo que importa, y por eso está acá, puro y con las
 * dependencias inyectadas:
 *
 * 1. se vuelve a verificar el archivo (una descarga reutilizada de la caché
 *    no pasó por la verificación de ADR-137 en esta ejecución);
 * 2. si falla, no se instala y se descarta la descarga;
 * 3. si pasa, se deja la marca y la entrada `RunOnce` **antes** de lanzar el
 *    instalador. Si registrar falla, la instalación sigue (ADR-197 §5.c): la
 *    ventana de riesgo son los segundos de la copia, y dejar a alguien sin
 *    actualizar para siempre es peor.
 */

import type { PendingInstallMark } from "./pending-install";
import type { DownloadedUpdate } from "./update-install-policy";

export interface InstallPreparationDeps {
  /** `null` si el archivo es el que firma el manifiesto; si no, el motivo del rechazo. */
  verify(filePath: string): Promise<string | null>;
  /** Síncrono. Puede tirar. */
  writeMark(mark: PendingInstallMark): void;
  /** Síncrono. Puede tirar. */
  registerRecovery(installerPath: string): void;
  discardDownload(filePath: string): Promise<void>;
  log(message: string): void;
}

export type InstallPreparation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export async function prepareVerifiedInstall(
  deps: InstallPreparationDeps,
  update: DownloadedUpdate,
): Promise<InstallPreparation> {
  const file = update.file;
  if (file === null) {
    const reason = "la descarga no informó su archivo";
    deps.log(`[anonly] updater: no se instala: ${reason}`);
    return { ok: false, reason };
  }

  let reason: string | null;
  try {
    reason = await deps.verify(file);
  } catch (error) {
    reason = `no se pudo verificar el instalador: ${String(error)}`;
  }
  if (reason !== null) {
    deps.log(`[anonly] updater: no se instala, la verificación falló: ${reason}`);
    try {
      await deps.discardDownload(file);
    } catch (error) {
      deps.log(`[anonly] updater: no se pudo descartar la descarga: ${String(error)}`);
    }
    return { ok: false, reason };
  }

  // La marca va primero: es lo que la aplicación usa al arrancar para limpiar
  // la entrada. Sin marca no se registra nada que nadie vaya a retirar.
  try {
    deps.writeMark({ version: update.version ?? "unknown", installerPath: file });
  } catch (error) {
    deps.log(`[anonly] updater: no se pudo escribir la marca de instalación: ${String(error)}`);
    return { ok: true };
  }
  try {
    deps.registerRecovery(file);
  } catch (error) {
    deps.log(`[anonly] updater: no se pudo registrar la recuperación: ${String(error)}`);
  }
  return { ok: true };
}
