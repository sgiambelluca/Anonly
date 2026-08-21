/**
 * `LoadScreen` — momento ① (`ui/Components.md` §2.9, `UX_Guidelines.md` §2.1).
 *
 * Pantalla completa. No monta el árbol de entidades ni ninguna barra lateral:
 * sin documento no hay nada que mostrar ahí.
 *
 * **El drag & drop funciona.** Hasta ADR-087 el Hero dibujaba un dropzone que
 * no tenía ningún handler y un botón `disabled`, así que el elemento más
 * grande de la primera pantalla era decorativo y el único camino real era el
 * botón chico de la toolbar (ADR-087 Contexto §1, hallazgo 5).
 *
 * `busy` cubre la ventana entre el drop y `DOCUMENT_IMPORTED`:
 * `actions.importDocument` hace `await file.arrayBuffer()` antes de llamar al
 * Orchestrator, y en un PDF grande esa lectura se nota. Sin este estado la
 * pantalla quedaba muda después del click (`appPhase.ts` deja esa ventana
 * acá a propósito).
 */

import { LockIcon, ScanSearchIcon, ShieldCheckIcon, UploadIcon } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { actions } from "../../core-adapter/actions.js";

const PDF_MIME = "application/pdf";

/**
 * `type` vacío es un caso real y **no** es un rechazo: algunos navegadores no
 * resuelven el MIME de un archivo arrastrado desde ciertos orígenes. Se cae a
 * la extensión antes de rechazar; el PDF Engine valida de verdad y emite
 * `PDF_INVALID` → `PIPELINE_FAILED` si el archivo no sirve, así que este
 * chequeo solo existe para dar un mensaje inmediato en el caso obvio.
 */
function looksLikePdf(file: File): boolean {
  if (file.type === PDF_MIME) return true;
  if (file.type === "") return file.name.toLowerCase().endsWith(".pdf");
  return false;
}

export function LoadScreen() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  function accept(file: File | undefined): void {
    if (!file) return;
    if (!looksLikePdf(file)) {
      setRejected(`"${file.name}" no es un PDF.`);
      return;
    }
    setRejected(null);
    setBusy(true);
    void actions.importDocument(file).catch(() => {
      // El fallo real del import llega por `PIPELINE_FAILED` y lo muestra el
      // banner de la toolbar, ya en el momento ②. Lo único que hace falta acá
      // es no dejar la pantalla trabada en "Abriendo…" si la promesa rechaza
      // antes de que el pipeline llegue a emitir nada.
      setBusy(false);
    });
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    // Sin este `preventDefault` el navegador abre el PDF en la pestaña y se
    // lleva puesta la app entera.
    event.preventDefault();
    setDragging(true);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 overflow-y-auto p-8">
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        <ShieldCheckIcon className="h-10 w-10 text-accent" aria-hidden />
        <h1 className="text-2xl font-semibold text-text-primary">
          Anonimizá PDFs sin que salgan de tu computadora
        </h1>
        <p className="text-base text-text-secondary">
          Elegí un documento y Anonly detecta los datos sensibles para que revises qué se reemplaza
          antes de exportar una copia anonimizada.
        </p>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        className={`flex w-full max-w-md flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 transition-colors ${
          dragging ? "border-accent bg-bg-tertiary" : "border-border bg-bg-secondary"
        }`}
      >
        <UploadIcon className="h-8 w-8 text-text-secondary" aria-hidden />
        <p className="text-base font-medium text-text-primary">
          {busy ? "Abriendo el documento…" : "Arrastrá un PDF acá"}
        </p>
        <p className="text-sm text-text-secondary">o</p>
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
            accept(file);
          }}
        />
        <button
          type="button"
          className="anonly-button-primary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Elegir archivo
        </button>
        {rejected !== null ? (
          <p role="alert" className="text-sm text-error">
            {rejected}
          </p>
        ) : null}
      </div>

      <dl className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-3">
        <Feature
          icon={<ShieldCheckIcon className="h-5 w-5" aria-hidden />}
          title="Todo local"
          description="Tus documentos nunca salen del navegador."
        />
        <Feature
          icon={<ScanSearchIcon className="h-5 w-5" aria-hidden />}
          title="Detección automática"
          description="Nombres, DNI, CUIT, emails, teléfonos y direcciones."
        />
        <Feature
          icon={<LockIcon className="h-5 w-5" aria-hidden />}
          title="No se puede deshacer"
          description="El PDF final se reconstruye desde cero, sin texto oculto."
        />
      </dl>
    </div>
  );
}

function Feature({
  icon,
  title,
  description,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-text-primary">
        <span className="text-accent">{icon}</span>
        <dt className="text-sm font-semibold">{title}</dt>
      </div>
      <dd className="text-sm text-text-secondary">{description}</dd>
    </div>
  );
}
