/**
 * `ScanSteps` — los cuatro pasos fijos de la pantalla de escaneo (ADR-168 §5,
 * `Components.md` §2.10). Qué paso está en qué estado lo decide
 * `scanStepFlow.ts`; acá solo se dibuja.
 *
 * Los cuatro están siempre (UX-10): la forma no cambia con el documento.
 */

import type { PipelineStage } from "@anonly/anonymization-core";
import { CheckIcon, FileIcon, ListIcon, ScanTextIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { resolveScanSteps, type ScanStepId, type ScanStepStatus } from "./scanStepFlow.js";

const ICON: Readonly<Record<ScanStepId, ReactNode>> = {
  open: <FileIcon className="h-4 w-4" aria-hidden />,
  read: <ScanTextIcon className="h-4 w-4" aria-hidden />,
  scan: <SearchIcon className="h-4 w-4" aria-hidden />,
  group: <ListIcon className="h-4 w-4" aria-hidden />,
};

const BADGE_CLASS: Readonly<Record<ScanStepStatus, string>> = {
  done: "border-[1.5px] border-success bg-success/15 text-text-primary",
  active: "anonly-step-ring bg-accent text-accent-foreground",
  pending: "border-[1.5px] border-border bg-bg-secondary text-text-secondary",
};

const LABEL_CLASS: Readonly<Record<ScanStepStatus, string>> = {
  done: "font-medium text-text-primary",
  active: "font-semibold text-accent",
  pending: "font-medium text-text-secondary",
};

export interface ScanStepsProps {
  readonly stage: PipelineStage;
  readonly visitedStages: ReadonlySet<PipelineStage>;
}

export function ScanSteps({ stage, visitedStages }: ScanStepsProps) {
  const steps = resolveScanSteps(stage, visitedStages);

  return (
    <section
      aria-label="Etapas del análisis"
      className="w-full rounded-2xl border border-border bg-bg-primary px-3 pb-3.5 pt-4 shadow-sm"
    >
      <ol className="flex">
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          const next = steps[index + 1];
          // El tramo hacia el paso siguiente: lleno si ese paso ya terminó,
          // animado si está en curso, gris si está pendiente.
          const linkClass =
            next === undefined
              ? ""
              : next.status === "done"
                ? "bg-success"
                : next.status === "active"
                  ? "anonly-link-flow bg-accent/40"
                  : "bg-border";
          return (
            <li
              key={step.id}
              aria-current={step.status === "active" ? "step" : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
            >
              {last ? null : (
                <span
                  aria-hidden
                  className={`absolute left-[calc(50%+24px)] top-4 h-0.5 w-[calc(100%-48px)] rounded ${linkClass}`}
                />
              )}
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full ${BADGE_CLASS[step.status]}`}
              >
                {step.status === "done" ? (
                  <CheckIcon className="h-4 w-4" aria-hidden />
                ) : (
                  ICON[step.id]
                )}
              </span>
              <span className={`text-sm ${LABEL_CLASS[step.status]}`}>
                {step.label}
                <span className="sr-only">
                  {step.status === "done"
                    ? " (terminado)"
                    : step.status === "active"
                      ? " (en curso)"
                      : " (pendiente)"}
                </span>
              </span>
              {/* Dos renglones reservados: la aclaración no cambia el alto (UX-10). */}
              <span className="line-clamp-2 min-h-[2.5rem] px-1 text-sm leading-tight text-text-secondary">
                {step.description}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
