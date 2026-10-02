/**
 * Política de cuándo el shell instala una actualización ya descargada
 * (ADR-197 §1 a §3, Windows).
 *
 * Es un módulo puro, sin Electron, junto a `update-check-policy.ts`: la
 * decisión de qué hacer con cada mensaje `updater:set-install-on-quit`, con
 * cada cierre de la aplicación y con cada pedido de instalación del usuario se
 * prueba con dobles simples. `windows-updater.ts` es glue que ejecuta lo que
 * acá se decide.
 *
 * Instalar al cerrar no se puede decidir desde la interfaz, que en ese
 * momento ya no existe: por eso el contenedor guarda el modo (ADR-197 §3).
 */

/** Lo que se sabe de la actualización ya descargada. */
export interface DownloadedUpdate {
  readonly version: string | null;
  /** Ruta del instalador en la caché de `electron-updater`; `null` si el evento no la informó. */
  readonly file: string | null;
}

export type InstallRequest =
  | { readonly kind: "none" }
  | { readonly kind: "install"; readonly update: DownloadedUpdate };

export interface InstallPolicy {
  /**
   * Aplica el payload de `updater:set-install-on-quit`. Uno que no sea
   * `boolean` se ignora sin cambiar nada (ADR-197 §3).
   */
  onPreference(payload: unknown): void;
  /** Registra la actualización que `electron-updater` terminó de bajar. */
  onUpdateDownloaded(update: DownloadedUpdate): void;
  /**
   * La aplicación se está cerrando. Pide instalar solo si el modo es
   * «instalar al cerrar» y hay una descarga pendiente. Devolver `install` es
   * una sola vez: el cierre que sigue a esa instalación (o a su fallo) pasa
   * de largo.
   */
  onQuit(): InstallRequest;
  /** El usuario aceptó el aviso («Reiniciar ahora», «Reiniciar y actualizar»). */
  onUserRequest(): InstallRequest;
  /** La verificación falló o el instalador no se pudo lanzar: no hay instalación en curso. */
  onInstallFailed(): void;
}

export function createInstallPolicy(): InstallPolicy {
  // Hasta recibir el primer mensaje, no se instala al cerrar (ADR-197 §3).
  let installOnQuit = false;
  let downloaded: DownloadedUpdate | null = null;
  let installing = false;

  function request(): InstallRequest {
    if (installing || downloaded === null) return { kind: "none" };
    installing = true;
    return { kind: "install", update: downloaded };
  }

  return {
    onPreference(payload: unknown): void {
      if (typeof payload !== "boolean") return;
      installOnQuit = payload;
    },
    onUpdateDownloaded(update: DownloadedUpdate): void {
      downloaded = update;
    },
    onQuit(): InstallRequest {
      return installOnQuit ? request() : { kind: "none" };
    },
    onUserRequest(): InstallRequest {
      return request();
    },
    onInstallFailed(): void {
      installing = false;
      downloaded = null;
    },
  };
}
