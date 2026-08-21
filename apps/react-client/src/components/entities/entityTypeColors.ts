/**
 * `entityTypeColors.ts` — color de categoría por `EntityType`
 * (`ui/Components.md` §9, la misma paleta que el highlight del visor).
 *
 * Se usa como **acento** del chip de tipo (ADR-087 §3.1), no como fondo ni
 * como texto: varios de estos valores no llegan al contraste mínimo contra
 * `bg-primary`, así que no pueden llevar información por sí solos. El chip
 * comunica su nivel por el **relleno** (§3.1); el color solo ayuda a
 * identificar de qué categoría es.
 *
 * Valor inline y no clases de Tailwind a propósito: `bg-hl-${type}` no existe
 * hasta que alguien lo escriba literal, porque el JIT no resuelve nombres
 * armados en runtime. Un `Record` explícito de clases sería la alternativa, y
 * es más código para el mismo resultado.
 */

import { EntityType } from "@anonly/anonymization-core";

export const ENTITY_TYPE_COLOR: Readonly<Record<EntityType, string>> = {
  [EntityType.Person]: "#10b981",
  [EntityType.Organization]: "#6366f1",
  [EntityType.Address]: "#f59e0b",
  [EntityType.DNI]: "#3b82f6",
  [EntityType.CUIT]: "#3b82f6",
  [EntityType.Phone]: "#8b5cf6",
  [EntityType.Email]: "#8b5cf6",
  [EntityType.IBAN]: "#ec4899",
  [EntityType.CreditCard]: "#ec4899",
  [EntityType.Date]: "#14b8a6",
  [EntityType.License]: "#a855f7",
  [EntityType.Plate]: "#a855f7",
  [EntityType.Custom]: "#64748b",
};
