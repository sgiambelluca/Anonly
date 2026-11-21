/**
 * `ExportFormatsDialog` — elegir qué tipos y formatos propios van al archivo
 * (`Components.md` §13b.4, ADR-227 §6, ADR-223 §5).
 *
 * Dos listas de `Checkbox`:
 * - «Tus tipos · viajan con todos sus formatos», con los formatos anidados y
 *   estado mixto en el tipo;
 * - «Tuyos, en tipos del catálogo · viajan solos».
 *
 * «Elegir todo» y «Nada». El pie lleva el resumen y «Exportar archivo», apagado
 * sin selección, y aclara qué **no** viaja (el país ni qué formatos del
 * catálogo están prendidos). Baja `formatos.anonly-formatos` como cualquier
 * descarga. Exporta lo que ve el árbol: el borrador.
 */

import type { UserEntityTypeId } from "@anonly/anonymization-core";
import { InfoIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DetectionState } from "../../store/detectionState.js";
import { Button } from "../common/Button.js";
import { Checkbox } from "../common/Checkbox.js";
import { Dialog } from "../common/Dialog.js";

import { downloadTextFile } from "./downloadFile.js";
import {
  allSelectable,
  buildExportLists,
  buildFormatsFile,
  describeExportSelection,
  FORMATS_FILE_MIME,
  FORMATS_FILE_NAME,
  serializeFormatsFile,
  toggleFormat,
  toggleType,
  typeCheckState,
  type ExportSelection,
} from "./formatsExport.js";

export interface ExportFormatsDialogProps {
  readonly open: boolean;
  /** El borrador del árbol. */
  readonly state: DetectionState;
  /** «Exportar este tipo…»: abre con ese tipo y sus formatos elegidos. Ausente: todo elegido. */
  readonly preselectedTypeId?: UserEntityTypeId | null;
  readonly onClose: () => void;
}

export function ExportFormatsDialog({
  open,
  state,
  preselectedTypeId = null,
  onClose,
}: ExportFormatsDialogProps) {
  const lists = useMemo(() => buildExportLists(state), [state]);
  const [selection, setSelection] = useState<ExportSelection>(new Set());

  useEffect(() => {
    if (!open) return;
    const preselected = lists.ownTypes.find((entry) => entry.type.id === preselectedTypeId);
    setSelection(
      preselected !== undefined ? toggleType(new Set(), preselected, true) : allSelectable(lists),
    );
    // `lists` solo cambia con el borrador, que no se toca con este diálogo abierto:
    // elegir algo no vuelve a pisar la selección.
  }, [open, preselectedTypeId, lists]);

  const content = buildFormatsFile(state, selection);
  const summary = describeExportSelection(content);
  const empty = lists.ownTypes.length === 0 && lists.catalogFormats.length === 0;

  function exportFile(): void {
    if (summary === null) return;
    downloadTextFile(FORMATS_FILE_NAME, serializeFormatsFile(content), FORMATS_FILE_MIME);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Exportar formatos"
      description="Elegí qué tipos y formatos tuyos van en el archivo."
      size="lg"
      footer={
        <div className="flex flex-col gap-2">
          <p className="flex items-start gap-1.5 text-sm text-text-secondary">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            No viajan el país ni qué formatos del catálogo están prendidos.
          </p>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
              {summary === null ? "Nada elegido" : `Se exportan ${summary}`}
            </span>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={summary === null} onClick={exportFile}>
              Exportar archivo
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={empty}
            onClick={() => setSelection(allSelectable(lists))}
          >
            Elegir todo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={empty}
            onClick={() => setSelection(new Set())}
          >
            Nada
          </Button>
        </div>

        <section aria-label="Tus tipos" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">
            Tus tipos{" "}
            <span className="font-normal text-text-secondary">· viajan con todos sus formatos</span>
          </h3>
          {lists.ownTypes.length === 0 ? (
            <p className="text-sm text-text-secondary">Todavía no creaste ningún tipo.</p>
          ) : (
            lists.ownTypes.map((entry) => (
              <div key={entry.type.id} className="flex flex-col gap-1.5">
                <Checkbox
                  id={`export-type-${entry.type.id}`}
                  checked={typeCheckState(entry, selection)}
                  onCheckedChange={(on) => setSelection(toggleType(selection, entry, on))}
                  label={<span className="font-medium">{entry.type.name}</span>}
                />
                <div className="ml-6 flex flex-col gap-1.5">
                  {entry.formats.map((format) => (
                    <Checkbox
                      key={format.id}
                      id={`export-format-${format.id}`}
                      checked={selection.has(format.id)}
                      onCheckedChange={(on) => setSelection(toggleFormat(selection, format.id, on))}
                      label={format.name}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>

        <section aria-label="Tuyos, en tipos del catálogo" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-text-primary">
            Tuyos, en tipos del catálogo{" "}
            <span className="font-normal text-text-secondary">· viajan solos</span>
          </h3>
          {lists.catalogFormats.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No tenés formatos propios en tipos del catálogo.
            </p>
          ) : (
            lists.catalogFormats.map(({ format, typeName }) => (
              <Checkbox
                key={format.id}
                id={`export-format-${format.id}`}
                checked={selection.has(format.id)}
                onCheckedChange={(on) => setSelection(toggleFormat(selection, format.id, on))}
                label={
                  <span>
                    {format.name} <span className="text-text-secondary">· {typeName}</span>
                  </span>
                }
              />
            ))
          )}
        </section>
      </div>
    </Dialog>
  );
}
