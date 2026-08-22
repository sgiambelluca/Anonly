/**
 * `Button` — botón presentacional genérico (`ui/Components.md` §8.1).
 *
 * Variantes: `primary`, `secondary`, `ghost`, `danger` (clases `.anonly-button-*`
 * ya definidas en `index.css`, Hito 10 PR1). Tamaños: `sm`, `md`, `lg`.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  sm: "text-sm px-2 py-1",
  md: "text-sm px-3 py-1.5",
  lg: "text-base px-4 py-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const variantClass = `anonly-button-${variant}`;
  const classes = [variantClass, SIZE_CLASSES[size], className].filter(Boolean).join(" ");

  return (
    <button type={type} className={classes} disabled={disabled ?? loading} {...rest}>
      {children}
    </button>
  );
}
