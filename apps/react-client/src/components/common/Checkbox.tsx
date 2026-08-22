/**
 * `Checkbox` — wrapper sobre Radix `Checkbox` (`ui/Components.md` §8.4).
 * Estados: `checked`, `unchecked`, `indeterminate` (cascade de tipos, fuera de
 * alcance de este PR, pero soportado por el wrapper).
 */

import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface CheckboxProps {
  readonly id?: string;
  readonly checked: boolean | "indeterminate";
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label?: ReactNode;
  readonly disabled?: boolean;
  readonly "aria-label"?: string;
}

export function Checkbox({
  id,
  checked,
  onCheckedChange,
  label,
  disabled = false,
  ...rest
}: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      // `items-start` + `mt-0.5` en la caja, no `items-center`: con una
      // etiqueta de dos líneas el centrado dejaba la caja flotando a media
      // altura, lejos de la primera línea que es la que nombra la opción. El
      // desplazamiento de 2 px la deja igual de centrada contra una etiqueta
      // de una sola línea (20 px de interlineado, 16 px de caja).
      className={`flex items-start gap-2 text-sm text-text-primary ${
        disabled ? "opacity-50" : "cursor-pointer"
      }`}
    >
      <RadixCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={rest["aria-label"]}
        onCheckedChange={(next) => {
          onCheckedChange(next === true);
        }}
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border bg-bg-primary data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <RadixCheckbox.Indicator className="text-white">
          {checked === "indeterminate" ? (
            <MinusIcon className="h-3 w-3" aria-hidden />
          ) : (
            <CheckIcon className="h-3 w-3" aria-hidden />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label}
    </label>
  );
}
