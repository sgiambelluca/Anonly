/**
 * `DegradedBadge` (`ui/Components.md` §3.3, ADR-058 §7 + ADR-062).
 *
 * Avisa que el texto de reemplazo de este grupo **no entró** en alguna de sus
 * apariciones y hubo que achicarlo tanto que quedó difícil de leer.
 *
 * Es la mitad "después" del aviso de longitud: `EditReplacementDialog` avisa
 * **antes** de guardar ("puede no entrar"), y esto avisa **después**, cuando
 * el render ya midió de verdad. Sin esto, el texto se achica en silencio y el
 * usuario se entera mirando el PDF exportado página por página — que es
 * justamente lo que ADR-062 llama "una palanca que existía y era invisible".
 *
 * **El texto no usa jerga.** El usuario no sabe qué es un token, ni un
 * placeholder, ni un bbox, ni le importa el cociente contra
 * `DEGRADED_FONT_RATIO`. Lo único que necesita saber es: qué pasó, dónde, y
 * qué puede hacer. Por eso dice "quedó muy chico y puede no leerse" y nombra
 * las páginas — no "reemplazo degradado bajo el umbral de legibilidad".
 *
 * Es **accionable**, no informativa (`Components.md` §3.3): las tres salidas
 * que ofrece existen todas desde antes — acortar el texto
 * (`EditReplacementDialog`), tapar con un bloque negro (`redact`, que nunca
 * tiene problema de espacio) o dejar el dato a la vista (deshabilitar).
 */

import { ReplacementMode, type EntityGroup } from "@anonly/anonymization-core";
import { AlertCircleIcon } from "lucide-react";
import { useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { selectDegradedPages, useDegradedStore } from "../../store/degraded.store.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { Tooltip } from "../common/Tooltip.js";

import { describePages } from "./degradedMessage.js";

export interface DegradedBadgeProps {
  readonly group: EntityGroup;
  /** Abre el editor de texto de reemplazo — la primera de las tres salidas. */
  readonly onEditReplacement: () => void;
}

export function DegradedBadge({ group, onEditReplacement }: DegradedBadgeProps) {
  const [open, setOpen] = useState(false);

  // El selector devuelve un STRING, no el array: `selectDegradedPages`
  // construye un array nuevo por llamada y zustand compara el snapshot con
  // `Object.is` -> cambio en cada render -> loop infinito -> UI en blanco. Es
  // el mismo pozo en el que ya caímos con `setSearchQuery`. Un primitivo es
  // estable y se re-expande acá, del lado del componente.
  const pagesKey = useDegradedStore((state) => selectDegradedPages(state, group.id).join(","));

  if (pagesKey === "") return null;

  const where = describePages(pagesKey.split(",").map(Number));

  return (
    <>
      <Tooltip content="El texto de reemplazo quedó muy chico">
        <button
          type="button"
          aria-label={`El reemplazo de ${group.canonicalValue} puede no leerse`}
          onClick={() => setOpen(true)}
          className="rounded-md p-0.5 text-warning hover:bg-bg-tertiary"
        >
          <AlertCircleIcon className="h-4 w-4" aria-hidden />
        </button>
      </Tooltip>

      <Dialog open={open} onClose={() => setOpen(false)} title="El reemplazo puede no leerse">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-text-primary">
            En {where}, el texto que reemplaza a{" "}
            <span className="font-medium">&quot;{group.canonicalValue}&quot;</span> no entraba en el
            espacio disponible y hubo que achicarlo. Puede quedar difícil de leer en el documento
            final.
          </p>
          <p className="text-sm text-text-secondary">
            El dato sigue oculto: esto es un problema de legibilidad, no de privacidad.
          </p>
          <p className="text-sm font-medium text-text-secondary">Podés:</p>
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                onEditReplacement();
              }}
            >
              Escribir un texto más corto
            </Button>
            {group.replacementMode === ReplacementMode.Redact ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  actions.updateGroup(group.id, { replacementMode: ReplacementMode.Redact });
                  setOpen(false);
                }}
              >
                Taparlo con un bloque negro
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                actions.updateGroup(group.id, { enabled: false });
                setOpen(false);
              }}
            >
              Dejarlo a la vista, sin ocultar
            </Button>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
        </div>
      </Dialog>
    </>
  );
}
