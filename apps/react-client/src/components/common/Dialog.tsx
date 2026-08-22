/**
 * `Dialog` — wrapper sobre Radix `Dialog` con focus trap, escape para cerrar y
 * backdrop (`ui/Components.md` §8.2). Base de `ConfirmDialog`, `SettingsDialog`
 * y `PasswordDialog`.
 */

import * as RadixDialog from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  /** Oculta el botón `[x]` de cierre (p. ej. cuando el cierre solo debe pasar por botones explícitos). */
  readonly hideCloseButton?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  hideCloseButton = false,
}: DialogProps) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-bg-primary p-5 shadow-md focus:outline-none">
          <div className="mb-3 flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-sm font-semibold text-text-primary">
              {title}
            </RadixDialog.Title>
            {hideCloseButton ? null : (
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  aria-label="Cerrar"
                  className="rounded-md p-1 text-text-secondary hover:bg-bg-tertiary"
                >
                  <XIcon className="h-4 w-4" aria-hidden />
                </button>
              </RadixDialog.Close>
            )}
          </div>
          {description ? (
            <RadixDialog.Description className="mb-3 text-sm text-text-secondary">
              {description}
            </RadixDialog.Description>
          ) : null}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
