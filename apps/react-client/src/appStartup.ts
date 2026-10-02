/**
 * `appStartup.ts` — la secuencia de arranque de `App.tsx` que le avisa al
 * shell la preferencia de búsqueda automática (ADR-188 §2).
 *
 * Separada del componente para poder probar el ORDEN sin jsdom ni
 * `@testing-library`: agregar esas dependencias para renderizar `App` y
 * observar un efecto secundario exigiría un ADR (R-12, sin dependencias
 * externas nuevas sin uno) que no existe. Extraer la secuencia a una función
 * pura que recibe sus dependencias —el mismo criterio que
 * `computeReanalyzeRenderRequest` o `resolveOcrLanguagesSlot`— prueba la
 * propiedad que importa sin pagar ese costo. `App.tsx` se limita a llamarla
 * con sus dependencias reales.
 */

export interface SettingsBootstrapDeps {
  /** Hidrata el store desde `localStorage` (`useSettingsStore.getState().load`). */
  readonly load: () => void;
  /** Si la app busca por su cuenta (`updateMode !== "off"`, ADR-195). Se llama DESPUÉS de `load()`, nunca antes. */
  readonly getCheckUpdates: () => boolean;
  /** `sendAutomaticChecksPreference` real, o un doble en los tests. */
  readonly sendAutomaticChecksPreference: (enabled: boolean) => void;
  /** Si el modo es instalar al cerrar (`updateMode === "install"`, ADR-197 §3). Se llama DESPUÉS de `load()`. */
  readonly getInstallOnQuit: () => boolean;
  /** `sendInstallOnQuitPreference` real, o un doble en los tests. */
  readonly sendInstallOnQuitPreference: (enabled: boolean) => void;
}

/**
 * Hidrata los settings persistidos y avisa al shell la preferencia, en ese
 * orden (ADR-188 §2: "una vez al iniciar, DESPUÉS de leer la configuración
 * persistida"). Invertir el orden mandaría el default del store —`true`— en
 * vez del valor real de una sesión anterior que lo haya apagado.
 */
export function bootstrapAutomaticChecksPreference(deps: SettingsBootstrapDeps): void {
  deps.load();
  deps.sendAutomaticChecksPreference(deps.getCheckUpdates());
  // ADR-197 §3: el contenedor no instala al cerrar hasta recibir este mensaje.
  deps.sendInstallOnQuitPreference(deps.getInstallOnQuit());
}
