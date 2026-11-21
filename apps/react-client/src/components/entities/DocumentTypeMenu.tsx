/**
 * `DocumentTypeMenu` — el menú ⋯ de la banda de un tipo «solo de este documento»
 * (`Components.md` §13b.6, ADR-225 §2). Es el mismo disclosure de «Formatos de
 * detección» (`ActionsMenu`): flotante, no empuja nada.
 *
 * Tres acciones: «Editar nombre y abreviaturas…», «Guardar para los próximos
 * documentos» y «Borrar tipo…». Las bandas de los tipos guardados y las del
 * catálogo no lo tienen.
 */

import { BookmarkPlusIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { ActionsMenu } from "../formats/ActionsMenu.js";

import { MENU_DELETE_LABEL, MENU_EDIT_LABEL, MENU_SAVE_LABEL } from "./documentTypeCopy.js";

export interface DocumentTypeMenuProps {
  readonly typeName: string;
  readonly onEdit: () => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onOpenChange?: (open: boolean) => void;
}

export function DocumentTypeMenu({
  typeName,
  onEdit,
  onSave,
  onDelete,
  onOpenChange,
}: DocumentTypeMenuProps) {
  return (
    <ActionsMenu
      label={`Acciones del tipo ${typeName}`}
      items={[
        { label: MENU_EDIT_LABEL, icon: PencilIcon, onSelect: onEdit },
        { label: MENU_SAVE_LABEL, icon: BookmarkPlusIcon, onSelect: onSave },
        { label: MENU_DELETE_LABEL, icon: Trash2Icon, onSelect: onDelete, danger: true },
      ]}
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
    />
  );
}
