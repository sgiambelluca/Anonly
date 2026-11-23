/**
 * Corredor de la medición: arma formatos de prototipo (RegExp con control o
 * piezas), y aplica lo que hace `RegexEngine.process` después del recorrido:
 * control, guarda de corrida (ADR-075 §2, la misma función del motor) y
 * resolución de solapamientos entre formatos base (caso 10: gana el más largo).
 */

import type { RegexPattern } from "../../../packages/anonymization-core/regex-engine/src/regex.types.js";
import { passesRunGuard } from "../../../packages/anonymization-core/regex-engine/src/run-guard.js";

import { buildContextRegex, CONTEXT_WINDOW, scanPieces } from "./pieces.js";
import type { Candidate, FormatClass, Hit, Piece, ProtoFormat } from "./types.js";

/** Borde de «letra o dígito»: el del generador (ADR-220). */
export const B0 = "(?<![\\p{L}\\p{N}])";
export const B1 = "(?![\\p{L}\\p{N}])";

interface Common {
  readonly id: string;
  readonly country: string;
  readonly entityType: string;
  readonly optional?: boolean;
  readonly replaces?: string;
  readonly maskFormat: string;
  readonly note: string;
  readonly normalize: (raw: string) => string;
  readonly control?: (normalized: string) => boolean;
  readonly contextBefore?: ReadonlyArray<string>;
  /** Palabras de relleno admitidas entre la palabra de contexto y el dato. */
  readonly contextGapWords?: number;
  /** El match no empieza justo después de lo que cumple esta expresión (2 caracteres previos). */
  readonly notAfter?: RegExp;
  readonly controlName?: string;
  readonly normalizerName?: string;
}

/** Máximo de palabras de contexto por formato (ADR-220, `FORMAT_MAX_CONTEXT`). */
export const FORMAT_MAX_CONTEXT = 5;

function checkContext(spec: Common): void {
  if ((spec.contextBefore?.length ?? 0) > FORMAT_MAX_CONTEXT) {
    throw new Error(`${spec.id}: más de ${FORMAT_MAX_CONTEXT} palabras de contexto`);
  }
}

function meta(
  spec: Common,
): Pick<ProtoFormat, "context" | "contextGapWords" | "controlName" | "normalizerName"> {
  return {
    ...(spec.contextBefore === undefined ? {} : { context: spec.contextBefore }),
    ...(spec.contextGapWords === undefined ? {} : { contextGapWords: spec.contextGapWords }),
    ...(spec.controlName === undefined ? {} : { controlName: spec.controlName }),
    ...(spec.normalizerName === undefined ? {} : { normalizerName: spec.normalizerName }),
  };
}

function classOf(hasControl: boolean, hasContext: boolean): FormatClass {
  if (hasControl) return hasContext ? "control+context" : "control";
  return hasContext ? "structure+context" : "structure";
}

export function fromRegex(
  spec: Common & { readonly source: string; readonly flags?: string },
): ProtoFormat {
  checkContext(spec);
  const flags = `${spec.flags ?? "u"}g`.replace(/(.)(?=.*\1)/g, "");
  const ctx =
    spec.contextBefore === undefined
      ? null
      : buildContextRegex(spec.contextBefore, spec.contextGapWords ?? 0);
  return {
    ...meta(spec),
    id: spec.id,
    country: spec.country,
    entityType: spec.entityType,
    cls: classOf(spec.control !== undefined, spec.contextBefore !== undefined),
    optional: spec.optional ?? false,
    ...(spec.replaces === undefined ? {} : { replaces: spec.replaces }),
    maskFormat: spec.maskFormat,
    note: spec.note,
    scan: (text) => {
      const re = new RegExp(`${B0}(?:${spec.source})${B1}`, flags);
      const out: Candidate[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        const start = m.index;
        if (
          spec.notAfter !== undefined &&
          spec.notAfter.test(text.slice(Math.max(0, start - 2), start))
        ) {
          re.lastIndex = start + 1;
          continue;
        }
        if (ctx !== null && !ctx.test(text.slice(Math.max(0, start - CONTEXT_WINDOW), start))) {
          // El contexto va antes y no forma parte del match: se reintenta una posición más allá.
          re.lastIndex = start + 1;
          continue;
        }
        const normalized = spec.normalize(m[0]);
        out.push({
          start,
          end: start + m[0].length,
          normalized,
          ok: spec.control === undefined ? true : spec.control(normalized),
        });
      }
      return out;
    },
  };
}

export function fromPieces(
  spec: Common & { readonly variants: ReadonlyArray<ReadonlyArray<Piece>> },
): ProtoFormat {
  checkContext(spec);
  return {
    ...meta(spec),
    id: spec.id,
    country: spec.country,
    entityType: spec.entityType,
    cls: classOf(spec.control !== undefined, spec.contextBefore !== undefined),
    optional: spec.optional ?? false,
    ...(spec.replaces === undefined ? {} : { replaces: spec.replaces }),
    maskFormat: spec.maskFormat,
    note: spec.note,
    scan: (text) =>
      scanPieces(spec.variants, text, spec.normalize, spec.control, {
        ...(spec.contextBefore === undefined ? {} : { contextBefore: spec.contextBefore }),
        ...(spec.contextGapWords === undefined ? {} : { contextGapWords: spec.contextGapWords }),
        ...(spec.notAfter === undefined ? {} : { notAfter: spec.notAfter }),
      }),
  };
}

/** Un `RegexPattern` del catálogo argentino, corrido igual que `runPattern` del motor. */
export function fromArPattern(pattern: RegexPattern, country = "AR"): ProtoFormat {
  return {
    id: pattern.id,
    country,
    entityType: pattern.entityType,
    cls: pattern.checksum === undefined ? "structure" : "control",
    optional: false,
    maskFormat: pattern.maskFormat,
    note: "catálogo argentino vigente (DEFAULT_PATTERNS_AR)",
    scan: (text) => {
      const re = pattern.pattern.global
        ? new RegExp(pattern.pattern.source, pattern.pattern.flags)
        : new RegExp(pattern.pattern.source, `${pattern.pattern.flags}g`);
      const out: Candidate[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const matched = m[0];
        if (matched.length === 0) {
          re.lastIndex += 1;
          continue;
        }
        const lead = matched.length - matched.trimStart().length;
        const raw = matched.trim();
        if (raw.length === 0) continue;
        const normalized = pattern.normalizer(raw);
        out.push({
          start: m.index + lead,
          end: m.index + lead + raw.length,
          normalized,
          ok: pattern.checksum === undefined ? true : pattern.checksum(normalized),
        });
      }
      return out;
    },
  };
}

interface Raw extends Hit {
  readonly order: number;
}

/** Control + guarda de corrida + solapamientos, sobre un texto de página. */
export function runFormats(formats: ReadonlyArray<ProtoFormat>, text: string): Hit[] {
  const raws: Raw[] = [];
  formats.forEach((f, order) => {
    for (const c of f.scan(text)) {
      if (!c.ok) continue;
      const value = text.slice(c.start, c.end);
      if (!passesRunGuard(text, c.start, c.end, value)) continue;
      raws.push({
        formId: f.id,
        entityType: f.entityType,
        start: c.start,
        end: c.end,
        value,
        normalized: c.normalized,
        order,
      });
    }
  });
  // Entre formatos base: largo desc, start asc, orden de la lista; todo choque descarta.
  const sorted = [...raws].sort((a, b) => {
    const la = a.end - a.start;
    const lb = b.end - b.start;
    if (la !== lb) return lb - la;
    if (a.start !== b.start) return a.start - b.start;
    return a.order - b.order;
  });
  const accepted: Raw[] = [];
  for (const m of sorted) {
    if (!accepted.some((a) => m.start < a.end && a.start < m.end)) accepted.push(m);
  }
  return accepted.sort((a, b) => a.start - b.start).map(({ order: _order, ...hit }) => hit);
}
