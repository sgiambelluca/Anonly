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
 * **No expone `setAutomatic`.** El shell chequea siempre; que el usuario
 * prefiera que le pregunten o que se instale solo se resuelve acá, con el
 * setting que ya está en `localStorage`, sin cruzar el IPC (ADR-132 §3).
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
    typeof candidate["install"] === "function"
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
