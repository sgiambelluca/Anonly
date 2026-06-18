/**
 * @anonly/shared — Wrapper para buffers transferidos zero-copy a Workers.
 *
 * Fuente de verdad: docs/core/Contracts.md §7 y docs/architecture/05_Worker_Architecture.md §2.3.
 *
 * Reglas:
 * - Solo se puede consumir una vez. Tras consume(), el buffer ya no pertenece al emisor.
 * - El type system garantiza que no se use un buffer ya transferido.
 */

export interface Transferable<T extends ArrayBuffer | ImageData = ArrayBuffer> {
  readonly buffer: T;
  consume(): T;
}

export function makeTransferable<T extends ArrayBuffer | ImageData>(buffer: T): Transferable<T> {
  let consumed = false;
  return {
    buffer,
    consume(): T {
      if (consumed) {
        throw new Error(
          "Transferable ya consumido. No se puede usar un buffer transferido dos veces.",
        );
      }
      consumed = true;
      return buffer;
    },
  };
}

export function isTransferable(value: unknown): value is Transferable {
  return (
    typeof value === "object" &&
    value !== null &&
    "buffer" in value &&
    typeof (value as Record<string, unknown>).consume === "function"
  );
}
