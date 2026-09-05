import { autoUpdater } from "electron-updater";

import { toUpdateEventPayload, type UpdateEventPayload } from "./updater";
import {
  decodeWindowsUpdateSignature,
  ED25519_ONLY_PUBLISHER,
  verifyWindowsUpdateFile,
  type WindowsUpdateSignatureDecodeResult,
} from "./windows-update-signature";

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

type VerifyUpdateCodeSignature = (
  publisherNames: string[],
  filePath: string,
) => Promise<string | null>;

interface SignatureAwareUpdater {
  verifyUpdateCodeSignature: VerifyUpdateCodeSignature;
}

/**
 * `exactOptionalPropertyTypes` no admite pasar `version: undefined`: omitir la
 * clave y ponerla en `undefined` son cosas distintas para el type-checker, y
 * acá la correcta es omitirla.
 */
function conVersion(info: unknown): { version?: string } {
  if (typeof info !== "object" || info === null || !("version" in info)) return {};
  return typeof info.version === "string" ? { version: info.version } : {};
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
   * ADR-137: `electron-updater` ofrece un único slot de verificación. Se
   * conserva primero el verificador Authenticode original y se instala uno
   * compuesto que siempre exige Ed25519.
   *
   * Mientras el publisher sea el valor reservado, no existe certificado y la
   * verificación propia es la única aplicable. Cuando SignPath llegue, el YAML
   * cambia al DN/CN real y esta misma función ejecuta además el verificador
   * Authenticode guardado. Ninguna capa reemplaza a la otra.
   *
   * El manifiesto se decodifica al recibir `update-available`, antes de que la
   * descarga automática empiece. Una metadata ausente o inválida se conserva
   * como un rechazo: no se interpreta como un error transitorio de red.
   */
  const signatureAwareUpdater = autoUpdater as typeof autoUpdater & SignatureAwareUpdater;
  const verifyAuthenticode = signatureAwareUpdater.verifyUpdateCodeSignature;
  let pendingSignature: WindowsUpdateSignatureDecodeResult = {
    ok: false,
    error: "no hay metadata de firma para la actualización",
  };

  signatureAwareUpdater.verifyUpdateCodeSignature = async (publisherNames, filePath) => {
    if (!pendingSignature.ok) return pendingSignature.error;

    const ownSignatureError = await verifyWindowsUpdateFile(filePath, pendingSignature.value);
    if (ownSignatureError !== null) return ownSignatureError;

    if (publisherNames.length === 1 && publisherNames[0] === ED25519_ONLY_PUBLISHER) {
      return null;
    }
    return verifyAuthenticode(publisherNames, filePath);
  };

  autoUpdater.on("checking-for-update", () => {
    pendingSignature = { ok: false, error: "no hay metadata de firma para la actualización" };
    emit(toUpdateEventPayload({ type: "checking" }));
  });
  autoUpdater.on("update-available", (info: unknown) => {
    pendingSignature = decodeWindowsUpdateSignature(info);
    if (!pendingSignature.ok) log(`[anonly] updater: ${pendingSignature.error}`);
    emit(toUpdateEventPayload({ type: "update-available", ...conVersion(info) }));
  });
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
  autoUpdater.on("update-downloaded", (info: unknown) =>
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
