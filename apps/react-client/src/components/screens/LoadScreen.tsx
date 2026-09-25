/**
 * `LoadScreen` — momento ① (`ui/Components.md` §2.9, `UX_Guidelines.md` §2.1,
 * reorganizada en cajas por ADR-168 §1).
 *
 * Pantalla completa. No monta el árbol de entidades ni ninguna barra lateral:
 * sin documento no hay nada que mostrar ahí. En las pruebas de usuario la
 * versión anterior cumplía pero **se leía vacía** y no explicaba cómo funciona
 * la herramienta; ahora cada bloque va en su propia caja:
 *
 * - **Barra superior**: logo, nombre y `SettingsButton` (ADR-125 §1).
 * - **Caja principal**: título, bajada y la `DropZone` de cuatro estados.
 * - **`HowItWorks`**: la animación de tres fases con sus tres pasos.
 * - **Tres tarjetas** con lo que la herramienta **garantiza** (no repiten los
 *   pasos, que dicen qué hace el usuario).
 * - **Pie**: versión y licencia, "Acerca de…" (`AboutDialog`, ADR-168 §3) y
 *   "Reportar un problema".
 *
 * **Estado "Abriendo"**: cubre la ventana entre el drop y `DOCUMENT_IMPORTED`
 * —`actions.importDocument` hace `await file.arrayBuffer()` antes de llamar al
 * Orchestrator, y en un PDF grande esa lectura se nota—.
 *
 * **Estado "Error"**: un archivo que no parece PDF se rechaza acá mismo; un
 * fallo de importación (ADR-168 §4) llega desde `ScanScreen`, que cerró el
 * documento y dejó el error en `importFailure.ts` para que esta pantalla lo
 * tome al montarse.
 */

import {
  ArrowUpRightIcon,
  BugIcon,
  InfoIcon,
  LockIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { actions } from "../../core-adapter/actions.js";
import { Logo } from "../common/Logo.js";
import { SettingsButton } from "../toolbar/SettingsButton.js";

import { AboutDialog } from "./AboutDialog.js";
import { DropZone } from "./DropZone.js";
import { looksLikePdf } from "./dropZoneState.js";
import { PRODUCT_LICENSE, REPORT_ISSUE_URL } from "./externalLinks.js";
import { HowItWorks } from "./HowItWorks.js";
import {
  clearImportFailure,
  NOT_A_PDF_MESSAGE,
  peekImportFailure,
  type DropZoneError,
} from "./importFailure.js";

export function LoadScreen() {
  const [openingFileName, setOpeningFileName] = useState<string | null>(null);
  // El error de un fallo de importación se lee al montar y se vacía en un
  // efecto (ver `peekImportFailure`): si el usuario sale y vuelve a esta
  // pantalla por otro camino, no reaparece.
  const [error, setError] = useState<DropZoneError | null>(() => peekImportFailure());
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    clearImportFailure();
  }, []);

  function accept(file: File): void {
    if (!looksLikePdf(file)) {
      setError({ fileName: file.name, message: NOT_A_PDF_MESSAGE });
      return;
    }
    setError(null);
    setOpeningFileName(file.name);
    void actions.importDocument(file).catch(() => {
      // El fallo real del import llega por `PIPELINE_FAILED` y vuelve a esta
      // pantalla con el error (ADR-168 §4). Lo único que hace falta acá es no
      // dejar la zona trabada en "Abriendo…" si la promesa rechaza antes de
      // que el pipeline llegue a emitir nada.
      setOpeningFileName(null);
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8">
        <header className="anonly-rise flex items-center justify-between rounded-xl border border-border bg-bg-primary py-2.5 pl-4 pr-3 shadow-sm">
          <div className="flex items-center gap-3">
            {/*
              El logo se dibuja censurando su propio renglón (`animated`): la
              marca hace lo que la app hace. Una sola vez al montar.
            */}
            <Logo size={32} animated />
            <span className="text-lg font-semibold tracking-tight text-text-primary">Anonly</span>
          </div>
          {/*
            ADR-125 §1: Configuración desde la pantalla de carga, que es cuando
            se elige con qué analizar el PDF.
          */}
          <SettingsButton />
        </header>

        <main className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section
            aria-labelledby="load-title"
            className="anonly-rise anonly-rise-1 flex flex-col gap-4 rounded-2xl border border-border bg-bg-primary p-6 shadow-sm sm:p-8"
          >
            <div className="flex flex-col gap-2.5">
              <span className="text-sm font-semibold uppercase tracking-wider text-accent">
                Empezá acá
              </span>
              <h1
                id="load-title"
                className="text-2xl font-semibold leading-tight tracking-tight text-text-primary sm:text-[1.75rem]"
              >
                Anonimizá PDFs sin que salgan de tu computadora
              </h1>
              <p className="text-base leading-relaxed text-text-secondary">
                Elegí un documento y Anonly detecta los datos sensibles para que revises qué se
                reemplaza antes de exportar una copia anonimizada.
              </p>
            </div>
            <DropZone openingFileName={openingFileName} error={error} onFile={accept} />
          </section>

          <div className="anonly-rise anonly-rise-2">
            <HowItWorks />
          </div>
        </main>

        <dl className="anonly-rise anonly-rise-3 grid grid-cols-1 gap-5 md:grid-cols-3">
          <Feature
            icon={<ShieldCheckIcon className="h-5 w-5" aria-hidden />}
            iconClass="bg-success/15 text-text-primary"
            title="Todo local"
            description="Tus documentos nunca salen de tu computadora."
          />
          <Feature
            icon={<ScanSearchIcon className="h-5 w-5" aria-hidden />}
            iconClass="bg-accent/10 text-accent"
            title="Detección automática"
            description="Reglas para DNI y CUIT, y un modelo que reconoce nombres por el contexto de la frase."
          />
          <Feature
            icon={<LockIcon className="h-5 w-5" aria-hidden />}
            iconClass="bg-bg-tertiary text-text-primary"
            title="No se puede deshacer"
            description="El dato no queda escondido bajo una tachadura: no hay nada debajo que copiar ni recuperar."
          />
        </dl>

        <footer className="anonly-rise anonly-rise-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-primary py-2 pl-4 pr-2">
          <p className="text-sm text-text-secondary">
            Anonly {__ANONLY_VERSION__} · Software libre, licencia {PRODUCT_LICENSE}
          </p>
          <nav aria-label="Pie de página" className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg-primary px-3.5 text-sm font-medium text-text-primary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <InfoIcon className="h-4 w-4" aria-hidden />
              Acerca de…
            </button>
            <a
              href={REPORT_ISSUE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg-primary px-3.5 text-sm font-medium text-text-primary hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <BugIcon className="h-4 w-4" aria-hidden />
              Reportar un problema
              <ArrowUpRightIcon className="h-3.5 w-3.5 text-text-secondary" aria-hidden />
            </a>
          </nav>
        </footer>
      </div>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}

function Feature({
  icon,
  iconClass,
  title,
  description,
}: {
  readonly icon: ReactNode;
  readonly iconClass: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-border bg-bg-primary px-4 py-4 shadow-sm">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
      >
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <dt className="text-sm font-semibold text-text-primary">{title}</dt>
        <dd className="text-sm leading-snug text-text-secondary">{description}</dd>
      </div>
    </div>
  );
}
