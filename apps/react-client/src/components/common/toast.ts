/**
 * `toast.ts` — emisor imperativo de toasts (`ui/Components.md` §8.6).
 *
 * **Fuera de Zustand a propósito.** Un toast no es estado de la aplicación:
 * es un evento efímero que nadie más lee, con un solo consumidor (`ToastHost`)
 * y vida propia de unos segundos. Agregarlo como slice contradiría
 * `React_Client.md` §3, que enumera los slices que existen. Un módulo
 * imperativo con suscripción es el mismo patrón que el repo ya usó para
 * `scrollSyncController` (ADR-054 §3) y por la misma razón: estado de UI que
 * no pertenece al árbol de React.
 *
 * ADR-169 §7/§10: el toast gana forma de tarjeta —título, una línea de
 * detalle y hasta dos acciones ("Ver en la lista", "Deshacer")—. Un solo
 * toast a la vez: el nuevo reemplaza al anterior (ADR-172 §3).
 */

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
  /** Atajo que se muestra dentro del botón (p. ej. `Ctrl+Z`, ADR-172 §3). */
  readonly shortcut?: string;
}

// `Components.md` §8.6 documenta cuatro tonos (`info`, `success`, `warning`,
// `error`); la implementación fue sumándolos según hizo falta uno nuevo.
// `warning` lo suma ADR-174 §4: el toast persistente de un choque sin
// resolver ("Quedó un choque sin resolver en «X»…") no es ni un éxito
// (`success`) ni informativo de lo de siempre (`neutral`/`info`). `error` lo
// suma ADR-175 §3: el caso que rompe el invariante del Core
// (`occurrenceCount > 0` sin `heldConflictIds` ni `groupIds`) — *"No se pudo
// agregar «X»."* — no es una advertencia que el usuario tenga que resolver,
// es una falla.
export type ToastTone = "success" | "neutral" | "warning" | "error";

export interface ToastInput {
  readonly title: string;
  /** Línea secundaria: "Persona N.º 06 · 2 apariciones ocultas". */
  readonly description?: string;
  /** `success` para un agregado (ícono de check); `neutral` para el resto. */
  readonly tone?: ToastTone;
  readonly actions?: ReadonlyArray<ToastAction>;
  /**
   * ADR-174 §4: el toast de un choque sin resolver no se va solo — sigue
   * hasta que el usuario elige en `ManualOverlapDialog` (o lo cierra a
   * mano). El resto de los toasts sigue expirando a los
   * `TOAST_DURATION_MS` de siempre (`ToastHost`).
   */
  readonly persistent?: boolean;
}

export interface ToastMessage extends ToastInput {
  /** Identidad de la instancia; monótona, para que Radix remonte cada toast. */
  readonly id: number;
}

type Listener = (toast: ToastMessage | null) => void;

const listeners = new Set<Listener>();
let nextId = 0;

export function subscribeToToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Muestra un toast, reemplazando al que hubiera. Devuelve el mensaje armado
 * (con su `id`) para quien necesite saber, más tarde, si el toast que ve en
 * pantalla sigue siendo el que mostró — `ManualOverlapDialogHost` lo usa para
 * el aviso persistente de ADR-175 §5: no lo vuelve a mostrar mientras siga
 * siendo el vigente, y lo retira si deja de corresponder.
 */
export function showToast(input: ToastInput): ToastMessage {
  nextId += 1;
  const toast: ToastMessage = { id: nextId, ...input };
  for (const listener of listeners) listener(toast);
  return toast;
}

/** Cierra el toast vigente, si hay uno. */
export function dismissToast(): void {
  for (const listener of listeners) listener(null);
}
