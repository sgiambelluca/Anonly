/**
 * `ImportFormatsResultDialog` — lo que pasó al importar un archivo de formatos
 * (`Components.md` §13b.4, ADR-227 §6, ADR-223 §6). Se abre después de elegir el
 * archivo y de `validateFormatsFile`, y termina en uno de dos diálogos:
 *
 * - **el resumen**, con tres grupos —«Se importó», «Se sumó a un tipo que ya
 *   tenías» y «No se importó»—, cada uno con su cantidad y, el último, el motivo
 *   de cada elemento. Un formato que comparte textos con otro lleva un aviso
 *   amarillo. Botón «Ver en la lista»;
 * - **el rechazo**, un `alertdialog` «No se importó nada» con el motivo (archivo
 *   inválido, versión más nueva o no es de Anonly) y «Elegir otro archivo».
 *
 * Lo importado entra al **borrador** del árbol, prendido: también se guarda con
 * «Guardar». Los textos del rechazo salen de `formatTexts.ts` (§11b.16).
 */

import {
  CheckIcon,
  CircleAlertIcon,
  CornerDownRightIcon,
  FileCheckIcon,
  PencilIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";

import {
  describeImportedItems,
  describeOverlapWarning,
  importRowDot,
  limitRejectionMessages,
  type ImportSummary,
} from "./formatsImport.js";
import {
  IMPORT_SUMMARY_FOOTNOTE,
  importedTypeDetail,
  importSummaryLead,
  mergedFormatDetail,
} from "./formatTexts.js";

export type ImportDialogResult =
  | {
      readonly kind: "summary";
      readonly summary: ImportSummary;
      /** El nombre del archivo elegido, para la línea bajo el título. */
      readonly fileName: string;
    }
  | {
      readonly kind: "rejected";
      readonly messages: ReadonlyArray<string>;
      /** La línea gris bajo el motivo; `null` si no lleva. */
      readonly hint?: string | null;
    };

export interface ImportFormatsResultDialogProps {
  /** `null` = cerrado. */
  readonly result: ImportDialogResult | null;
  /** «Ver en la lista»: cierra el resumen y deja a la vista lo importado. */
  readonly onViewInList: () => void;
  /** «Elegir otro archivo»: vuelve al selector. */
  readonly onPickAnother: () => void;
  readonly onClose: () => void;
}

export function ImportFormatsResultDialog({
  result,
  onViewInList,
  onPickAnother,
  onClose,
}: ImportFormatsResultDialogProps) {
  if (result === null) return null;
  if (result.kind === "rejected") {
    const { shown, hidden } = limitRejectionMessages(result.messages);
    return (
      <Dialog
        open
        onClose={onClose}
        role="alertdialog"
        title="No se importó nada"
        icon={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-error/10 text-error">
            <CircleAlertIcon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            <Button variant="primary" onClick={onPickAnother}>
              Elegir otro archivo
            </Button>
          </div>
        }
      >
        <ul className="flex flex-col gap-2 text-sm text-text-primary">
          {shown.map((message) => (
            <li key={message}>{message}</li>
          ))}
          {result.hint !== undefined && result.hint !== null ? (
            <li className="text-text-secondary">{result.hint}</li>
          ) : null}
          {hidden > 0 ? (
            <li className="text-text-secondary">
              {hidden === 1 ? "Y 1 problema más." : `Y ${hidden} problemas más.`}
            </li>
          ) : null}
        </ul>
      </Dialog>
    );
  }

  const { imported, merged, skipped, renamed } = result.summary;
  const ownTypeNames = new Set(
    [...imported, ...merged].filter((item) => item.kind === "type").map((item) => item.name),
  );
  const warnings = [...imported, ...merged].filter((item) => item.overlapsWith !== undefined);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Resultado de la importación"
      description={importSummaryLead(result.fileName)}
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/15 text-text-primary">
          <FileCheckIcon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      }
      size="lg"
      footer={
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm text-text-secondary">
            {IMPORT_SUMMARY_FOOTNOTE}
          </span>
          <Button variant="primary" onClick={onViewInList}>
            Ver en la lista
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Group
          title="Se importó"
          count={describeImportedItems(imported)}
          number={imported.length}
          icon={<CheckIcon className="h-3.5 w-3.5" aria-hidden />}
          empty={imported.length === 0}
        >
          {imported.map((item) => (
            <Row
              key={`${item.kind}-${item.name}`}
              dot={importRowDot(item, ownTypeNames)}
              name={item.name}
              detail={
                item.typeName !== undefined
                  ? item.typeName
                  : importedTypeDetail(
                      imported.filter(
                        (other) => other.kind === "format" && other.typeName === item.name,
                      ).length,
                    )
              }
            />
          ))}
        </Group>
        <Group
          title="Se sumó a un tipo que ya tenías"
          count={describeImportedItems(merged)}
          number={merged.length}
          icon={<CornerDownRightIcon className="h-3.5 w-3.5" aria-hidden />}
          empty={merged.length === 0}
        >
          {merged.map((item) => (
            <Row
              key={`merged-${item.name}`}
              dot="own"
              name={item.typeName ?? item.name}
              detail={mergedFormatDetail(item.name)}
            />
          ))}
        </Group>
        {/* El aviso de choque va entre lo que entró y lo que no (tablero Importar). */}
        {warnings.map((item) => (
          <p
            key={`warn-${item.name}`}
            role="status"
            className="flex items-start gap-2 rounded-lg border border-warning-strong bg-warning/15 px-3 py-2 text-sm text-text-primary"
          >
            <TriangleAlertIcon
              className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong"
              aria-hidden
            />
            <span>{describeOverlapWarning(item)}</span>
          </p>
        ))}
        <Group
          title="No se importó"
          count=""
          number={skipped.length}
          icon={<XIcon className="h-3.5 w-3.5" aria-hidden />}
          empty={skipped.length === 0}
        >
          {skipped.map((item) => (
            <Row
              key={`${item.name}-${item.reason}`}
              dot="other"
              name={item.name}
              detail={item.reason}
            />
          ))}
        </Group>
        {renamed.length > 0 ? (
          <Group
            title="Se renombraron"
            count=""
            number={renamed.length}
            icon={<PencilIcon className="h-3.5 w-3.5" aria-hidden />}
            empty={false}
          >
            {renamed.map((item) => (
              <li
                key={`${item.from}-${item.to}`}
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary"
              >
                {item.from}
                <span className="text-text-secondary"> → </span>
                {item.to}
              </li>
            ))}
          </Group>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Una fila de un grupo: el punto del tipo, el nombre y el detalle. */
function Row({
  dot,
  name,
  detail,
}: {
  readonly dot: "own" | "other";
  readonly name: string;
  readonly detail: string;
}) {
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          dot === "own"
            ? "border-[1.5px] border-dashed border-text-secondary"
            : "bg-text-secondary/60"
        }`}
      />
      <span className="shrink-0 font-semibold text-text-primary">{name}</span>
      <span className="min-w-0 flex-1 truncate text-text-secondary">{detail}</span>
    </li>
  );
}

function Group({
  title,
  count,
  number,
  icon,
  empty,
  children,
}: {
  readonly title: string;
  readonly count: string;
  readonly number: number;
  readonly icon: ReactNode;
  readonly empty: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col overflow-hidden rounded-lg border border-border"
    >
      <h3 className="flex items-center gap-2 bg-bg-secondary px-3 py-2 text-sm font-semibold text-text-primary">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary">
          {icon}
        </span>
        {title}
        {count !== "" ? <span className="font-normal text-text-secondary">· {count}</span> : null}
        <span className="ml-auto rounded-full bg-bg-tertiary px-2 text-xs font-semibold tabular-nums text-text-secondary">
          {number}
        </span>
      </h3>
      {empty ? (
        <p className="px-3 py-2 text-sm text-text-secondary">Ninguno.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">{children}</ul>
      )}
    </section>
  );
}
