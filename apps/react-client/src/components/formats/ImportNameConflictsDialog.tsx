/**
 * `ImportNameConflictsDialog` — el paso «Hay formatos con un nombre que ya
 * usás», antes del resumen de la importación (`Components.md` §13b.4, ADR-223
 * §6, decisión del mantenedor del 2026-11-20).
 *
 * Cada formato del archivo cuyo nombre choca con uno que el usuario ya tiene
 * (sin ser idéntico) trae su campo con el nombre del archivo y, debajo, en una
 * **línea de ayuda** (§11b.17), el texto de `name_taken` (`UX_Guidelines.md` §11b.16)
 * mientras siga chocando, también contra otro formato del mismo archivo.
 * «Importar» queda apagado hasta que no quede ningún conflicto. «Cancelar» no
 * importa nada.
 */

import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { FieldHint } from "../common/FieldHint.js";
import { fieldBorderClass } from "../common/fieldHintText.js";

/** La ayuda bajo el nombre cuando ya no choca (§11b.17). */
export const NAME_CONFLICT_HELP = "Así se va a ver en tu lista de formatos";

export interface NameConflictEntry {
  /** Posición del formato en el archivo: la clave del renombre. */
  readonly index: number;
  /** Lo que muestra el campo. */
  readonly value: string;
  /** El texto de falla mientras siga chocando; `null` si ya no. */
  readonly slot: string | null;
}

export interface ImportNameConflictsDialogProps {
  /** `null` = cerrado. */
  readonly entries: ReadonlyArray<NameConflictEntry> | null;
  readonly onRename: (index: number, name: string) => void;
  readonly onImport: () => void;
  readonly onCancel: () => void;
}

export function ImportNameConflictsDialog({
  entries,
  onRename,
  onImport,
  onCancel,
}: ImportNameConflictsDialogProps) {
  const unresolved = entries?.some((entry) => entry.slot !== null) ?? false;
  return (
    <Dialog
      open={entries !== null}
      onClose={onCancel}
      role="alertdialog"
      title="Hay formatos con un nombre que ya usás"
      description="Ponele otro nombre a cada uno para distinguirlos en la lista. No se importa nada hasta resolverlo."
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={unresolved} onClick={onImport}>
            Importar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {(entries ?? []).map((entry) => (
          <div key={entry.index} className="flex flex-col gap-1">
            <input
              type="text"
              value={entry.value}
              aria-label="Nombre del formato"
              aria-invalid={entry.slot !== null}
              aria-describedby={`import-name-hint-${entry.index}`}
              onChange={(event) => onRename(entry.index, event.target.value)}
              className={`rounded-lg border ${fieldBorderClass(entry.slot !== null)} bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            />
            {/* Línea de ayuda (§11b.17): sin choque dice cómo se ve; con choque, el error. */}
            <FieldHint
              id={`import-name-hint-${entry.index}`}
              help={NAME_CONFLICT_HELP}
              error={entry.slot}
            />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
