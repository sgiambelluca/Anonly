/**
 * `AboutDialog` — "Acerca de Anonly" (ADR-168 §3, `Components.md` §2.9).
 *
 * **Reemplaza ADR-070 §1**: la sección "Acerca de" vivía dentro de
 * `SettingsDialog` y en las pruebas de usuario se leía como un campo más del
 * formulario, con "Reportar un problema" escondido dos niveles adentro. Ahora
 * se abre desde el botón "Acerca de…" del pie de `LoadScreen`, la primera
 * pantalla que ve todo usuario — así que el crédito que CC-BY exige visible en
 * el producto (ADR-060 §11) queda **más** visible que antes.
 *
 * Contenido: el código fuente (enlace al repositorio) y **Datos de terceros**,
 * una entrada por `THIRD_PARTY_CREDITS` con título, titular, licencia, para
 * qué se usa y cambios. Cambia **dónde** se muestra, no qué ni cómo se
 * verifica: ADR-070 §2 (los créditos son datos), §4 y §5 (el test de
 * sincronización con `NOTICE` y el provenance) no cambian.
 *
 * Cada bloque es un `<section>` con encabezado visible; los enlaces son `<a>`
 * nativos `target="_blank" rel="noopener noreferrer"` a las únicas URLs
 * externas del producto (`externalLinks.ts`).
 */

import { ArrowUpRightIcon, BugIcon, DatabaseIcon, GithubIcon } from "lucide-react";

import { Button } from "../common/Button.js";
import { Dialog } from "../common/Dialog.js";
import { THIRD_PARTY_CREDITS } from "../toolbar/thirdPartyCredits.js";

import {
  PRODUCT_LICENSE,
  REPORT_ISSUE_URL,
  REPOSITORY_LABEL,
  REPOSITORY_URL,
} from "./externalLinks.js";

export interface AboutDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Acerca de Anonly"
      description={`Versión ${__ANONLY_VERSION__} · Licencia ${PRODUCT_LICENSE}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <a
            href={REPORT_ISSUE_URL}
            {...EXTERNAL}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline"
          >
            <BugIcon className="h-4 w-4" aria-hidden />
            Reportar un problema
          </a>
          <Button variant="primary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-text-secondary">
          Anonly es software libre y todo el análisis corre en tu computadora. Que el código sea
          auditable es parte de la promesa: podés ir a mirar exactamente qué hace con tus
          documentos.
        </p>

        <section aria-labelledby="about-source-title" className="flex flex-col gap-2">
          <h3
            id="about-source-title"
            className="text-sm font-semibold uppercase tracking-wide text-text-secondary"
          >
            Código fuente
          </h3>
          <a
            href={REPOSITORY_URL}
            {...EXTERNAL}
            className="flex items-center gap-3.5 rounded-xl border border-border bg-bg-secondary px-4 py-3.5 text-text-primary hover:bg-bg-tertiary"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-text-primary text-bg-primary">
              <GithubIcon className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold">{REPOSITORY_LABEL}</span>
              <span className="text-sm text-text-secondary">
                Repositorio en GitHub: código, versiones y cambios
              </span>
            </span>
            <ArrowUpRightIcon className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          </a>
        </section>

        <section aria-labelledby="about-credits-title" className="flex flex-col gap-2">
          <h3
            id="about-credits-title"
            className="text-sm font-semibold uppercase tracking-wide text-text-secondary"
          >
            Datos de terceros
          </h3>
          {THIRD_PARTY_CREDITS.map((credit) => (
            <div
              key={credit.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-bg-secondary px-4 py-3.5"
            >
              <div className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-text-primary">
                  <DatabaseIcon className="h-5 w-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-text-primary">{credit.title}</span>
                  <span className="text-sm text-text-secondary">{credit.holder}</span>
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg-primary px-3 py-2.5">
                  <span className="text-sm font-semibold text-text-secondary">Para qué se usa</span>
                  <span className="text-sm text-text-primary">{credit.usedFor}</span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-bg-primary px-3 py-2.5">
                  <span className="text-sm font-semibold text-text-secondary">Cambios</span>
                  <span className="text-sm text-text-primary">{credit.changes}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <a
                  href={credit.sourceUrl}
                  {...EXTERNAL}
                  className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                >
                  Ver el dataset
                  <ArrowUpRightIcon className="h-3.5 w-3.5" aria-hidden />
                </a>
                <span className="text-text-secondary">
                  Licencia{" "}
                  <a
                    href={credit.licenseUrl}
                    {...EXTERNAL}
                    className="font-medium text-accent hover:underline"
                  >
                    {credit.license}
                  </a>
                </span>
              </div>
            </div>
          ))}
        </section>
      </div>
    </Dialog>
  );
}
