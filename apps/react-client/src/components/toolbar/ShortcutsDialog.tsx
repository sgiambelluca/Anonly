/**
 * `ShortcutsDialog` (`ui/Components.md` §13b.8, ADR-229 §8): la ayuda de atajos.
 * Se abre desde «Ver atajos…» en Configuración y, al cerrarse, deja a la vista
 * Configuración (que sigue abierto debajo). No hay ícono de atajos en la barra.
 *
 * La tabla sale de `shortcuts.ts`, la misma que declara los atajos (ADR-224 §5):
 * con las teclas de cada sistema (`⌘` en Mac, `Ctrl` en el resto).
 */

import { ChevronLeftIcon, KeyboardIcon } from "lucide-react";

import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import {
  shortcutGroups,
  shortcutsLead,
  type ShortcutPlatform,
  type ShortcutRow,
} from "./shortcuts.js";

export interface ShortcutsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly platform: ShortcutPlatform;
}

export function ShortcutsDialog({ open, onClose, platform }: ShortcutsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Atajos de teclado"
      description={shortcutsLead(platform)}
      size="xl"
      icon={
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-tertiary text-text-secondary">
          <KeyboardIcon className="h-5 w-5" aria-hidden />
        </span>
      }
      footer={
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            <ChevronLeftIcon className="h-4 w-4" aria-hidden />
            Volver a Configuración
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 pb-1">
        {shortcutGroups(platform).map((group) => (
          <section key={group.id} aria-label={group.title} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              {group.title}
            </h3>
            <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
              {group.rows.map((row, index) => (
                <ShortcutRowView key={row.id} row={row} first={index === 0} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

function ShortcutRowView({ row, first }: { readonly row: ShortcutRow; readonly first: boolean }) {
  return (
    <li
      className={`grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5 text-sm ${
        first ? "" : "border-t border-border"
      }`}
    >
      <span className="text-text-primary">{row.label}</span>
      <span className="flex flex-wrap items-center justify-end gap-1 text-text-secondary">
        {row.combos.map((combo, comboIndex) => (
          <span key={comboIndex} className="flex items-center gap-1">
            {comboIndex > 0 ? <span className="mx-0.5">o</span> : null}
            {combo.map((key) => (
              <kbd
                key={key}
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 border-border bg-bg-secondary px-1.5 font-sans text-sm font-semibold text-text-primary"
              >
                {key}
              </kbd>
            ))}
          </span>
        ))}
      </span>
    </li>
  );
}
