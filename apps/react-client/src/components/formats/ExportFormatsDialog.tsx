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
import { CheckIcon, InfoIcon, MinusIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { DetectionState } from "../../store/detectionState.js";
import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { TypeDot, UserTypeDot } from "../entities/TypeDot.js";

import { downloadTextFile } from "./downloadFile.js";
import { buildFormatExample } from "./formatExamples.js";
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
import { partialTypeNote } from "./formatTexts.js";

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
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
            {summary === null ? "Elegí al menos un formato" : `Se exportan ${summary}`}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={summary === null} onClick={exportFile}>
            Exportar archivo
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <section aria-label="Tus tipos" className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h3 className="flex-1 text-sm font-semibold text-text-primary">
              Tus tipos{" "}
              <span className="font-normal text-text-secondary">
                · viajan con todos sus formatos
              </span>
            </h3>
            <button
              type="button"
              disabled={empty}
              onClick={() => setSelection(allSelectable(lists))}
              className={LINK_CLASS}
            >
              Elegir todo
            </button>
            <button
              type="button"
              disabled={empty}
              onClick={() => setSelection(new Set())}
              className={LINK_CLASS}
            >
              Nada
            </button>
          </div>
          {lists.ownTypes.length === 0 ? (
            <p className="text-sm text-text-secondary">Todavía no creaste ningún tipo.</p>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-lg border border-border">
              {lists.ownTypes.map((entry, entryIndex) => {
                const state = typeCheckState(entry, selection);
                return (
                  <div
                    key={entry.type.id}
                    className={entryIndex === 0 ? "" : "border-t border-border"}
                  >
                    <ExportRow
                      id={`export-type-${entry.type.id}`}
                      checked={state}
                      onToggle={() => setSelection(toggleType(selection, entry, state !== true))}
                      lead={<UserTypeDot />}
                      name={entry.type.name}
                      aside={
                        state === "indeterminate"
                          ? partialTypeNote(
                              entry.formats.filter((format) => selection.has(format.id)).length,
                              entry.formats.length,
                            )
                          : ""
                      }
                      strong
                    />
                    {entry.formats.map((format) => (
                      <ExportRow
                        key={format.id}
                        id={`export-format-${format.id}`}
                        checked={selection.has(format.id)}
                        onToggle={() =>
                          setSelection(
                            toggleFormat(selection, format.id, !selection.has(format.id)),
                          )
                        }
                        name={format.name}
                        aside={buildFormatExample(format)}
                        mono
                        indented
                      />
                    ))}
                  </div>
                );
              })}
            </div>
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
            <div className="flex flex-col overflow-hidden rounded-lg border border-border">
              {lists.catalogFormats.map(({ format, typeName }, index) => (
                <div key={format.id} className={index === 0 ? "" : "border-t border-border"}>
                  <ExportRow
                    id={`export-format-${format.id}`}
                    checked={selection.has(format.id)}
                    onToggle={() =>
                      setSelection(toggleFormat(selection, format.id, !selection.has(format.id)))
                    }
                    lead={<TypeDot type={format.entityType} />}
                    prefix={`${typeName} ›`}
                    name={format.name}
                    aside={buildFormatExample(format)}
                    mono
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* La aclaración va al final del cuerpo, con su ícono. */}
        <p className="flex items-start gap-2 text-sm text-text-secondary">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          No viajan el país ni qué formatos del catálogo están prendidos.
        </p>
      </div>
    </Dialog>
  );
}

const LINK_CLASS =
  "rounded-md px-1 text-sm font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

interface ExportRowProps {
  readonly id: string;
  readonly checked: boolean | "indeterminate";
  readonly onToggle: () => void;
  readonly name: string;
  readonly lead?: ReactNode;
  readonly prefix?: string;
  /** Lo que va a la derecha: el ejemplo (monoespaciado) o la nota de selección parcial. */
  readonly aside: string;
  readonly mono?: boolean;
  readonly strong?: boolean;
  /** Los formatos de un tipo quedan sangrados bajo él. */
  readonly indented?: boolean;
}

/** Una fila-tarjeta clicable en todo su ancho, con la casilla a la izquierda. */
function ExportRow({
  id,
  checked,
  onToggle,
  name,
  lead,
  prefix,
  aside,
  mono = false,
  strong = false,
  indented = false,
}: ExportRowProps) {
  const on = checked !== false;
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked === "indeterminate" ? "mixed" : checked}
      onClick={onToggle}
      className={`flex min-h-10 w-full items-center gap-3 py-2 pr-3 text-left text-sm hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
        indented ? "pl-9" : "pl-3"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          on ? "border-accent bg-accent text-white" : "border-border-strong bg-bg-primary"
        }`}
      >
        {checked === true ? <CheckIcon className="h-3 w-3" strokeWidth={3} /> : null}
        {checked === "indeterminate" ? <MinusIcon className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {lead}
        {prefix === undefined ? null : (
          <span className="shrink-0 text-text-secondary">{prefix}</span>
        )}
        <span className={`truncate text-text-primary ${strong ? "font-semibold" : "font-medium"}`}>
          {name}
        </span>
      </span>
      <span
        className={`max-w-[45%] shrink-0 truncate text-xs text-text-secondary ${mono ? "font-mono" : ""}`}
      >
        {aside}
      </span>
    </button>
  );
}
