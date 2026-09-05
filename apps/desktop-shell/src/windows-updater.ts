import { autoUpdater } from "electron-updater";

import { toUpdateEventPayload, type UpdateEventPayload } from "./updater";

/**
 * Actualizador de Windows (ADR-131 §2).
 *
 * Es `electron-updater` y no Sparkle porque en Windows no hace falta el rodeo:
 * Squirrel.Windows no exige un certificado para aplicar una actualización, que
 * es justamente lo que sí exige Squirrel.Mac y lo que obligó a traer Sparkle
 * del otro lado (ADR-131 §3).
 *
 * Lee el manifiesto que `electron-builder` publica en el release
 * (`latest.yml`) — el `publish` de `electron-builder.yml` es la fuente de esa
 * URL, así que no hay una constante duplicada acá.
 *
 * **Traduce sus eventos a los mismos que emite Sparkle**, así el renderer
 * consume un solo contrato y no sabe qué plataforma tiene abajo: es el mismo
 * aviso, el mismo toggle y el mismo `UpdateNotice` en los dos sistemas.
 */

/** Los mismos nombres de evento que reporta el puente de Sparkle. */
type Emit = (payload: UpdateEventPayload) => void;

/**
 * `exactOptionalPropertyTypes` no admite pasar `version: undefined`: omitir la
 * clave y ponerla en `undefined` son cosas distintas para el type-checker, y
 * acá la correcta es omitirla.
 */
function conVersion(info: { version?: string }): { version?: string } {
  return info.version === undefined ? {} : { version: info.version };
}

export function startWindowsUpdater(emit: Emit, log: (message: string) => void): void {
  /*
   * Descarga sola, instala cuando el usuario lo decide. Es el reparto que
   * ADR-131 §3 fija para las dos plataformas: bajar es barato y silencioso,
   * reemplazar la app es una decisión del usuario — y quien no quiera decidir
   * prende "Actualizar automáticamente" en Configuración, que el renderer
   * resuelve pidiendo la instalación apenas la descarga termina.
   */
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  /*
   * Sin firma de código, `electron-updater` no puede validar el publisher del
   * instalador que descarga, y aborta. Mientras el binario de Windows salga
   * sin certificado (ADR-131 §4: SignPath está pedido y no llegó), la
   * verificación se apaga explícitamente.
   *
   * **Lo que queda protegiendo el canal es HTTPS contra GitHub**, que impide
   * que alguien altere el instalador en tránsito pero no cubre un release
   * malicioso publicado desde una cuenta comprometida. macOS no tiene este
   * hueco: Sparkle valida con la clave EdDSA propia, que no vive en GitHub.
   *
   * Se revierte —borrando estas dos líneas— el día que el certificado exista.
   */
  const conVerificacion = autoUpdater as unknown as { verifyUpdateCodeSignature?: boolean };
  conVerificacion.verifyUpdateCodeSignature = false;

  autoUpdater.on("checking-for-update", () => emit(toUpdateEventPayload({ type: "checking" })));
  autoUpdater.on("update-available", (info: { version?: string }) =>
    emit(toUpdateEventPayload({ type: "update-available", ...conVersion(info) })),
  );
  autoUpdater.on("update-not-available", () =>
    emit(toUpdateEventPayload({ type: "update-not-available" })),
  );
  autoUpdater.on("download-progress", (p: { percent?: number }) =>
    emit(
      toUpdateEventPayload({
        type: "download-progress",
        ...(p.percent === undefined ? {} : { percent: p.percent }),
      }),
    ),
  );
  autoUpdater.on("update-downloaded", (info: { version?: string }) =>
    emit(toUpdateEventPayload({ type: "update-downloaded", ...conVersion(info) })),
  );
  autoUpdater.on("error", (error: Error) => {
    // El mensaje NO se propaga al renderer: `toUpdateEventPayload` lo descarta
    // por lista blanca (ADR-131 §5) y acá se registra sin adornarlo.
    log(`[anonly] updater: ${error.message}`);
    emit(toUpdateEventPayload({ type: "error" }));
  });

  void autoUpdater.checkForUpdates();
}

/** Aplica la actualización ya descargada y reinicia. */
export function installWindowsUpdate(): void {
  autoUpdater.quitAndInstall();
}

/** Fuerza un chequeo (el botón "Buscar actualizaciones ahora"). */
export function checkWindowsUpdates(): void {
  void autoUpdater.checkForUpdates();
}
