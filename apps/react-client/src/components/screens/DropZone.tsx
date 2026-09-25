/**
 * `DropZone` — la zona de carga de `LoadScreen` (ADR-168 §2, `Components.md`
 * §2.9, `UX_Guidelines.md` §2.1).
 *
 * Cuatro estados en **el mismo recuadro**: reposo, arrastrando encima,
 * abriendo y error (`dropZoneState.ts` decide cuál). **El recuadro no cambia
 * de tamaño entre estados** (UX-10, ADR-169 §1): tiene alto fijo y cada estado
 * se dibuja centrado adentro, con el nombre de archivo y el motivo truncados
 * o acotados a dos renglones para que ninguno lo empuje.
 *
 * El drag & drop y el botón funcionan los dos (ADR-087 Contexto §1, hallazgo
 * 5). El estado de error cubre el archivo que ni siquiera es un PDF (rechazo
 * local) y el fallo de importación que vuelve desde `ScanScreen` (ADR-168 §4).
 */

import { FileIcon, FileXIcon, RefreshCwIcon, UploadIcon } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { resolveDropZoneState, PDF_MIME } from "./dropZoneState.js";
import type { DropZoneError } from "./importFailure.js";

export interface DropZoneProps {
  /** Hay un archivo abriéndose (entre el drop y `DOCUMENT_IMPORTED`). */
  readonly openingFileName: string | null;
  readonly error: DropZoneError | null;
  /** Recibe el archivo elegido o soltado; el filtro de PDF lo hace el padre. */
  readonly onFile: (file: File) => void;
}

export function DropZone({ openingFileName, error, onFile }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const opening = openingFileName !== null;
  const state = resolveDropZoneState({ dragging, opening, hasError: error !== null });

  function pickFile(): void {
    inputRef.current?.click();
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    if (opening) return;
    const file = event.dataTransfer.files[0];
    if (file !== undefined) onFile(file);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    // Sin este `preventDefault` el navegador abre el PDF en la pestaña y se
    // lleva puesta la app entera.
    event.preventDefault();
    if (!opening && !dragging) setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>): void {
    // Pasar de un hijo a otro dispara `dragleave` en el contenedor: solo se
    // sale del estado si el puntero dejó de verdad el recuadro.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragging(false);
  }

  const frameClass =
    state === "dragging"
      ? "border-accent bg-accent/10"
      : state === "error"
        ? "anonly-dz-shake border-error bg-error/5"
        : "border-transparent bg-bg-secondary";

  return (
    <div
      onDrop={onDrop}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      data-state={state}
      // Alto fijo: el recuadro es el mismo en los cuatro estados (UX-10).
      className={`anonly-dots relative flex h-72 w-full items-center justify-center overflow-hidden rounded-xl border-2 p-6 transition-colors ${frameClass}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={PDF_MIME}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) onFile(file);
        }}
      />

      {state === "idle" ? (
        <>
          {/* El borde punteado que avanza: un `rect` y no un `border-dashed`, que no se anima. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          >
            <rect
              className="anonly-dz-ants text-border"
              x="1"
              y="1"
              rx="11"
              style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="12 10"
            />
          </svg>
          <div className="relative flex flex-col items-center gap-2.5 text-center">
            <div className="relative h-16 w-16">
              <div className="anonly-dz-ring flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <UploadIcon className="anonly-dz-bob h-7 w-7" aria-hidden />
              </div>
              <GhostPdf />
            </div>
            <p className="mt-1.5 text-lg font-semibold text-text-primary">Arrastrá un PDF acá</p>
            <p className="text-sm text-text-secondary">o</p>
            <button
              type="button"
              className="anonly-button-primary min-h-11 px-5"
              onClick={pickFile}
            >
              <FileIcon className="h-4 w-4" aria-hidden />
              Elegir archivo
            </button>
            <p className="text-sm text-text-secondary">Solo archivos PDF</p>
          </div>
        </>
      ) : null}

      {state === "dragging" ? (
        <div className="pointer-events-none flex flex-col items-center gap-2.5 text-center">
          <span className="relative inline-flex h-20 w-20 items-center justify-center">
            <span className="anonly-dz-halo absolute inset-0 rounded-full bg-accent opacity-25" />
            <span className="anonly-dz-float relative inline-flex h-16 w-16 items-center justify-center rounded-2xl border-[1.5px] border-accent bg-bg-primary text-accent">
              <UploadIcon className="h-7 w-7 rotate-180" aria-hidden />
            </span>
          </span>
          <p className="mt-1 text-lg font-semibold text-text-primary">
            Soltá el archivo para abrirlo
          </p>
          <p className="text-sm text-text-secondary">
            Se abre acá mismo, no se sube a ningún lado.
          </p>
        </div>
      ) : null}

      {state === "opening" ? (
        <div role="status" className="flex max-w-full flex-col items-center gap-2.5 text-center">
          <span className="relative inline-flex h-16 w-16 items-center justify-center">
            <svg
              className="anonly-spin absolute inset-0"
              width="64"
              height="64"
              viewBox="0 0 64 64"
              fill="none"
              aria-hidden
            >
              <circle cx="32" cy="32" r="29" className="stroke-bg-tertiary" strokeWidth="4" />
              <path
                d="M32 3a29 29 0 0 1 29 29"
                className="stroke-accent"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
            <FileIcon className="h-6 w-6 text-text-secondary" aria-hidden />
          </span>
          <p className="mt-1.5 text-lg font-semibold text-text-primary">Abriendo el documento…</p>
          <p
            className="max-w-[26rem] truncate text-sm text-text-secondary"
            title={openingFileName ?? ""}
          >
            {openingFileName}
          </p>
          <button type="button" className="anonly-button-primary min-h-11 px-5" disabled>
            Elegir archivo
          </button>
        </div>
      ) : null}

      {state === "error" && error !== null ? (
        <div className="flex max-w-full flex-col items-center gap-2.5 text-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-error/50 bg-error/10 text-error">
            <FileXIcon className="h-7 w-7" aria-hidden />
          </span>
          <p className="mt-1.5 text-lg font-semibold text-text-primary">
            No se pudo abrir el archivo
          </p>
          <div role="alert" className="flex max-w-[28rem] flex-col items-center gap-0.5">
            {error.fileName !== null ? (
              <p className="max-w-full truncate text-sm text-text-secondary" title={error.fileName}>
                {error.fileName}
              </p>
            ) : null}
            <p className="line-clamp-2 text-sm font-medium text-error">{error.message}</p>
          </div>
          <button type="button" className="anonly-button-primary min-h-11 px-5" onClick={pickFile}>
            <RefreshCwIcon className="h-4 w-4" aria-hidden />
            Elegir otro archivo
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** El documento que "cae" en la zona en reposo (decorativo). */
function GhostPdf() {
  return (
    <svg
      className="anonly-dz-ghost absolute -top-7 left-4 opacity-0 motion-reduce:hidden"
      width="30"
      height="36"
      viewBox="0 0 30 36"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 1.5h13l10 10V32a2.5 2.5 0 0 1-2.5 2.5h-20A2.5 2.5 0 0 1 3 32V4a2.5 2.5 0 0 1 2-2.5Z"
        className="fill-bg-primary stroke-text-secondary"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M18 1.5V9a2.5 2.5 0 0 0 2.5 2.5H28"
        className="stroke-text-secondary"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect x="7" y="20" width="16" height="7" rx="1.5" className="fill-accent" />
    </svg>
  );
}
