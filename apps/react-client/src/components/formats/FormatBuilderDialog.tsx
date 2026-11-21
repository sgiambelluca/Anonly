/**
 * `FormatBuilderDialog` — el generador de formatos (`Components.md` §13b.5,
 * ADR-228).
 *
 * Un diálogo de una sola columna: nombre y «Es un…», variantes en pestañas, la
 * tira de piezas, «Se lee» y «Ejemplo», el ajuste de la pieza elegida, «Solo si
 * antes dice…» y la caja de estado fija. «Probar con un texto» abre un panel
 * flotante (`FormatTestPanel`).
 *
 * El estado vive acá, local: el formato en edición, la variante y la pieza
 * elegidas. Se vuelca al borrador de `detection.store` solo al confirmar, con
 * **un** `DetectionChange` (`onSubmit`). Toda la lógica está en
 * `formatBuilderModel.ts` y `formatBuilderStatus.ts`; este archivo conecta
 * eventos con esas funciones.
 *
 * «Es un…» no ofrece crear un tipo: primero va el tipo y después sus formatos
 * (ADR-228 §1); un tipo nuevo se crea antes, desde «Tus tipos».
 */

import type { EntityTypeId } from "@anonly/anonymization-core";
import { FlaskConicalIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DetectionChange, DetectionState } from "../../store/detectionState.js";
import { Banner } from "../common/Banner.js";
import { Button } from "../common/Button.js";
import { ConfirmDialog } from "../common/ConfirmDialog.js";
import { Dialog } from "../common/Dialog.js";
import { FieldHint } from "../common/FieldHint.js";
import { Select } from "../common/Select.js";

import { ContextWords } from "./ContextWords.js";
import {
  addVariant,
  appendPiece,
  BUILDER_COPY,
  buildDefinition,
  describeVariant,
  exampleOfVariant,
  hasChanges,
  moveStep,
  newPiece,
  pieceAt,
  pieceCounter,
  removeAt,
  removeVariant,
  replaceAt,
  replaceVariant,
  resolveBuilderSetup,
  submitChange,
  typeOptions,
  variantCounter,
  type BuilderDraft,
  type BuilderSetup,
  type PieceClassId,
  type PiecePath,
  type Pieces,
} from "./formatBuilderModel.js";
import { evaluateBuilder } from "./formatBuilderStatus.js";
import { FormatStatusBox } from "./FormatStatusBox.js";
import { FormatTestPanel } from "./FormatTestPanel.js";
import { countPieces } from "./formatTexts.js";
import { PieceInspector } from "./PieceInspector.js";
import { PieceStrip } from "./PieceStrip.js";

export type FormatBuilderRequest =
  /** «Nuevo formato» en la banda de un tipo. */
  | { readonly kind: "create"; readonly entityType: EntityTypeId }
  /** «Editar» un formato propio o una copia editada, por su id. */
  | { readonly kind: "edit"; readonly formatId: string }
  /** «Editar» un formato base `structure`: se edita como copia, por el id del catálogo. */
  | { readonly kind: "editBase"; readonly catalogId: string };

export interface FormatBuilderDialogProps {
  /** `null` = cerrado. */
  readonly request: FormatBuilderRequest | null;
  /** El borrador del árbol. */
  readonly state: DetectionState;
  readonly onSubmit: (change: DetectionChange) => void;
  readonly onClose: () => void;
}

export const BUILDER_TEXTS = {
  nameLabel: "Nombre del formato",
  nameHelp: "Así lo vas a ver en tu lista de formatos",
  namePlaceholder: "Por ejemplo, «Legajo»",
  typeLabel: "Es un…",
  addVariant: "Variante",
  addVariantHint: "Otra forma de escribir el mismo dato",
  deleteVariant: "Borrar variante",
  readsLabel: "Se lee",
  exampleLabel: "Ejemplo",
  testButton: "Probar con un texto",
  cancel: "Cancelar",
  deleteVariantTitle: (n: number) => `¿Borrar la variante ${n}?`,
  deleteVariantLine: (pieces: number, others: number) => {
    const lost =
      pieces === 0
        ? "La variante no tiene piezas."
        : pieces === 1
          ? "Se pierde 1 pieza."
          : `Se pierden ${pieces} piezas.`;
    if (others === 0) return lost;
    return `${lost} ${others === 1 ? "La otra variante queda como está." : `Las otras ${others} variantes quedan como están.`}`;
  },
  deleteVariantConfirm: "Borrar variante",
  keepVariant: "Conservarla",
  discardTitle: "¿Cerrar sin guardar?",
  discardLine: "Lo que armaste en este formato no se guarda.",
  keepEditing: "Seguir editando",
  discard: "Descartar cambios",
} as const;

const INPUT_CLASS =
  "rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function FormatBuilderDialog(props: FormatBuilderDialogProps) {
  if (props.request === null) return null;
  return <BuilderBody {...props} request={props.request} />;
}

interface BodyProps extends FormatBuilderDialogProps {
  readonly request: FormatBuilderRequest;
}

function BuilderBody({ request, state, onSubmit, onClose }: BodyProps) {
  const [setup] = useState<BuilderSetup | null>(() =>
    resolveBuilderSetup(request, state, () => crypto.randomUUID()),
  );
  if (setup === null) {
    // Un formato que ya no existe: no hay nada que abrir.
    return <MissingRequest onClose={onClose} />;
  }
  return <BuilderForm setup={setup} state={state} onSubmit={onSubmit} onClose={onClose} />;
}

function MissingRequest({ onClose }: { readonly onClose: () => void }) {
  // Se cierra solo: el formato pedido no existe en el borrador.
  useEffect(() => {
    onClose();
  }, [onClose]);
  return null;
}

interface FormProps {
  readonly setup: BuilderSetup;
  readonly state: DetectionState;
  readonly onSubmit: (change: DetectionChange) => void;
  readonly onClose: () => void;
}

function BuilderForm({ setup, state, onSubmit, onClose }: FormProps) {
  const [draft, setDraft] = useState<BuilderDraft>(setup.draft);
  const [variantIndex, setVariantIndex] = useState(0);
  const [selected, setSelected] = useState<PiecePath | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [sampleText, setSampleText] = useState("");
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const definition = useMemo(() => buildDefinition(draft, setup), [draft, setup]);
  const evaluation = useMemo(
    () => evaluateBuilder(definition, state, setup.mode),
    [definition, state, setup.mode],
  );
  const options = useMemo(
    () => typeOptions(state.userTypes, draft.entityType),
    [state.userTypes, draft.entityType],
  );

  const variant: Pieces = draft.variants[variantIndex] ?? [];
  const piece = selected === null ? null : (pieceAt(variant, selected) ?? null);
  const pieces = pieceCounter(variant);
  const variants = variantCounter(draft.variants.length);
  const exampleText = exampleOfVariant(variant, definition) || "—";
  const readsLine = `${BUILDER_TEXTS.readsLabel}: ${describeVariant(variant, draft.context)} · ${BUILDER_TEXTS.exampleLabel}: ${exampleText}`;
  const changed = hasChanges(setup.draft, draft);

  function setVariant(next: Pieces, nextSelected: PiecePath | null): void {
    setDraft((current) => ({
      ...current,
      variants: replaceVariant(current.variants, variantIndex, next),
    }));
    setSelected(nextSelected);
  }

  function add(id: PieceClassId, parent: number | null): void {
    if (pieces.atLimit) return;
    const result = appendPiece(variant, newPiece(id), parent);
    setVariant(result.variant, result.path);
  }

  function move(direction: -1 | 1): void {
    if (selected === null) return;
    const result = moveStep(variant, selected, direction);
    if (result !== null) setVariant(result.variant, result.path);
  }

  function requestClose(): void {
    if (changed) setConfirmClose(true);
    else onClose();
  }

  function submit(): void {
    if (!evaluation.status.canSubmit) return;
    onSubmit(submitChange(setup, definition));
  }

  function selectVariant(index: number): void {
    setVariantIndex(index);
    setSelected(null);
  }

  function confirmDeleteVariant(): void {
    if (deleteIndex === null) return;
    setDraft((current) => ({ ...current, variants: removeVariant(current.variants, deleteIndex) }));
    setVariantIndex((current) => Math.max(0, Math.min(current, draft.variants.length - 2)));
    setSelected(null);
    setDeleteIndex(null);
  }

  const deletingPieces = deleteIndex === null ? 0 : countPieces(draft.variants[deleteIndex] ?? []);

  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        title={setup.title}
        description={BUILDER_COPY.line}
        size="xl"
        tall
        descriptionInline
        onEscapeKeyDown={(event) => {
          // `Esc` cierra primero el panel de prueba (`UX_Guidelines.md` §11b.7).
          if (testOpen) {
            event.preventDefault();
            setTestOpen(false);
          }
        }}
        headerActions={
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={testOpen}
            className={testOpen ? "!border-accent !bg-accent/10 !text-accent" : ""}
            onClick={() => setTestOpen((current) => !current)}
          >
            <span className="flex items-center gap-1.5">
              <FlaskConicalIcon className="h-4 w-4" aria-hidden />
              {BUILDER_TEXTS.testButton}
            </span>
          </Button>
        }
        footer={
          <div className="flex flex-col gap-2.5">
            {/* La caja de estado va fija entre el cuerpo y los botones: no scrollea (ADR-228 §7). */}
            <FormatStatusBox status={evaluation.status} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={requestClose}>
                {BUILDER_TEXTS.cancel}
              </Button>
              <Button
                variant="primary"
                className="min-w-[8.75rem]"
                disabled={!evaluation.status.canSubmit}
                onClick={submit}
              >
                {setup.submitLabel}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-2.5">
          {setup.notice !== null ? <Banner variant="info">{setup.notice}</Banner> : null}

          <div className="grid grid-cols-[1fr_14rem] gap-3">
            <div className="flex flex-col gap-1">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-text-primary">
                  {BUILDER_TEXTS.nameLabel}
                </span>
                <input
                  type="text"
                  value={draft.name}
                  placeholder={BUILDER_TEXTS.namePlaceholder}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  autoFocus
                  aria-describedby="format-name-hint"
                  className={INPUT_CLASS}
                />
              </label>
              {/* Línea de ayuda (§11b.17): el nombre no tiene error propio. */}
              <FieldHint id="format-name-hint" help={BUILDER_TEXTS.nameHelp} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-text-primary">
                {BUILDER_TEXTS.typeLabel}
              </span>
              <Select
                aria-label={BUILDER_TEXTS.typeLabel}
                value={options.find((option) => option.type === draft.entityType)?.value ?? ""}
                disabled={setup.typeLocked}
                options={options.map(({ value, label }) => ({ value, label }))}
                onChange={(value) => {
                  const chosen = options.find((option) => option.value === value);
                  if (chosen !== undefined) setDraft({ ...draft, entityType: chosen.type });
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div
              className="flex items-end gap-0.5 border-b border-border"
              role="tablist"
              aria-label="Variantes"
            >
              {draft.variants.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={index === variantIndex}
                  onClick={() => selectVariant(index)}
                  className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    index === variantIndex
                      ? "border-accent font-semibold text-text-primary"
                      : "border-transparent text-text-secondary hover:text-text-primary"
                  }`}
                >
                  Variante {index + 1}
                  {evaluation.variantsWithIssues.has(index) ? (
                    <span
                      data-variant-issue
                      role="img"
                      aria-label="Tiene un problema"
                      className="h-1.5 w-1.5 rounded-full bg-error"
                    />
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                disabled={variants.atLimit}
                title={BUILDER_TEXTS.addVariantHint}
                onClick={() => {
                  setDraft({ ...draft, variants: addVariant(draft.variants) });
                  selectVariant(draft.variants.length);
                }}
                className="-mb-px flex h-9 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlusIcon className="h-4 w-4" aria-hidden />
                {BUILDER_TEXTS.addVariant}
              </button>
              <span className="flex-1" />
              <span className="self-center pb-1 text-xs text-text-secondary">
                {variants.visible ? variants.text : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="mb-1 ml-2 !text-error hover:!bg-error/10"
                disabled={draft.variants.length <= 1}
                onClick={() => setDeleteIndex(variantIndex)}
              >
                <span className="flex items-center gap-1.5">
                  <Trash2Icon className="h-4 w-4" aria-hidden />
                  {BUILDER_TEXTS.deleteVariant}
                </span>
              </Button>
            </div>

            <PieceStrip
              variant={variant}
              selected={selected}
              addDisabled={pieces.atLimit}
              onSelect={setSelected}
              onMoved={(next, path) => setVariant(next, path)}
              onAdd={(id) => add(id, null)}
            />
          </div>

          {/* Alto fijo de una línea: «Se lee · Ejemplo» con elipsis y el texto completo en `title`. */}
          <div className="flex h-5 shrink-0 items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate" title={readsLine}>
              <b className="font-semibold text-text-primary">{BUILDER_TEXTS.readsLabel}:</b>{" "}
              <span className="text-text-secondary">{describeVariant(variant, draft.context)}</span>
              {" · "}
              <b className="font-semibold text-text-primary">{BUILDER_TEXTS.exampleLabel}:</b>{" "}
              <span className="font-mono text-text-primary">{exampleText}</span>
            </span>
            <span className="shrink-0 text-xs text-text-secondary">
              {pieces.visible ? pieces.text : ""}
            </span>
          </div>

          <PieceInspector
            piece={piece}
            path={selected}
            variantLength={variant.length}
            canMoveLeft={selected !== null && moveStep(variant, selected, -1) !== null}
            canMoveRight={selected !== null && moveStep(variant, selected, 1) !== null}
            onMove={move}
            onDelete={() => {
              if (selected !== null) setVariant(removeAt(variant, selected), null);
            }}
            onChange={(next) => {
              if (selected !== null) setVariant(replaceAt(variant, selected, next), selected);
            }}
            onAddInside={(id) => {
              if (selected !== null && selected.length === 1) add(id, selected[0]);
            }}
            addDisabled={pieces.atLimit}
          />

          <ContextWords
            words={draft.context}
            onChange={(context) => setDraft({ ...draft, context })}
          />
        </div>

        {testOpen ? (
          <FormatTestPanel
            definition={definition}
            text={sampleText}
            onTextChange={setSampleText}
            onClose={() => setTestOpen(false)}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleteIndex !== null}
        title={BUILDER_TEXTS.deleteVariantTitle((deleteIndex ?? 0) + 1)}
        message={BUILDER_TEXTS.deleteVariantLine(deletingPieces, draft.variants.length - 1)}
        confirmLabel={BUILDER_TEXTS.deleteVariantConfirm}
        cancelLabel={BUILDER_TEXTS.keepVariant}
        variant="danger"
        onConfirm={confirmDeleteVariant}
        onCancel={() => setDeleteIndex(null)}
      />

      <ConfirmDialog
        open={confirmClose}
        title={BUILDER_TEXTS.discardTitle}
        message={BUILDER_TEXTS.discardLine}
        confirmLabel={BUILDER_TEXTS.discard}
        cancelLabel={BUILDER_TEXTS.keepEditing}
        variant="danger"
        onConfirm={() => {
          setConfirmClose(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
        icon={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning-strong">
            <TriangleAlertIcon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        }
      />
    </>
  );
}
