/**
 * `FieldHint` — la línea de ayuda de un campo (`UX_Guidelines.md` §11b.17).
 *
 * Una sola línea de 12 px y alto fijo debajo del campo. Siempre dice algo: la
 * ayuda en gris o, con error, el error en rojo con un ícono chico. Si el texto
 * no entra se corta con «…» y el texto completo queda en `title`. El campo la
 * referencia con `aria-describedby={id}` (y, con error, `aria-invalid`).
 * No hay hueco vacío: la línea siempre ocupa su renglón y nada se mueve.
 */

import { TriangleAlertIcon } from "lucide-react";

import { resolveFieldHint } from "./fieldHintText.js";

export interface FieldHintProps {
  /** El `id` al que apunta el `aria-describedby` del campo. */
  readonly id: string;
  /** La ayuda sin error: contador, pista o cómo queda. */
  readonly help: string;
  /** El texto del error; `null` si no hay. */
  readonly error?: string | null;
}

export function FieldHint({ id, help, error = null }: FieldHintProps) {
  const content = resolveFieldHint(help, error);
  const isError = content.kind === "error";
  return (
    <p
      id={id}
      role={isError ? "alert" : undefined}
      aria-live="polite"
      title={content.text}
      className={`flex h-4 min-w-0 items-center gap-1 text-xs leading-4 ${
        isError ? "font-medium text-error" : "text-text-secondary"
      }`}
    >
      {isError ? <TriangleAlertIcon className="h-3 w-3 shrink-0" aria-hidden /> : null}
      <span className="min-w-0 flex-1 truncate">{content.text}</span>
    </p>
  );
}
