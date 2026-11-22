/**
 * `formatBuilderStatus.ts` — qué dice la caja de estado del generador
 * (`Components.md` §13b.5, ADR-228 §7) y qué prueba el panel flotante (§6).
 * Parte pura: sale de `validateFormat`, `compareFormat` y `testFormat`.
 *
 * La caja mide siempre lo mismo y tiene tres tonos: verde (listo), amarillo
 * (comparte textos con otro formato: deja crear) y rojo (un error: apaga el
 * botón principal). Los textos de los errores salen de `formatTexts.ts`
 * (`UX_Guidelines.md` §11b.16).
 */

import {
  compareFormat,
  testFormat,
  validateFormat,
  type BaseFormatSetting,
  type FormatComparison,
  type FormatDefinition,
  type FormatTestMatch,
  type FormatValidation,
} from "@anonly/anonymization-core";

import { disabledBaseIds, type DetectionState } from "../../store/detectionState.js";

import { BUILDER_COPY, type BuilderMode } from "./formatBuilderModel.js";
import { nameOfFormat } from "./formatsImport.js";
import { describeOverlapParts, formatIssueText } from "./formatTexts.js";

export type StatusTone = "ready" | "warning" | "error";

export interface BuilderStatus {
  readonly tone: StatusTone;
  /** El texto completo (titular y detalle juntos): lo leen los lectores de pantalla y el `title`. */
  readonly text: string;
  /** El titular, en negrita; ausente si el texto es una sola frase (los errores de §11b.16). */
  readonly headline?: string;
  /** Lo que sigue al titular, en tono normal. */
  readonly detail?: string;
  /** Con un error, el botón principal está apagado; con un aviso, no. */
  readonly canSubmit: boolean;
}

export interface BuilderEvaluation {
  readonly validation: FormatValidation;
  readonly comparison: FormatComparison | null;
  readonly status: BuilderStatus;
  /** Las variantes con un problema: llevan un punto rojo en su pestaña. */
  readonly variantsWithIssues: ReadonlySet<number>;
}

/**
 * Los formatos contra los que se compara: los propios sin el que se edita, y
 * los base de pura forma **salvo el que este formato reemplaza**. Un formato
 * base que se está editando corre hasta que la copia exista, y compararlo
 * daría «idéntico» al abrir (`Contracts.md` §5.2, `compareFormat`).
 */
function comparisonInput(
  definition: FormatDefinition,
  state: DetectionState,
): Parameters<typeof compareFormat>[1] {
  const disabled = new Set(disabledBaseIds(state));
  if (definition.basedOn !== undefined) disabled.add(definition.basedOn);
  const baseFormats: ReadonlyArray<BaseFormatSetting> = [...disabled].map((formatId) => ({
    formatId,
    enabled: false,
  }));
  return {
    country: state.country,
    baseFormats,
    userFormats: state.userFormats.filter((format) => format.id !== definition.id),
    catalogRefs: state.catalogRefs,
  };
}

/** Los dos tramos del rojo «Ya existe un formato igual»; `own` dice si el otro es un formato tuyo. */
export function identicalParts(
  otherName: string,
  own: boolean,
): { readonly headline: string; readonly detail: string } {
  return {
    headline: "Ya existe un formato igual.",
    detail: `Tiene la misma forma que «${otherName}», ${own ? "tuyo" : "del catálogo"}. Si querés cambiarlo, editá ese.`,
  };
}

function joinParts(parts: { readonly headline: string; readonly detail: string }): string {
  return `${parts.headline} ${parts.detail}`;
}

export function evaluateBuilder(
  definition: FormatDefinition,
  state: DetectionState,
  mode: BuilderMode,
): BuilderEvaluation {
  const validation = validateFormat(definition, {
    userTypes: state.userTypes,
    existingFormats: state.userFormats
      .filter((format) => format.id !== definition.id)
      .map(({ id, name }) => ({ id, name })),
  });
  const variantsWithIssues = new Set<number>();
  for (const issue of validation.issues) {
    if (issue.variantIndex !== undefined) variantsWithIssues.add(issue.variantIndex);
  }

  const firstIssue = validation.issues[0];
  if (firstIssue !== undefined) {
    return {
      validation,
      comparison: null,
      variantsWithIssues,
      status: {
        tone: "error",
        text: formatIssueText(firstIssue, definition, state.userTypes),
        canSubmit: false,
      },
    };
  }

  const comparison = compareFormat(definition, comparisonInput(definition, state));
  if (comparison.identicalTo !== null) {
    const identicalId = comparison.identicalTo;
    const identical = identicalParts(
      nameOfFormat(identicalId, state, []),
      state.userFormats.some((format) => format.id === identicalId),
    );
    return {
      validation,
      comparison,
      variantsWithIssues,
      status: {
        tone: "error",
        text: joinParts(identical),
        ...identical,
        canSubmit: false,
      },
    };
  }
  if (comparison.overlaps.length > 0) {
    const overlap = describeOverlapParts(
      comparison.overlaps.map((entry) => ({
        name: nameOfFormat(entry.formatId, state, []),
        example: entry.example,
      })),
    );
    return {
      validation,
      comparison,
      variantsWithIssues,
      status: {
        tone: "warning",
        text: joinParts(overlap),
        ...overlap,
        canSubmit: true,
      },
    };
  }
  const headline = mode === "create" ? BUILDER_COPY.readyCreate : BUILDER_COPY.readySave;
  return {
    validation,
    comparison,
    variantsWithIssues,
    status: {
      tone: "ready",
      text: `${headline} ${BUILDER_COPY.readyDetail}`,
      headline,
      detail: BUILDER_COPY.readyDetail,
      canSubmit: true,
    },
  };
}

// ─── «Probar con un texto» ───

export type SegmentKind = "plain" | "hit" | "context";

export interface TestSegment {
  readonly text: string;
  readonly kind: SegmentKind;
}

export interface TestOutcome {
  readonly count: number;
  readonly segments: ReadonlyArray<TestSegment>;
}

/** Los tramos del texto donde aparece alguna palabra de contexto (sin distinguir mayúsculas). */
export function contextRanges(
  text: string,
  words: ReadonlyArray<string>,
): ReadonlyArray<FormatTestMatch> {
  const lowered = text.toLowerCase();
  // `toLowerCase` puede cambiar el largo (algunas letras); en ese caso se busca en el original.
  const haystack = lowered.length === text.length ? lowered : text;
  const ranges: FormatTestMatch[] = [];
  for (const raw of words) {
    const word = raw.trim();
    if (word === "") continue;
    const needle = haystack === lowered ? word.toLowerCase() : word;
    if (needle.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      ranges.push({ start: at, end: at + needle.length });
      from = at + needle.length;
    }
  }
  return ranges;
}

/**
 * Parte el texto en tramos: lo que se detectaría, las palabras de contexto, y
 * el resto. Si un tramo es las dos cosas, gana lo detectado.
 */
export function buildSegments(
  text: string,
  matches: ReadonlyArray<FormatTestMatch>,
  context: ReadonlyArray<FormatTestMatch>,
): ReadonlyArray<TestSegment> {
  const marks: SegmentKind[] = Array.from({ length: text.length }, () => "plain");
  for (const range of context) {
    for (let i = Math.max(0, range.start); i < Math.min(text.length, range.end); i += 1) {
      marks[i] = "context";
    }
  }
  for (const match of matches) {
    for (let i = Math.max(0, match.start); i < Math.min(text.length, match.end); i += 1) {
      marks[i] = "hit";
    }
  }
  const segments: TestSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || marks[i] !== marks[start]) {
      segments.push({ text: text.slice(start, i), kind: marks[start] ?? "plain" });
      start = i;
    }
  }
  return segments;
}

/**
 * Prueba el formato con un texto. El texto es del usuario y **no sale de acá**:
 * no se guarda ni se loguea (ADR-220 §3, ADR-223 §3).
 */
export function runFormatTest(definition: FormatDefinition, sampleText: string): TestOutcome {
  if (sampleText === "") return { count: 0, segments: [] };
  const matches = testFormat(definition, sampleText);
  return {
    count: matches.length,
    segments: buildSegments(
      sampleText,
      matches,
      contextRanges(sampleText, definition.contextBefore ?? []),
    ),
  };
}

// ─── El panel flotante ───

export interface PanelPoint {
  readonly x: number;
  readonly y: number;
}

export interface PanelSize {
  readonly width: number;
  readonly height: number;
}

export interface BoxRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Ancho y alto con los que se dibuja el panel de prueba. */
export const TEST_PANEL_SIZE: PanelSize = { width: 320, height: 400 };
const PANEL_GAP = 12;
const PANEL_MARGIN = 8;

/** Lo que mide la cabecera del diálogo (título, descripción y sus botones): el panel nunca la tapa. */
export const DIALOG_HEADER_CLEARANCE = 88;

/**
 * Dónde se abre el panel, como desplazamiento respecto de la esquina superior
 * izquierda del diálogo: a su derecha si hay lugar (ADR-228 §6); si no, adentro
 * del diálogo, contra su borde derecho y **debajo de la cabecera**: nunca encima
 * del botón que lo abre ni de la X.
 */
export function initialPanelOffset(
  dialog: BoxRect,
  viewport: PanelSize,
  size: PanelSize = TEST_PANEL_SIZE,
): PanelPoint {
  const right = dialog.left + dialog.width;
  const fitsRight = right + PANEL_GAP + size.width + PANEL_MARGIN <= viewport.width;
  if (fitsRight) {
    return clampPanelOffset({ x: right + PANEL_GAP - dialog.left, y: 0 }, dialog, viewport, size);
  }
  const x = dialog.width - size.width - PANEL_GAP;
  return clampPanelOffset({ x, y: DIALOG_HEADER_CLEARANCE }, dialog, viewport, size);
}

/** Mantiene el panel entero dentro de la ventana mientras se arrastra. */
export function clampPanelOffset(
  offset: PanelPoint,
  dialog: BoxRect,
  viewport: PanelSize,
  size: PanelSize = TEST_PANEL_SIZE,
): PanelPoint {
  const minX = PANEL_MARGIN - dialog.left;
  const maxX = Math.max(minX, viewport.width - size.width - PANEL_MARGIN - dialog.left);
  const minY = PANEL_MARGIN - dialog.top;
  const maxY = Math.max(minY, viewport.height - size.height - PANEL_MARGIN - dialog.top);
  return {
    x: Math.min(Math.max(offset.x, minX), maxX),
    y: Math.min(Math.max(offset.y, minY), maxY),
  };
}
