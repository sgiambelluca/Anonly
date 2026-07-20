/**
 * `RuleFormFields` — campos de formulario compartidos por `RuleCreatorDialog`
 * y `RuleEditorDialog` (alcance, tipo/grupo condicional, modo, prioridad).
 * Extraído para no duplicar el mismo bloque de JSX entre los dos diálogos
 * (`ui/Components.md` §4.3/§4.4 comparten el mismo set de campos; difieren
 * solo en la acción final — crear vs. actualizar).
 *
 * Alcance ("Scope"): se usa el `Select` común (Radix) en vez de un
 * radio-group nativo — no hay `@radix-ui/react-radio-group` en el proyecto y
 * agregarlo requeriría ADR (`ai/Code_Standards.md` P-9). El mockup ASCII de
 * `ui/UX_Guidelines.md` §4.1 no es un contrato de widget concreto.
 */

import { EntityType, type ReplacementMode, type RuleScope } from "@anonly/anonymization-core";
import type { ReactNode } from "react";

import { Select, type SelectOption } from "../common/Select.js";
import { ENTITY_TYPE_LABEL } from "../entities/entityTypeLabels.js";
import { REPLACEMENT_MODE_OPTIONS } from "../entities/replacementModeOptions.js";

import type { RuleGroupOption } from "./ruleGroupOptions.js";

const SCOPE_OPTIONS: ReadonlyArray<SelectOption<RuleScope>> = [
  { value: "global", label: "Global" },
  { value: "type", label: "Por tipo" },
  { value: "group", label: "Por grupo" },
];

// Orden fijo de ui/Components.md §3.1 (mismo criterio que entities.store.ts).
const ENTITY_TYPE_OPTIONS: ReadonlyArray<SelectOption<EntityType>> = [
  EntityType.Person,
  EntityType.Organization,
  EntityType.Address,
  EntityType.DNI,
  EntityType.CUIT,
  EntityType.Phone,
  EntityType.Email,
  EntityType.IBAN,
  EntityType.CreditCard,
  EntityType.Date,
  EntityType.License,
  EntityType.Plate,
  EntityType.Custom,
].map((type) => ({ value: type, label: ENTITY_TYPE_LABEL[type] }));

export interface RuleFormFieldsProps {
  readonly scope: RuleScope;
  readonly onScopeChange: (scope: RuleScope) => void;
  readonly entityType: EntityType;
  readonly onEntityTypeChange: (type: EntityType) => void;
  readonly groupId: string | null;
  readonly onGroupIdChange: (groupId: string) => void;
  readonly groupOptions: ReadonlyArray<RuleGroupOption>;
  readonly mode: ReplacementMode;
  readonly onModeChange: (mode: ReplacementMode) => void;
  readonly priority: number;
  readonly onPriorityChange: (priority: number) => void;
}

export function RuleFormFields({
  scope,
  onScopeChange,
  entityType,
  onEntityTypeChange,
  groupId,
  onGroupIdChange,
  groupOptions,
  mode,
  onModeChange,
  priority,
  onPriorityChange,
}: RuleFormFieldsProps) {
  return (
    <>
      <FormRow label="Alcance">
        <Select
          value={scope}
          onChange={onScopeChange}
          options={SCOPE_OPTIONS}
          aria-label="Alcance de la regla"
        />
      </FormRow>

      {scope === "type" ? (
        <FormRow label="Tipo de entidad">
          <Select
            value={entityType}
            onChange={onEntityTypeChange}
            options={ENTITY_TYPE_OPTIONS}
            aria-label="Tipo de entidad"
          />
        </FormRow>
      ) : null}

      {scope === "group" ? (
        <FormRow label="Grupo">
          {groupOptions.length === 0 ? (
            <p role="alert" className="text-xs text-error">
              No hay grupos detectados todavía.
            </p>
          ) : (
            <Select
              value={groupId ?? groupOptions[0]?.id ?? ""}
              onChange={onGroupIdChange}
              options={groupOptions.map((option) => ({ value: option.id, label: option.label }))}
              aria-label="Grupo"
            />
          )}
        </FormRow>
      ) : null}

      <FormRow label="Modo de reemplazo">
        <Select
          value={mode}
          onChange={onModeChange}
          options={REPLACEMENT_MODE_OPTIONS}
          aria-label="Modo de reemplazo"
        />
      </FormRow>

      <FormRow label="Prioridad (0-1000)">
        <input
          type="number"
          min={0}
          max={1000}
          value={priority}
          onChange={(event) => onPriorityChange(Number(event.target.value))}
          className="w-24 rounded-md border border-border px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </FormRow>
    </>
  );
}

function FormRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
