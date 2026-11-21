/**
 * `FieldHint` — la línea de ayuda de un campo (`UX_Guidelines.md` §11b.17).
 *
 * Una sola línea de 12 px y alto fijo debajo del campo. Siempre dice algo: la
 * ayuda en gris o, con error, el error en rojo con un ícono chico. El campo la
 * referencia con `aria-describedby={id}` (y, con error, `aria-invalid`).
 * No hay hueco vacío: la línea siempre ocupa su renglón y nada se mueve.
 *
 * **Un texto largo usa un segundo renglón** que se dibuja sobre el espacio que
 * hay hasta el bloque siguiente (16 px o más, lo garantiza quien la usa): el
 * renglón reservado sigue siendo uno, así que nada se mueve, y el «qué hacer»
 * del error, que va al final, no queda cortado. Si no entra en dos, «…» y el
 * texto completo en `title`.
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
      className={`relative h-4 min-w-0 text-xs leading-4 ${
        isError ? "font-medium text-error" : "text-text-secondary"
      }`}
    >
      <span className="absolute inset-x-0 top-0 flex min-w-0 items-start gap-1">
        {isError ? <TriangleAlertIcon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : null}
        <span className="line-clamp-2 min-w-0 flex-1">{content.text}</span>
      </span>
    </p>
  );
}
