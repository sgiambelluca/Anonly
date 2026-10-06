/**
 * `updater/` — la frontera con el actualizador del contenedor de escritorio.
 *
 * Es el equivalente de `core-adapter/` para el shell: **el único lugar del
 * cliente que sabe que `window.anonlyUpdater` existe**. Todo lo demás habla
 * con esta API, que devuelve `null` cuando no hay contenedor.
 *
 * Ese `null` no es defensivo por las dudas: los tests y cualquier ejecución en
 * un navegador corren sin shell, y la UI tiene que comportarse bien ahí — sin
 * controles de actualización y sin errores.
 *
 * Nada de lo que viaja por acá toca un documento: solo el ciclo de vida de la
 * actualización (ADR-131 §5).
 *
 * **`setAutomaticChecks` (ADR-188) no es el `setAutomatic` retirado en
 * ADR-132 §3.** Aquel colgaba del toggle de instalar y confundía buscar con
 * instalar; se sacó y el shell pasó a buscar siempre, lo que dejó sin cumplir
 * ADR-131 §5 ("el chequeo es desactivable"). Este mensaje cuelga de una
 * preferencia, `updateMode` (ADR-195; `off` es no buscar), que vive en
 * `settings.store.ts` y significa lo mismo que la propiedad de Sparkle: buscar,
 * no instalar. El shell no busca nada hasta que se lo llama.
 */

export interface UpdateEvent {
  readonly type: string;
  readonly version?: string;
  readonly percent?: number;
}

export interface ShellUpdater {
  onEvent(listener: (event: UpdateEvent) => void): void;
  check(): void;
  install(): void;
  /** ADR-188 §2: informa si el usuario quiere que la app busque sola. */
  setAutomaticChecks(enabled: boolean): void;
  /** ADR-197 §3: informa si la actualización se instala al cerrar la aplicación. */
  setInstallOnQuit(enabled: boolean): void;
}

const updateEventListeners = new WeakMap<ShellUpdater, Set<(event: UpdateEvent) => void>>();
const updateEventRelays = new WeakSet<ShellUpdater>();

/** Suscripción local que comparte el listener único del puente IPC. */
export function subscribeToUpdateEvents(
  updater: ShellUpdater,
  listener: (event: UpdateEvent) => void,
): () => void {
  let listeners = updateEventListeners.get(updater);
  if (listeners === undefined) {
    listeners = new Set();
    updateEventListeners.set(updater, listeners);
  }
  listeners.add(listener);
  if (!updateEventRelays.has(updater)) {
    updateEventRelays.add(updater);
    updater.onEvent((event) => {
      for (const activeListener of updateEventListeners.get(updater) ?? []) {
        activeListener(event);
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/*
 * El shell inyecta esto con `contextBridge.exposeInMainWorld`, así que declarar
 * la propiedad es lo que corresponde: el objeto **existe** en `window` cuando
 * hay contenedor. Declararla evita el `as unknown as` que hacía falta para
 * leerla, que `Code_Standards.md` §2 prohíbe en producción sin ADR propio.
 *
 * Queda como `unknown` a propósito: que la propiedad exista no dice nada sobre
 * su forma, y de validarla se encarga `isShellUpdater`.
 */
declare global {
  interface Window {
    readonly anonlyUpdater?: unknown;
  }
}

function isShellUpdater(value: unknown): value is ShellUpdater {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["onEvent"] === "function" &&
    typeof candidate["check"] === "function" &&
    typeof candidate["install"] === "function" &&
    typeof candidate["setAutomaticChecks"] === "function" &&
    typeof candidate["setInstallOnQuit"] === "function"
  );
}

/**
 * El actualizador del contenedor, o `null` si la app no corre adentro de uno.
 *
 * Se valida la forma en vez de confiar en que el objeto existe: `window` es
 * territorio compartido, y un `anonlyUpdater` que no cumple el contrato tiene
 * que leerse como "no hay actualizador" y no reventar la UI a mitad de un
 * render.
 */
export function getShellUpdater(): ShellUpdater | null {
  if (typeof window === "undefined") return null;
  const candidate = window.anonlyUpdater;
  return isShellUpdater(candidate) ? candidate : null;
}

/**
 * Envía la preferencia de búsqueda automática al shell (ADR-188 §2). Se llama
 * una vez al iniciar la app, después de leer la configuración persistida
 * (`App.tsx`), y cada vez que se guarda un cambio en Configuración
 * (`SettingsDialog.applyToStore`).
 *
 * Sin contenedor no hace nada: `getShellUpdater()` da `null` y no hay a quién
 * avisarle. Es el mismo `null` defensivo del resto de este módulo.
 */
export function sendAutomaticChecksPreference(enabled: boolean): void {
  getShellUpdater()?.setAutomaticChecks(enabled);
}

/**
 * Envía al shell si la actualización se instala al cerrar la aplicación
 * (ADR-197 §3). Vale `true` solo con `updateMode === "install"`. Se llama por
 * la misma vía que `sendAutomaticChecksPreference`: una vez al iniciar, después
 * de leer la configuración persistida, y cada vez que `updateMode` cambia. En
 * macOS el shell lo recibe y lo ignora (ADR-197 §6).
 */
export function sendInstallOnQuitPreference(enabled: boolean): void {
  getShellUpdater()?.setInstallOnQuit(enabled);
}
