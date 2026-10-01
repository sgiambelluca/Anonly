/**
 * `ExportProgress` (`ui/Components.md` §7.2).
 *
 * Lee `pipeline.store` (`exportProgress`/`exportResult`/`error`) directamente
 * (§7.2: "Stores: pipeline.exportProgress"). `ExportDialog` solo lo monta
 * después de confirmar el submit, así que un `exportResult`/`error` residual
 * de una exportación previa nunca se muestra por accidente (ver el comentario
 * en `ExportDialog.tsx`).
 *
 * `error` es el campo genérico de `pipeline.store` (`React_Client.md` §3.4):
 * no existe un campo dedicado a errores de export (`EXPORT_FAILED` y
 * `PIPELINE_FAILED` comparten el mismo campo, `bus-bridge.ts` PR5) — ver la
 * justificación completa en `exportPhase.ts`.
 *
 * Al finalizar (`exportResult != null`): ancla "Descargar" (`href={blobUrl}`,
 * como pide §7.2 — "ancla a blobUrl", no un botón con `onClick`) + botón
 * "Exportar otro" (`onExportAnother`, estado local de `ExportDialog` — no hay
 * acción de store para "limpiar" el resultado, ver `exportPhase.ts`).
 *
 * **Tras apretar "Descargar" el panel confirma y ofrece las dos salidas**
 * (pedido del humano): descargar de nuevo, o abrir otro documento.
 *
 * > **Por qué la confirmación no afirma que la descarga terminó bien.** El
 * > navegador **no da ninguna señal** de éxito ni de fallo para un
 * > `<a download>`: no hay evento, no hay promesa, no hay forma de saberlo
 * > desde la página. Así que el panel dice lo que sí es cierto —que el archivo
 * > se generó y se mandó a descargar— y deja el reintento a la vista en vez de
 * > esconderlo detrás de un fallo que no se puede detectar. Afirmar
 * > "descargado con éxito" sería inventar un dato, y en una herramienta cuyo
 * > resultado es el archivo, esa es exactamente la mentira que más caro sale.
 */

import { CheckIcon, DownloadIcon, FileCheck2Icon, Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { actions } from "../../core-adapter/actions.js";
import { usePipelineStore } from "../../store/pipeline.store.js";
import { Banner } from "../common/Banner.js";
import { Button } from "../common/Button.js";

import { resolveExportPhase } from "./exportPhase.js";
import {
  exportProgressPercent,
  formatExportProgressLabel,
  formatFileSize,
} from "./exportProgressFormat.js";

export interface ExportProgressProps {
  /** Nombre elegido en el form, para el atributo `download` del ancla. */
  readonly filename: string;
  readonly onExportAnother: () => void;
  readonly onClose: () => void;
}

export function ExportProgress({ filename, onExportAnother, onClose }: ExportProgressProps) {
  const progress = usePipelineStore((state) => state.exportProgress);
  const result = usePipelineStore((state) => state.exportResult);
  const error = usePipelineStore((state) => state.error);

  // `downloaded` es local y efímero: solo decide qué cara del panel se
  // muestra. No sube a `pipeline.store` porque nadie más lo lee, y porque
  // "apreté descargar" no es estado del pipeline.
  const [downloaded, setDownloaded] = useState(false);

  const phase = resolveExportPhase(true, result, error !== null);

  if (phase === "done" && result !== null) {
    if (downloaded) {
      return (
        <div className="flex flex-col gap-4 text-sm">
          <ResultCard
            icon={<CheckIcon className="h-5 w-5" aria-hidden />}
            title={
              <>
                Se descargó <span className="break-all">{filename}</span>
              </>
            }
            detail="Si no aparece en tus descargas, probá de nuevo."
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" className="mr-auto" onClick={() => actions.closeDocument()}>
              Abrir otro documento
            </Button>
            <a
              href={result.blobUrl}
              download={filename}
              className="anonly-button-secondary"
              onClick={() => setDownloaded(true)}
            >
              Descargar de nuevo
            </a>
            <Button variant="primary" className="min-w-[6rem]" onClick={onClose}>
              Listo
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4 text-sm">
        <ResultCard
          icon={<FileCheck2Icon className="h-5 w-5" aria-hidden />}
          title="Exportación completa"
          detail={
            <>
              <span className="break-all">{filename}</span> · {formatFileSize(result.sizeBytes)}
            </>
          }
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onExportAnother}>
            Exportar otro
          </Button>
          <a
            href={result.blobUrl}
            download={filename}
            className="anonly-button-primary min-w-[6rem]"
            onClick={() => setDownloaded(true)}
          >
            <DownloadIcon className="h-4 w-4" aria-hidden />
            Descargar
          </a>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <Banner variant="error">No se pudo exportar. Reintentá.</Banner>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" onClick={onExportAnother}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const percent = exportProgressPercent(progress);
  return (
    <div
      className="flex flex-col gap-3.5 rounded-xl border border-border bg-bg-secondary px-4 py-3.5 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Loader2Icon className="anonly-spin h-5 w-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-semibold text-text-primary">Generando la copia anonimizada</p>
          <p className="text-text-secondary">{formatExportProgressLabel(progress)}</p>
        </div>
        <span className="shrink-0 font-semibold tabular-nums text-text-primary" aria-hidden>
          {percent}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** La tarjeta del resultado: ícono en verde, qué pasó y el detalle del archivo. */
function ResultCard({
  icon,
  title,
  detail,
}: {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly detail: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-bg-secondary px-4 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-text-primary">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-semibold text-text-primary">{title}</p>
        <p className="text-text-secondary">{detail}</p>
      </div>
    </div>
  );
}
