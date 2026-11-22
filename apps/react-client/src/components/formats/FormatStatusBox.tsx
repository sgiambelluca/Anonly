/**
 * `FormatStatusBox` — la caja de estado del generador (`Components.md` §13b.5,
 * ADR-228 §7). Va en el pie, a la izquierda de los botones (precisión del
 * 2026-11-21), y **mide siempre lo mismo**: verde, amarilla o roja, el layout no
 * se mueve cuando aparece un error (`UX_Guidelines.md` §11b.8). Tiene lugar para
 * tres renglones de 13 px; un texto más largo termina en «…» y se lee entero en
 * su `title`.
 */

import { CircleCheckIcon, TriangleAlertIcon, XCircleIcon } from "lucide-react";

import type { BuilderStatus, StatusTone } from "./formatBuilderStatus.js";

const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  ready: "border-success/40 bg-success/10",
  warning: "border-warning-strong/40 bg-warning/15",
  error: "border-error/40 bg-error/10",
};

function ToneIcon({ tone }: { readonly tone: StatusTone }) {
  if (tone === "error") return <XCircleIcon className="h-4 w-4 text-error" aria-hidden />;
  if (tone === "warning") {
    return <TriangleAlertIcon className="h-4 w-4 text-warning-strong" aria-hidden />;
  }
  return <CircleCheckIcon className="h-4 w-4 text-success" aria-hidden />;
}

export interface FormatStatusBoxProps {
  readonly status: BuilderStatus;
}

export function FormatStatusBox({ status }: FormatStatusBoxProps) {
  return (
    <div
      role={status.tone === "error" ? "alert" : "status"}
      data-status-tone={status.tone}
      className={`flex h-[3.75rem] min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-1 text-[13px] leading-[1.25] text-text-primary ${TONE_CLASS[status.tone]}`}
    >
      <span className="shrink-0">
        <ToneIcon tone={status.tone} />
      </span>
      <span className="line-clamp-3" title={status.text}>
        {status.headline === undefined ? (
          status.text
        ) : (
          <>
            <strong className="font-semibold">{status.headline}</strong> {status.detail}
          </>
        )}
      </span>
    </div>
  );
}
