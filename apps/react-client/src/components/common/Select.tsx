/**
 * `Select` — wrapper sobre Radix `Select` con estilos Tailwind (`ui/Components.md` §8.3).
 *
 * Genérico sobre `T extends string`: evita casts `as` en los consumidores
 * (`SettingsDialog`) al mapear `onValueChange` (que Radix tipa como `string`
 * suelto) de vuelta al tipo literal de cada campo (`Language`, `PerformancePreset`).
 */

import * as RadixSelect from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SelectProps<T extends string> {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: ReadonlyArray<SelectOption<T>>;
  readonly "aria-label"?: string;
  readonly disabled?: boolean;
  // Apertura controlada, opcional. Sin esto Radix la maneja internamente
  // (comportamiento sin cambios para los consumidores existentes). La usa
  // `PersonGenderSelect` para que la marca de "género sin determinar"
  // (`ui/Components.md` §3.3, un elemento hermano fuera de este componente)
  // pueda abrir el desplegable con su propio click (ADR-060 §5: "Click abre
  // el selector").
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  open,
  onOpenChange,
  ...rest
}: SelectProps<T>) {
  const ariaLabel = rest["aria-label"];

  // Radix tipa onValueChange como (value: string) => void; el valor siempre
  // proviene de `options` (mismo T), así que el narrowing es seguro.
  function handleValueChange(next: string): void {
    onChange(next as T);
  }

  // `exactOptionalPropertyTypes`: Radix tipa `open`/`onOpenChange` como
  // `boolean`/función sin `| undefined`, así que no se puede pasar la
  // ausencia de estas props opcionales como `undefined` explícito.
  const controlledOpenProps = {
    ...(open !== undefined ? { open } : {}),
    ...(onOpenChange !== undefined ? { onOpenChange } : {}),
  };

  return (
    <RadixSelect.Root
      value={value}
      onValueChange={handleValueChange}
      disabled={disabled}
      {...controlledOpenProps}
    >
      <RadixSelect.Trigger
        aria-label={ariaLabel}
        className="inline-flex items-center justify-between gap-2 rounded-md border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary disabled:opacity-50"
      >
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDownIcon className="h-4 w-4 text-text-secondary" aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="z-50 overflow-hidden rounded-md border border-border bg-bg-primary shadow-md">
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-tertiary"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <CheckIcon className="h-4 w-4 text-accent" aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
