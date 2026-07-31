/**
 * `SettingsButton` (`ui/Components.md` §2.6).
 *
 * Trigger: icono de engranaje en el Toolbar, siempre visible
 * (`ui/UX_Guidelines.md` §2). `aria-label="Configuración"`.
 */

import { SettingsIcon } from "lucide-react";
import { useState } from "react";

import { SettingsDialog } from "./SettingsDialog.js";

export function SettingsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Configuración"
        className="anonly-button-ghost"
        onClick={() => setOpen(true)}
      >
        <SettingsIcon className="h-4 w-4" aria-hidden />
      </button>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
