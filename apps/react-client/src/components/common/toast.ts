/**
 * `toast.ts` — emisor imperativo de toasts (`ui/Components.md` §8.6).
 *
 * **Fuera de Zustand a propósito.** Un toast no es estado de la aplicación:
 * es un evento efímero que nadie más lee, con un solo consumidor (`ToastHost`)
 * y vida propia de 5 segundos. Agregarlo como octavo slice contradiría
 * `React_Client.md` §3, que enumera los slices que existen. Un módulo
 * imperativo con suscripción es el mismo patrón que el repo ya usó para
 * `scrollSyncController` (ADR-054 §3) y por la misma razón: estado de UI que
 * no pertenece al árbol de React.
 */

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ToastMessage {
  /** Identidad de la instancia; monótona, para que Radix remonte cada toast. */
  readonly id: number;
  readonly text: string;
  readonly action?: ToastAction;
}

type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();
let nextId = 0;

export function subscribeToToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Muestra un toast. Sin `action` es un aviso pasivo; con `action` es la
 * afordancia de "Deshacer" de ADR-087 §3.3.
 */
export function showToast(text: string, action?: ToastAction): void {
  nextId += 1;
  const toast: ToastMessage = { id: nextId, text, ...(action !== undefined ? { action } : {}) };
  for (const listener of listeners) listener(toast);
}
