import { join } from "node:path";

/**
 * Puente al actualizador de macOS (ADR-131 §3).
 *
 * Es Sparkle y no el `autoUpdater` de Electron por una razón concreta:
 * Squirrel.Mac —el que Electron trae de fábrica— exige una identidad de firma
 * de Apple **antes** de aplicar una actualización, y falla con `Could not get
 * code signature for running application`. Ese requisito es de Squirrel, no
 * del sistema operativo. Sparkle valida con una clave EdDSA propia del
 * desarrollador, así que el auto-update funciona sin los USD 99/año.
 *
 * En Windows no se usa nada de esto: ahí anda `electron-updater`.
 */

/** Lo que expone el addon nativo. Se declara acá porque no tiene tipos propios. */
export interface SparkleBridge {
  init(options: { appcastUrl: string; publicEdKey: string }): boolean;
  checkForUpdates(): void;
  installUpdateNow(): void;
  setAutomaticChecks(enabled: boolean): void;
  setEventHandler(handler: (event: SparkleEvent) => void): void;
}

export interface SparkleEvent {
  readonly type: string;
  readonly version?: string;
  readonly percent?: number;
  readonly message?: string;
}

/** Lo único que cruza al renderer. */
export interface UpdateEventPayload {
  readonly type: string;
  readonly version?: string;
  readonly percent?: number;
}

/**
 * Construye lo que viaja al renderer por IPC, **por lista blanca**.
 *
 * Es una función aparte y no un literal adentro del handler para que el gate
 * `updater-payload-clean` (ADR-132 §5) pueda probarla. La propiedad a sostener
 * es que por este canal **nunca** viaje contenido, nombre ni metadato de un
 * documento (ADR-131 §5), y una lista blanca la sostiene aunque el evento de
 * Sparkle gane campos nuevos en una versión futura — que es exactamente el
 * caso en que una copia con spread fallaría en silencio.
 *
 * `message` queda afuera a propósito: es texto de error de la librería y no
 * hay nada que garantice que no incluya una ruta del sistema.
 */
export function toUpdateEventPayload(event: SparkleEvent): UpdateEventPayload {
  return {
    type: event.type,
    ...(event.version === undefined ? {} : { version: event.version }),
    ...(event.percent === undefined ? {} : { percent: event.percent }),
  };
}

/**
 * Dónde vive el addon compilado.
 *
 * Empaquetado va como recurso y **no** adentro del asar: es un binario nativo,
 * y `dlopen` no puede abrir un archivo que está dentro de un archivo. La
 * jerarquía `native/build/Release` se conserva tal cual porque el `rpath` que
 * `binding.gyp` le compila —`@loader_path/../../vendor`— la asume: mover el
 * `.node` sin mover `Sparkle.framework` en paralelo lo deja sin poder
 * resolver el framework en runtime.
 */
export function resolveAddonPath(options: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly shellDir: string;
}): string {
  const root = options.isPackaged
    ? join(options.resourcesPath, "native")
    : join(options.shellDir, "..", "native");
  return join(root, "build", "Release", "sparkle_bridge.node");
}

/**
 * Carga el addon, o `null` si no está disponible.
 *
 * Nunca tira: que el actualizador no cargue **no puede impedir que la app
 * abra**. Anonly anonimiza documentos sin tocar la red; quedarse sin la
 * comodidad de actualizarse solo es un problema menor que no arrancar.
 */
export function loadBridge(
  options: Parameters<typeof resolveAddonPath>[0],
  log: (message: string) => void,
): SparkleBridge | null {
  if (process.platform !== "darwin") return null;

  const addonPath = resolveAddonPath(options);
  try {
    /*
     * `require` dinámico, y no un `import`: la ruta se calcula en runtime
     * (cambia entre desarrollo y app empaquetada) y el archivo es un binario
     * nativo, que un `import` estático no puede resolver ni el bundler seguir.
     * Es el mecanismo que Node expone para cargar addons; la regla asume
     * imports de módulos, que no es este caso.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const addon: unknown = require(addonPath);
    if (typeof addon !== "object" || addon === null) return null;
    return addon as SparkleBridge;
  } catch (error) {
    log(`[anonly] actualizador no disponible: ${String(error)}`);
    return null;
  }
}
