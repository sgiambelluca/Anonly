/**
 * `Banner` — mensajes persistentes (`ui/Components.md` §8.7). Usado por
 * `PipelineStatus` para el banner de `PIPELINE_FAILED` (`ui/React_Client.md` §8).
 */

import { AlertTriangleIcon, InfoIcon, XCircleIcon } from "lucide-react";
import type { ReactNode } from "react";

export type BannerVariant = "info" | "warning" | "error";

const VARIANT_STYLES: Readonly<Record<BannerVariant, string>> = {
  info: "border-accent/30 bg-blue-50 text-text-primary",
  warning: "border-warning/30 bg-amber-50 text-text-primary",
  error: "border-error/30 bg-red-50 text-text-primary",
};

const VARIANT_ICON: Readonly<Record<BannerVariant, ReactNode>> = {
  info: <InfoIcon className="h-4 w-4 text-accent" aria-hidden />,
  warning: <AlertTriangleIcon className="h-4 w-4 text-warning" aria-hidden />,
  error: <XCircleIcon className="h-4 w-4 text-error" aria-hidden />,
};

export interface BannerProps {
  readonly variant: BannerVariant;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}

export function Banner({ variant, children, actions }: BannerProps) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-1.5 text-sm ${VARIANT_STYLES[variant]}`}
    >
      {VARIANT_ICON[variant]}
      <span className="flex-1">{children}</span>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
