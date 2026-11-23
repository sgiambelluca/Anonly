/**
 * Medición de la tanda 1 (Plan_1.1.1.md §2, paso 2): tipos compartidos del
 * prototipo. Nada de esto es código de producto: vive fuera de los motores.
 */

export type CharClass = "digit" | "letter" | "upper" | "lower" | "alnum";

/** Vocabulario de piezas de ADR-220 (las que cita el informe de investigación). */
export type Piece =
  | { readonly k: "chars"; readonly cls: CharClass; readonly min: number; readonly max: number }
  | { readonly k: "text"; readonly value: string }
  | { readonly k: "sep"; readonly chars: string; readonly optional?: boolean }
  | { readonly k: "optional"; readonly pieces: ReadonlyArray<Piece> };

/** Un candidato que devuelve el recorrido de un formato, antes de control y guarda. */
export interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly normalized: string;
  /** Resultado del control (verificador, lista); `true` si el formato no tiene. */
  readonly ok: boolean;
}

export type FormatClass = "structure" | "control" | "structure+context" | "control+context";

export interface ProtoFormat {
  /** Id de la forma, único: `cl:rut`, `cl:rut-singuion`. */
  readonly id: string;
  readonly country: string;
  /** Valor de `EntityType` (o de los cuatro tipos nuevos de ADR-236 §3). */
  readonly entityType: string;
  readonly cls: FormatClass;
  /**
   * `true` si es una forma de menor precisión o sin verificador: el mantenedor
   * la aprueba aparte (Plan_1.1.1.md §5). No entra al «núcleo».
   */
  readonly optional: boolean;
  /** Si es una alternativa que reemplaza a otra forma (misma verdad esperada). */
  readonly replaces?: string;
  readonly maskFormat: string;
  readonly note: string;
  /** Palabras de contexto «antes» (máximo 5 por formato, FORMAT_MAX_CONTEXT), si las tiene. */
  readonly context?: ReadonlyArray<string>;
  /** Palabras de relleno que se admiten entre la palabra de contexto y el dato (0 = justo antes). */
  readonly contextGapWords?: number;
  /** Nombre del control (verificador o lista), si es un formato con control. */
  readonly controlName?: string;
  /** Nombre del normalizador. */
  readonly normalizerName?: string;
  readonly scan: (text: string) => ReadonlyArray<Candidate>;
}

export interface Hit {
  readonly formId: string;
  readonly entityType: string;
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly normalized: string;
}

export type Rendering = "normal" | "mayus" | "minus";

/** Verdad de una entidad de un formato nuevo (`P`) o de un universal (`U`). */
export interface Truth {
  readonly kind: "P" | "U";
  readonly entityType: string;
  /** Forma esperada (P) o `universal` (U). */
  readonly form: string;
  /** Rótulo de cómo está escrita: `puntos+guion`, `sin puntos`, etc. */
  readonly shape: string;
  /** Identidad de la persona o cosa: dos verdades con la misma clave son el mismo dato. */
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface Negative {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface CorpusDoc {
  readonly id: string;
  readonly country: string;
  readonly rendering: Rendering;
  /** `true` si el documento se sumó en la segunda medición (casos que piden los cambios del Plan §5). */
  readonly added: boolean;
  readonly text: string;
  readonly truths: ReadonlyArray<Truth>;
  readonly negs: ReadonlyArray<Negative>;
}

export interface CorpusSource {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly renderings?: ReadonlyArray<"mayus" | "minus">;
  /** Documento sumado en la segunda medición. */
  readonly added?: boolean;
}
