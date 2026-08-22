/**
 * `ConfirmDialog` — confirmación genérica y reusable (`ui/Components.md` §8.2b).
 *
 * Usos MVP en este PR: cancelar pipeline (`CancelButton`), reanalizar por
 * cambio de settings NER/OCR (`SettingsDialog`), y "cerrar documento" ofrecido
 * desde `PasswordDialog`.
 */

import { Button, type ButtonVariant } from "./Button.js";
import { Dialog } from "./Dialog.js";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly variant?: "danger";
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Deshabilita ambos botones mientras una confirmación asíncrona está en vuelo (p. ej. `SettingsDialog` reanalizando). */
  readonly busy?: boolean;
  /** Mensaje de error inline (p. ej. un `reanalyze` que rechazó). */
  readonly errorMessage?: string | null;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant,
  onConfirm,
  onCancel,
  busy = false,
  errorMessage = null,
}: ConfirmDialogProps) {
  const confirmVariant: ButtonVariant = variant === "danger" ? "danger" : "primary";

  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <p className="mb-4 text-sm text-text-secondary">{message}</p>
      {errorMessage ? (
        <p role="alert" className="mb-4 text-sm text-error">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} loading={busy}>
          {busy ? "Guardando…" : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
