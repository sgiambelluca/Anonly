/**
 * `DetectionFormatsDialog` — el árbol tipo → formatos (`Components.md` §13b.2,
 * ADR-227 §2 y §3). Solo se monta sin documento abierto (ADR-223 §1).
 *
 * Trabaja sobre un **borrador** de `detection.store` (`React_Client.md` §3.8):
 * nada llega a `anonly:detection` hasta «Guardar», que recrea el Core si el
 * override derivado cambió (ADR-125 §2, con el diálogo todavía abierto,
 * ADR-125 §3), cierra y deja el aviso «Formatos guardados» en `LoadScreen`.
 *
 * - **Cerrar con cambios** pide confirmación (`ConfirmDialog`), también con un
 *   clic fuera del diálogo o con `Esc` (`UX_Guidelines.md` §11b.5).
 * - **Las acciones de un menú ⋯** confirman con un aviso con «Deshacer», válido
 *   hasta guardar. Deshace sobre el borrador (`undoLastDraftChange`). Con el
 *   diálogo abierto el foco está atrapado, así que `Ctrl+Z` hace lo mismo.
 * - **Nada desplaza el layout**: la barra de búsqueda es fija, los menús son
 *   flotantes y el error de guardado vive en una ranura de alto fijo.
 * - El generador (`FormatBuilderDialog`) se abre desde «Nuevo formato» y
 *   «Editar»: es la tanda 2 de F7.
 */

import { getCatalog, isUserEntityType, validateFormatsFile } from "@anonly/anonymization-core";
import type {
  FormatsFileContent,
  UserEntityTypeDefinition,
  UserEntityTypeId,
} from "@anonly/anonymization-core";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDetectionStore } from "../../store/detection.store.js";
import type { DetectionChange } from "../../store/detectionState.js";
import { Button } from "../common/Button.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";
import { showToast } from "../common/toast.js";

import type { ActionsMenuItem } from "./ActionsMenu.js";
import { DeleteUserTypeDialog } from "./DeleteUserTypeDialog.js";
import { ExportFormatsDialog } from "./ExportFormatsDialog.js";
import { FormatBuilderDialog, type FormatBuilderRequest } from "./FormatBuilderDialog.js";
import { FormatRow } from "./FormatRow.js";
import { planFormatsImport } from "./formatsImport.js";
import {
  buildFormatsTree,
  describeCounts,
  describePendingChanges,
  formatsOfType,
  type FormatRowModel,
  type FormatsSectionId,
  type TypeBandModel,
} from "./formatsTree.js";
import {
  deletedFormatToast,
  deletedSavedTypeToast,
  describeFormatsFileIssues,
  formatIssueText,
  importRejectionHint,
  restoredFormatToast,
} from "./formatTexts.js";
import { FormatTypeBand } from "./FormatTypeBand.js";
import { ImportFormatsResultDialog, type ImportDialogResult } from "./ImportFormatsResultDialog.js";
import { ImportNameConflictsDialog, type NameConflictEntry } from "./ImportNameConflictsDialog.js";
import { UserTypeDialog } from "./UserTypeDialog.js";

export const DETECTION_DIALOG_COPY = {
  title: "Formatos de detección",
  description:
    "Un tipo es qué dato es, como Teléfono. Un formato es una forma en que ese dato aparece escrito.",
  searchPlaceholder: "Buscar un tipo o un formato",
  newTypeBand: "Nuevo tipo",
  newTypeHint: "Para un dato que el catálogo no conoce, como un legajo o una historia clínica.",
  emptyOwnType:
    "Todavía no tiene formatos: no detecta nada solo. Igual podés usarlo al agregar una entidad a mano.",
  footerTitle: "Se aplica al próximo documento que abras",
  footerDetail: "Se guarda en este equipo, sin cifrar",
  discardTitle: (count: number) =>
    count === 1 ? "¿Descartar 1 cambio sin guardar?" : `¿Descartar ${count} cambios sin guardar?`,
  discardLine: "Lo que cambiaste en esta lista no se guarda.",
  keepEditing: "Seguir editando",
  discard: "Descartar cambios",
  noResults: (query: string) => `Ningún tipo ni formato coincide con «${query}».`,
  clearSearch: "Borrar la búsqueda",
  saveFailed: "No se pudieron guardar los formatos. Probá de nuevo.",
} as const;

export interface DetectionFormatsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Se llama después de guardar y antes de cerrar: `LoadScreen` muestra el aviso «Formatos guardados». */
  readonly onSaved?: () => void;
}

type TypeDialogState =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly typeId: UserEntityTypeId };

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

export function DetectionFormatsDialog({ open, onClose, onSaved }: DetectionFormatsDialogProps) {
  const saved = useDetectionStore((state) => state.saved);
  const draft = useDetectionStore((state) => state.draft);
  const pending = useDetectionStore((state) => state.pendingChanges);
  const state = draft ?? saved;

  const [query, setQuery] = useState("");
  const [foldedSections, setFoldedSections] = useState<ReadonlySet<FormatsSectionId>>(
    new Set<FormatsSectionId>(["fixed"]),
  );
  const [foldedBands, setFoldedBands] = useState<ReadonlySet<string>>(new Set());
  const [typeDialog, setTypeDialog] = useState<TypeDialogState | null>(null);
  const [deleteTypeId, setDeleteTypeId] = useState<UserEntityTypeId | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPreselected, setExportPreselected] = useState<UserEntityTypeId | null>(null);
  const [importResult, setImportResult] = useState<ImportDialogResult | null>(null);
  // El paso de conflictos de nombre: el archivo ya validado, qué formatos chocaban
  // al empezar (la lista de campos no cambia mientras se escribe) y los nombres nuevos.
  const [nameStep, setNameStep] = useState<{
    readonly fileName: string;
    readonly content: FormatsFileContent;
    readonly indices: ReadonlyArray<number>;
    readonly renames: ReadonlyMap<number, string>;
  } | null>(null);
  const [builderRequest, setBuilderRequest] = useState<FormatBuilderRequest | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    useDetectionStore.getState().openDraft();
    setQuery("");
    setSaveError(null);
    setConfirmClose(false);
  }, [open]);

  const tree = useMemo(() => buildFormatsTree(state, query), [state, query]);
  const searching = query.trim() !== "";
  const anySubDialog =
    typeDialog !== null ||
    deleteTypeId !== null ||
    exportOpen ||
    importResult !== null ||
    nameStep !== null ||
    builderRequest !== null ||
    confirmClose;

  // Con el foco atrapado en el diálogo, el «Deshacer» del aviso no se alcanza
  // con el teclado: `Ctrl+Z` hace lo mismo sobre el borrador.
  useEffect(() => {
    if (!open || anySubDialog) return;
    function handleKeydown(event: KeyboardEvent): void {
      const isUndo =
        (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
      if (!isUndo || isEditableTarget(event.target)) return;
      event.preventDefault();
      useDetectionStore.getState().undoLastDraftChange();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open, anySubDialog]);

  function apply(change: DetectionChange): void {
    useDetectionStore.getState().applyToDraft(change);
  }

  /** El aviso de una acción de ⋯: con «Deshacer», válido hasta guardar (§11b.11). */
  function announce(title: string, description?: string): void {
    showToast({
      title,
      ...(description !== undefined ? { description } : {}),
      tone: "neutral",
      actions: [
        {
          label: "Deshacer",
          run: () => useDetectionStore.getState().undoLastDraftChange(),
          // La pista del atajo (`UX_Guidelines.md` §11b.11).
          shortcut: "Ctrl+Z",
        },
      ],
    });
  }

  function requestClose(): void {
    if (useDetectionStore.getState().pendingChanges > 0) {
      setConfirmClose(true);
      return;
    }
    useDetectionStore.getState().discardDraft();
    onClose();
  }

  function discardAndClose(): void {
    setConfirmClose(false);
    useDetectionStore.getState().discardDraft();
    onClose();
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    try {
      await useDetectionStore.getState().commit();
    } catch {
      setSaveError(DETECTION_DIALOG_COPY.saveFailed);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved?.();
    onClose();
  }

  function toggleSection(id: FormatsSectionId): void {
    setFoldedSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBand(key: string): void {
    setFoldedBands((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleFile(file: File): Promise<void> {
    const text = await file.text();
    const current = useDetectionStore.getState().draft ?? useDetectionStore.getState().saved;
    const validation = validateFormatsFile(text, current.country);
    if (!validation.ok) {
      setImportResult({
        kind: "rejected",
        messages: describeFormatsFileIssues(text, validation.issues, current.country),
        hint: importRejectionHint(validation.issues.map((issue) => issue.code)),
      });
      return;
    }
    const plan = planFormatsImport(validation.content, current);
    if (plan.conflicts.length > 0) {
      // Antes del resumen, y sin importar nada hasta resolverlo (ADR-223 §6).
      setNameStep({
        fileName: file.name,
        content: validation.content,
        indices: plan.conflicts.map((conflict) => conflict.index),
        renames: new Map(),
      });
      return;
    }
    if (plan.change !== null) apply(plan.change);
    setImportResult({ kind: "summary", summary: plan.summary, fileName: file.name });
  }

  const nameEntries: ReadonlyArray<NameConflictEntry> | null = useMemo(() => {
    if (nameStep === null) return null;
    const live = planFormatsImport(nameStep.content, state, undefined, nameStep.renames);
    return nameStep.indices.map((index) => {
      const conflict = live.conflicts.find((candidate) => candidate.index === index);
      return {
        index,
        value: nameStep.renames.get(index) ?? nameStep.content.formats[index]?.name ?? "",
        slot:
          conflict === undefined
            ? null
            : formatIssueText({ code: conflict.code }, conflict.definition, state.userTypes),
      };
    });
  }, [nameStep, state]);

  function finishImportWithNames(): void {
    if (nameStep === null) return;
    const current = useDetectionStore.getState().draft ?? useDetectionStore.getState().saved;
    const plan = planFormatsImport(nameStep.content, current, undefined, nameStep.renames);
    if (plan.conflicts.length > 0) return;
    if (plan.change !== null) apply(plan.change);
    setNameStep(null);
    setImportResult({ kind: "summary", summary: plan.summary, fileName: nameStep.fileName });
  }

  function viewImported(): void {
    setImportResult(null);
    setQuery("");
    setFoldedSections(new Set());
  }

  function rowMenu(row: FormatRowModel): ReadonlyArray<ActionsMenuItem> {
    if (row.canRestore) {
      return [
        {
          label: "Restaurar original",
          icon: RotateCcwIcon,
          onSelect: () => {
            const basedOn = state.userFormats.find((format) => format.id === row.id)?.basedOn;
            const original = getCatalog(state.country).find((info) => info.id === basedOn);
            apply({ kind: "restoreOriginal", formatId: row.id });
            const toast = restoredFormatToast(original?.name ?? row.name);
            announce(toast.title, toast.description);
          },
        },
      ];
    }
    if (row.canDelete) {
      return [
        {
          label: "Borrar formato",
          icon: Trash2Icon,
          danger: true,
          onSelect: () => {
            apply({ kind: "deleteFormat", formatId: row.id });
            const toast = deletedFormatToast(row.name);
            announce(toast.title, toast.description);
          },
        },
      ];
    }
    return [];
  }

  function bandMenu(band: TypeBandModel): ReadonlyArray<ActionsMenuItem> {
    const typeId = band.entityType;
    if (!isUserEntityType(typeId)) return [];
    return [
      {
        label: "Editar tipo…",
        icon: PencilIcon,
        onSelect: () => setTypeDialog({ mode: "edit", typeId }),
      },
      {
        // El mismo ícono que «Exportar…» del encabezado.
        label: "Exportar este tipo…",
        icon: DownloadIcon,
        onSelect: () => {
          setExportPreselected(typeId);
          setExportOpen(true);
        },
      },
      {
        label: "Borrar tipo…",
        icon: Trash2Icon,
        danger: true,
        onSelect: () => setDeleteTypeId(typeId),
      },
    ];
  }

  function editRow(row: FormatRowModel): void {
    setBuilderRequest(
      row.source === "base"
        ? { kind: "editBase", catalogId: row.id }
        : { kind: "edit", formatId: row.id },
    );
  }

  const editingType: UserEntityTypeDefinition | undefined =
    typeDialog?.mode === "edit"
      ? state.userTypes.find((type) => type.id === typeDialog.typeId)
      : undefined;
  const typeToDelete = state.userTypes.find((type) => type.id === deleteTypeId) ?? null;
  const pendingText = describePendingChanges(pending);

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        title={DETECTION_DIALOG_COPY.title}
        description={DETECTION_DIALOG_COPY.description}
        size="2xl"
        headerActions={
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Importar…
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setExportPreselected(null);
                setExportOpen(true);
              }}
            >
              <DownloadIcon className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Exportar…
            </Button>
          </div>
        }
        footer={
          <div className="flex flex-col gap-2">
            {/* Ranura de alto fijo: el error de guardado no mueve el pie (UX-10). */}
            <p
              role={saveError === null ? undefined : "alert"}
              className="flex h-5 items-center gap-1.5 text-sm text-error"
            >
              {saveError !== null ? (
                <>
                  <TriangleAlertIcon className="h-4 w-4 shrink-0" aria-hidden />
                  {saveError}
                </>
              ) : null}
            </p>
            <div className="flex items-center gap-3">
              <p className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-text-secondary">
                <ShieldCheckIcon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-semibold text-text-primary">
                    {DETECTION_DIALOG_COPY.footerTitle}
                  </span>
                  <span className="truncate">{DETECTION_DIALOG_COPY.footerDetail}</span>
                </span>
              </p>
              <span
                aria-live="polite"
                className="w-40 shrink-0 text-right text-sm font-medium text-text-primary"
              >
                {pendingText}
              </span>
              <Button variant="secondary" onClick={requestClose} disabled={saving}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                className="min-w-[7.5rem]"
                disabled={pending === 0}
                loading={saving}
                onClick={() => {
                  void save();
                }}
              >
                Guardar
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3 pb-1">
          {/* Barra fija arriba del cuerpo que scrollea: buscador y conteo. */}
          <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg-primary pb-2 pt-0.5">
            <label className="relative min-w-0 flex-1">
              <SearchIcon
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={DETECTION_DIALOG_COPY.searchPlaceholder}
                aria-label="Buscar un tipo o un formato"
                className="w-full rounded-lg border border-border bg-bg-primary py-1.5 pl-8 pr-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <span className="shrink-0 text-sm text-text-secondary">
              {describeCounts(tree.counts)}
            </span>
          </div>

          {tree.hasResults ? (
            tree.sections.map((section) => {
              const sectionFolded = !searching && foldedSections.has(section.id);
              return (
                <section
                  key={section.id}
                  aria-label={section.title}
                  className="flex flex-col gap-2"
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={!sectionFolded}
                    disabled={searching}
                    className="flex items-center gap-1.5 rounded-md text-left text-xs font-semibold uppercase tracking-wider text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {sectionFolded ? (
                      <ChevronRightIcon className="h-4 w-4" aria-hidden />
                    ) : (
                      <ChevronDownIcon className="h-4 w-4" aria-hidden />
                    )}
                    {section.title}
                    {section.hint === "" ? null : (
                      <span className="truncate text-xs font-normal normal-case tracking-normal">
                        {section.hint}
                      </span>
                    )}
                  </button>
                  {sectionFolded ? null : (
                    <div className="flex flex-col gap-2">
                      {section.id === "own" && !searching ? (
                        // Todo lo que crea un tipo es punteado (`UX_Guidelines.md` §11b.3).
                        <button
                          type="button"
                          onClick={() => setTypeDialog({ mode: "create" })}
                          className="flex items-center gap-3 rounded-xl border-2 border-dashed border-border px-3 py-2.5 text-left hover:border-accent hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <PlusIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                          <span className="flex min-w-0 flex-col">
                            <span className="text-sm font-semibold text-accent">
                              {DETECTION_DIALOG_COPY.newTypeBand}
                            </span>
                            <span className="text-sm text-text-secondary">
                              {DETECTION_DIALOG_COPY.newTypeHint}
                            </span>
                          </span>
                        </button>
                      ) : null}
                      {section.bands.map((band) => (
                        <FormatTypeBand
                          key={band.key}
                          band={band}
                          folded={!searching && foldedBands.has(band.key)}
                          onToggleFold={() => toggleBand(band.key)}
                          onNewFormat={() =>
                            setBuilderRequest({ kind: "create", entityType: band.entityType })
                          }
                          menuItems={bandMenu(band)}
                        >
                          {band.rows.length === 0 && band.isUser ? (
                            <p className="px-3 py-2.5 text-sm text-text-secondary">
                              {DETECTION_DIALOG_COPY.emptyOwnType}
                            </p>
                          ) : (
                            band.rows.map((row) => (
                              <FormatRow
                                key={row.id}
                                row={row}
                                onToggle={(enabled) =>
                                  apply(
                                    row.source === "base"
                                      ? { kind: "setBaseFormatEnabled", formatId: row.id, enabled }
                                      : { kind: "setUserFormatEnabled", formatId: row.id, enabled },
                                  )
                                }
                                onEdit={() => editRow(row)}
                                menuItems={rowMenu(row)}
                              />
                            ))
                          )}
                        </FormatTypeBand>
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          ) : (
            <div className="flex flex-col items-start gap-2 py-6">
              <p className="text-sm text-text-secondary">
                {DETECTION_DIALOG_COPY.noResults(query.trim())}
              </p>
              <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                {DETECTION_DIALOG_COPY.clearSearch}
              </Button>
            </div>
          )}
        </div>
      </Dialog>

      {/* Solo con el diálogo abierto, que es cuando se usa: cerrado, sería un
          segundo `input[type=file]` en la pantalla de inicio, junto al del PDF. */}
      {open ? (
        <input
          ref={fileInputRef}
          type="file"
          accept=".anonly-formatos,application/json,.json"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Permite elegir de nuevo el mismo archivo.
            event.target.value = "";
            if (file !== undefined) void handleFile(file);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmClose}
        title={DETECTION_DIALOG_COPY.discardTitle(pending)}
        message={DETECTION_DIALOG_COPY.discardLine}
        confirmLabel={DETECTION_DIALOG_COPY.discard}
        cancelLabel={DETECTION_DIALOG_COPY.keepEditing}
        variant="danger"
        onConfirm={discardAndClose}
        onCancel={() => setConfirmClose(false)}
        icon={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning-strong">
            <TriangleAlertIcon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        }
      />

      <UserTypeDialog
        open={typeDialog !== null}
        scope="saved"
        mode={typeDialog?.mode ?? "create"}
        {...(editingType !== undefined ? { initial: editingType } : {})}
        existing={state.userTypes.filter((type) => type.id !== editingType?.id)}
        country={state.country}
        formatCount={editingType === undefined ? 0 : formatsOfType(state, editingType.id).length}
        onSubmit={(definition) => {
          apply(
            typeDialog?.mode === "edit"
              ? { kind: "editType", definition }
              : { kind: "createType", definition },
          );
          setTypeDialog(null);
        }}
        onClose={() => setTypeDialog(null)}
      />

      <DeleteUserTypeDialog
        open={typeToDelete !== null}
        type={typeToDelete}
        formats={typeToDelete === null ? [] : formatsOfType(state, typeToDelete.id)}
        onConfirm={() => {
          if (typeToDelete === null) return;
          const count = formatsOfType(state, typeToDelete.id).length;
          apply({ kind: "deleteType", typeId: typeToDelete.id });
          setDeleteTypeId(null);
          const toast = deletedSavedTypeToast(typeToDelete.name, count);
          announce(toast.title, toast.description);
        }}
        onCancel={() => setDeleteTypeId(null)}
      />

      <ExportFormatsDialog
        open={exportOpen}
        state={state}
        preselectedTypeId={exportPreselected}
        onClose={() => setExportOpen(false)}
      />

      <ImportNameConflictsDialog
        entries={nameEntries}
        onRename={(index, name) =>
          setNameStep((current) =>
            current === null
              ? null
              : { ...current, renames: new Map(current.renames).set(index, name) },
          )
        }
        onImport={finishImportWithNames}
        onCancel={() => setNameStep(null)}
      />

      <ImportFormatsResultDialog
        result={importResult}
        onViewInList={viewImported}
        onPickAnother={() => {
          setImportResult(null);
          fileInputRef.current?.click();
        }}
        onClose={() => setImportResult(null)}
      />

      <FormatBuilderDialog
        request={builderRequest}
        state={state}
        onSubmit={(change) => {
          apply(change);
          setBuilderRequest(null);
        }}
        onClose={() => setBuilderRequest(null)}
      />
    </>
  );
}
