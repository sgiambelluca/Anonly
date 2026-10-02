import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { autoUpdater } from "electron-updater";

import type { PendingInstallMark } from "./pending-install";
import { createWindowsUpdateCheckPolicy } from "./update-check-policy";
import { prepareVerifiedInstall } from "./update-install-flow";
import { createInstallPolicy, type DownloadedUpdate } from "./update-install-policy";
import { toUpdateEventPayload, type UpdateEventPayload } from "./updater";
import {
  clearInstallRecovery,
  registerRunOnceRecovery,
  writePendingInstallMark,
} from "./windows-install-recovery";
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

/** Lo que `update-downloaded` informa de la descarga: versión y archivo de la caché. */
function descarga(info: unknown): DownloadedUpdate {
  const version = conVersion(info).version ?? null;
  const file =
    typeof info === "object" &&
    info !== null &&
    "downloadedFile" in info &&
    typeof info.downloadedFile === "string"
      ? info.downloadedFile
      : null;
  return { version, file };
}

/**
 * Dónde guarda la marca de instalación y cómo pide cerrar (ADR-197). Entran
 * por parámetro porque este módulo no importa Electron.
 */
export interface WindowsUpdaterOptions {
  /** Carpeta de datos de la aplicación (`app.getPath("userData")`). */
  readonly userDataDir: string;
  /** `app.quit`: se usa cuando una instalación al cerrar se retoma o se descarta y el cierre sigue. */
  readonly quit: () => void;
}

/** El único campo del evento `before-quit` de Electron que se usa. */
export interface CancelableEvent {
  preventDefault(): void;
}

/** Lo que `main.ts` necesita para aplicar la preferencia de ADR-188 y la instalación de ADR-197. */
export interface WindowsUpdaterHandle {
  /**
   * Aplica la preferencia recibida por `updater:set-automatic-checks`. Un
   * payload no booleano se ignora. Dispara como máximo una búsqueda
   * automática por ejecución (`update-check-policy.ts`); la búsqueda manual
   * (`updater:check`) no pasa por acá y funciona siempre.
   */
  setAutomaticChecks(payload: unknown): void;
  /**
   * Aplica `updater:set-install-on-quit` (ADR-197 §3). Un payload no booleano
   * se ignora; hasta el primer mensaje válido no se instala al cerrar.
   */
  setInstallOnQuit(payload: unknown): void;
  /** El usuario aceptó el aviso: verifica, instala en silencio y reabre la aplicación. */
  installNow(): void;
  /**
   * `before-quit` de la aplicación. Si corresponde instalar al cerrar, cancela
   * este cierre, verifica e instala en silencio, y vuelve a cerrar.
   */
  onBeforeQuit(event: CancelableEvent): void;
}

/** Desenlace de un intento: `failed` = el instalador no se lanzó (limpia la recuperación). */
type InstallOutcome = "launched" | "rejected" | "failed";

export function startWindowsUpdater(
  emit: Emit,
  log: (message: string) => void,
  options: WindowsUpdaterOptions,
): WindowsUpdaterHandle {
  /*
   * Descarga sola. Cuándo instala lo decide `update-install-policy.ts`
   * (ADR-197 §1): al cerrar la aplicación en modo "Instalar automáticamente",
   * o cuando el usuario acepta el aviso.
   *
   * `autoInstallOnAppQuit` queda en `false` A PROPÓSITO. Su manejador de
   * salida llama a `install(true, false)` por su cuenta y de forma síncrona,
   * así que no deja lugar para volver a verificar el instalador ni para
   * registrar la recuperación ANTES de lanzarlo (ADR-197 §5.b y §5.c). Con
   * `true` el instalador saldría sin ninguna de las dos. La instalación al
   * cerrar la maneja `onBeforeQuit`: cancela el cierre, prepara, lanza el
   * instalador con `quitAndInstall(true, false)` y deja que el cierre siga.
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
  let downloadedSignature: WindowsUpdateSignatureDecodeResult = pendingSignature;
  const installPolicy = createInstallPolicy();

  signatureAwareUpdater.verifyUpdateCodeSignature = async (publisherNames, filePath) => {
    if (!pendingSignature.ok) return pendingSignature.error;

    const ownSignatureError = await verifyWindowsUpdateFile(filePath, pendingSignature.value);
    if (ownSignatureError !== null) return ownSignatureError;

    if (publisherNames.length === 1 && publisherNames[0] === ED25519_ONLY_PUBLISHER) {
      return null;
    }
    return verifyAuthenticode(publisherNames, filePath);
  };

  // Hay una descarga en curso: entre `update-available` y `update-downloaded`.
  let downloading = false;
  // `true` solo mientras corre, de forma síncrona, `quitAndInstall`; ver el handler de `error`.
  let inQuitAndInstall = false;
  let launchError: Error | null = null;

  autoUpdater.on("checking-for-update", () => {
    // Una búsqueda que se solapa con una descarga en curso NO reinicia la
    // firma: la verificación de la descarga (y la que se guarda al terminar)
    // seguiría contra una firma inválida y rechazaría una actualización buena.
    if (!downloading) {
      pendingSignature = { ok: false, error: "no hay metadata de firma para la actualización" };
    }
    emit(toUpdateEventPayload({ type: "checking" }));
  });
  autoUpdater.on("update-available", (info: unknown) => {
    downloading = true;
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
  autoUpdater.on("update-downloaded", (info: unknown) => {
    // Se guarda la firma de ESTA versión: una búsqueda posterior reinicia
    // `pendingSignature`, y la verificación previa a instalar (ADR-197 §5.b)
    // tiene que seguir siendo contra el manifiesto del archivo descargado.
    downloading = false;
    downloadedSignature = pendingSignature;
    installPolicy.onUpdateDownloaded(descarga(info));
    emit(toUpdateEventPayload({ type: "update-downloaded", ...conVersion(info) }));
  });
  autoUpdater.on("error", (error: Error) => {
    // El mensaje NO se propaga al renderer: `toUpdateEventPayload` lo descarta
    // por lista blanca (ADR-131 §5) y acá se registra sin adornarlo.
    log(`[anonly] updater: ${error.message}`);
    downloading = false;
    /*
     * Un `error` NO se toma como «el instalador no se lanzó» salvo dentro de la
     * llamada síncrona a `quitAndInstall`. En `BaseUpdater`/`NsisUpdater` los
     * fallos de lanzamiento llegan por `dispatchError`: síncronos si no hay
     * archivo o ya se había llamado (`install` devuelve `false`), y asíncronos si
     * el `spawn` falla (`spawnLog` rechaza, y de ahí el reintento con
     * `elevate.exe` o `shell.openPath`). Un `error` asíncrono es indistinguible
     * del de una búsqueda o una descarga que falla por su cuenta. La regla
     * segura: pasada la llamada síncrona no se borra la recuperación. Una entrada
     * `RunOnce` de más solo reintenta la instalación en el próximo inicio de
     * sesión (y la marca se limpia al arrancar); una de menos deja sin red a
     * quien se quedó con una instalación a medias.
     */
    if (inQuitAndInstall) launchError = error;
    emit(toUpdateEventPayload({ type: "error" }));
  });

  /*
   * ADR-188: ninguna consulta automática hasta que el renderer diga qué
   * prefiere el usuario. La decisión de si ESTE mensaje dispara una búsqueda
   * vive en `update-check-policy.ts`, puro y testeable sin Electron; acá solo
   * se ejecuta lo que la política resuelve.
   */
  const policy = createWindowsUpdateCheckPolicy();

  /**
   * Verifica de nuevo, deja la marca y la entrada de recuperación y recién
   * entonces lanza el instalador, en silencio (ADR-197 §2, §5). `restart`:
   * pedido del usuario, la aplicación se reabre sola. `quit`: instalación al
   * cerrar, sin reabrir.
   */
  async function install(
    update: DownloadedUpdate,
    mode: "restart" | "quit",
  ): Promise<InstallOutcome> {
    const preparation = await prepareVerifiedInstall(
      {
        verify: async (filePath) => {
          if (!downloadedSignature.ok) return downloadedSignature.error;
          return verifyWindowsUpdateFile(filePath, downloadedSignature.value);
        },
        writeMark: (mark: PendingInstallMark) => writePendingInstallMark(options.userDataDir, mark),
        registerRecovery: registerRunOnceRecovery,
        discardDownload: async (filePath) => {
          // `electron-updater` reutiliza la caché solo si el archivo existe y
          // su SHA-512 coincide con el manifiesto: sin el archivo vuelve a bajar.
          await rm(filePath, { force: true });
          await rm(join(dirname(filePath), "update-info.json"), { force: true });
        },
        log,
      },
      update,
    );

    if (!preparation.ok) {
      installPolicy.onInstallFailed();
      // ADR-197 §5.b: no es un `error` de red; la interfaz retira el aviso. Sin
      // más campos: el motivo queda en el log (ADR-131 §5).
      emit(toUpdateEventPayload({ type: "update-rejected" }));
      // El cierre ya había empezado: `runInstall` lo retoma, sin instalar nada.
      return "rejected";
    }

    /*
     * Lo que se verificó (`update.file`, el `downloadedFile` del evento) es el
     * MISMO archivo que `quitAndInstall` lanza: `electron-updater` guarda esa
     * ruta con `setDownloadedFile(updateFile, ...)` y la informa en el evento
     * con `downloadedFile: updateFile`, y `installerPath` devuelve
     * `downloadedUpdateHelper.file`, que es esa ruta. Un test estático lee el
     * código de `electron-updater` y falla si dejan de coincidir.
     */
    inQuitAndInstall = true;
    launchError = null;
    try {
      autoUpdater.quitAndInstall(true, mode === "restart");
    } finally {
      inQuitAndInstall = false;
    }
    return launchError === null ? "launched" : "failed";
  }

  /**
   * `install` nunca rechaza hacia afuera: cualquier excepción inesperada se
   * trata como un instalador que no se lanzó (se retiran marca y entrada, y la
   * política vuelve a «sin instalación»). En modo `quit` el cierre se retoma
   * EXACTAMENTE una vez por intento, en cualquier desenlace, para que no quede
   * un proceso vivo sin ventanas; en modo `restart` nunca.
   */
  async function runInstall(update: DownloadedUpdate, mode: "restart" | "quit"): Promise<void> {
    let outcome: InstallOutcome;
    try {
      outcome = await install(update, mode);
    } catch (error) {
      log(`[anonly] updater: la instalación falló: ${String(error)}`);
      outcome = "failed";
    }
    if (outcome === "failed") {
      clearInstallRecovery(options.userDataDir, log);
      installPolicy.onInstallFailed();
      // ADR-197 §5.b: el instalador no se lanzó; la descarga se dio de baja y la
      // interfaz retira la tarjeta (si no quedaría con un botón que ya no hace nada).
      emit(toUpdateEventPayload({ type: "update-rejected" }));
    }
    if (mode === "quit") options.quit();
  }

  return {
    setAutomaticChecks(payload: unknown): void {
      if (policy.onPreference(payload)) void autoUpdater.checkForUpdates();
    },
    setInstallOnQuit(payload: unknown): void {
      installPolicy.onPreference(payload);
    },
    installNow(): void {
      const request = installPolicy.onUserRequest();
      if (request.kind === "install") void runInstall(request.update, "restart");
    },
    onBeforeQuit(event: CancelableEvent): void {
      const request = installPolicy.onQuit();
      if (request.kind === "none") return;
      event.preventDefault();
      void runInstall(request.update, "quit");
    },
  };
}

/** Fuerza un chequeo (el botón "Buscar actualizaciones ahora"). */
export function checkWindowsUpdates(): void {
  void autoUpdater.checkForUpdates();
}
