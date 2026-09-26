/**
 * Política de cuándo el shell busca actualizaciones por su cuenta (ADR-188).
 *
 * Es un módulo puro, sin Electron: la decisión de qué hacer con cada mensaje
 * `updater:set-automatic-checks` se puede probar con dobles simples, igual
 * que la verificación de ADR-137 (`windows-update-signature.ts`). Quien lo usa
 * (`windows-updater.ts` para Windows, `main.ts` para macOS) es glue code que
 * ejecuta lo que acá se decide.
 *
 * Las dos plataformas comparten la misma validación de entrada —el payload
 * que cruza el IPC es `unknown`, y ADR-188 §2 dice que uno que no sea
 * `boolean` se ignora sin cambiar nada— pero difieren en qué hacen con un
 * mensaje válido, así que exponen políticas separadas.
 */

/** Valida el payload que cruza `updater:set-automatic-checks`. */
function isAutomaticChecksPreference(payload: unknown): payload is boolean {
  return typeof payload === "boolean";
}

/**
 * Windows (`electron-updater`, ADR-188 §3): como máximo una búsqueda
 * automática por ejecución, la primera vez que la preferencia recibida es
 * `true`. Un `false` no dispara nada, y no cuenta como "ya hubo una búsqueda"
 * — un `true` posterior sigue pudiendo disparar la primera.
 */
export interface WindowsUpdateCheckPolicy {
  /**
   * `true` si, y solo si, corresponde iniciar una búsqueda automática ahora
   * mismo. Un payload no booleano, o un `true` que llega después de que ya se
   * disparó una búsqueda en esta ejecución, devuelve `false` sin efecto.
   */
  onPreference(payload: unknown): boolean;
}

export function createWindowsUpdateCheckPolicy(): WindowsUpdateCheckPolicy {
  let alreadyChecked = false;
  return {
    onPreference(payload: unknown): boolean {
      if (!isAutomaticChecksPreference(payload) || !payload || alreadyChecked) return false;
      alreadyChecked = true;
      return true;
    },
  };
}

/**
 * macOS (Sparkle, ADR-188 §3): `bridge.init(...)` se difiere hasta el primer
 * mensaje válido. Ese primer mensaje pide `init` seguido de
 * `setAutomaticChecks`, en ese orden y en el mismo tick de JavaScript —el
 * `run loop` de Sparkle no agenda su primera consulta hasta que el tick
 * termina, así que la preferencia real ya está aplicada para entonces—. Los
 * mensajes siguientes solo piden `setAutomaticChecks`, con cualquier valor.
 */
export type MacUpdateCheckAction =
  | { readonly kind: "ignore" }
  | { readonly kind: "init-and-set"; readonly enabled: boolean }
  | { readonly kind: "set"; readonly enabled: boolean };

export interface MacUpdateCheckPolicy {
  onPreference(payload: unknown): MacUpdateCheckAction;
}

export function createMacUpdateCheckPolicy(): MacUpdateCheckPolicy {
  let initialized = false;
  return {
    onPreference(payload: unknown): MacUpdateCheckAction {
      if (!isAutomaticChecksPreference(payload)) return { kind: "ignore" };
      if (!initialized) {
        initialized = true;
        return { kind: "init-and-set", enabled: payload };
      }
      return { kind: "set", enabled: payload };
    },
  };
}
