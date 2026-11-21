/**
 * El aviso de formatos que no se aplicaron dentro de `ExportDialog`
 * (`ui/Components.md` §13b.8, ADR-229 §7), debajo del nombre del documento, por
 * si el usuario no leyó el de la barra: una fila por formato con sus páginas y
 * «Ir a la página N», que cierra el diálogo y lleva al visor. Un formato que
 * falló en todo el documento dice «Todo el documento» y no lleva botón.
 * **No bloquea la exportación.**
 *
 * Los textos viven en `skippedFormatsText.ts`.
 */

import { TriangleAlertIcon } from "lucide-react";

import { Button } from "../common/Button.js";
import {
  EXPORT_NOTICE_BODY,
  exportNoticeTitle,
  exportRowGoTo,
  exportRowPages,
  goToPageLabel,
  type SkippedFormatEntry,
} from "../toolbar/skippedFormatsText.js";

export interface SkippedFormatsExportNoticeProps {
  readonly entries: ReadonlyArray<SkippedFormatEntry>;
  /** `pageIndex` desde 0. */
  readonly onGoToPage: (pageIndex: number) => void;
}

export function SkippedFormatsExportNotice({
  entries,
  onGoToPage,
}: SkippedFormatsExportNoticeProps) {
  if (entries.length === 0) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-2.5 rounded-xl border border-warning-strong bg-warning/15 px-3.5 py-3"
    >
      <div className="flex gap-2.5">
        <TriangleAlertIcon
          className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warning-strong"
          aria-hidden
        />
        <span className="flex flex-col gap-0.5">
          <b className="font-semibold text-text-primary">{exportNoticeTitle(entries)}</b>
          <span className="leading-snug text-text-primary">{EXPORT_NOTICE_BODY}</span>
        </span>
      </div>
      <ul className="flex flex-col overflow-hidden rounded-lg border border-border bg-bg-primary">
        {entries.map((entry, index) => {
          const goTo = exportRowGoTo(entry);
          return (
            <li
              key={entry.formatId}
              className={`grid min-h-11 grid-cols-[12px_minmax(0,1fr)_auto_136px] items-center gap-x-2.5 py-1 pl-3 pr-1.5 ${
                index > 0 ? "border-t border-border" : ""
              }`}
            >
              <span
                aria-hidden
                className="h-[9px] w-[9px] rounded-full border-2 border-text-secondary"
              />
              <span className="truncate font-semibold text-text-primary">{entry.name}</span>
              <span className="text-text-secondary">{exportRowPages(entry)}</span>
              <span className="flex justify-end">
                {goTo !== null ? (
                  <Button variant="ghost" size="sm" onClick={() => onGoToPage(goTo)}>
                    {goToPageLabel(goTo)}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
