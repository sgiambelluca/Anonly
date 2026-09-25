/**
 * `searchResults.ts` — lo que la lista de resultados de la lupa muestra por
 * cada coincidencia (ADR-169 §7, `Components.md` §5.4c, `UX_Guidelines.md`
 * §5.4b).
 *
 * Por cada `TextMatch`: la página, la frase alrededor (armada con
 * `getPageWords` y el `wordSpan` del match) y su estado — **oculto como
 * Persona N.º 02** (el resultado cae sobre un miembro de un grupo) o **Sin
 * ocultar**.
 *
 * **Se compara contra los fragmentos, no contra la envolvente** (ADR-169, "En
 * contra"; ADR-074): una entidad partida en dos renglones tiene un `bbox` que
 * cubre el ancho de la página, y un resultado que cae en el hueco entre los dos
 * fragmentos no está oculto. `fragments` ausente ≡ `[bbox]`.
 *
 * Es **presentación**: no decide nada del Core, no crea grupos. Módulo puro:
 * los tests de `apps/react-client` corren en Node sin jsdom.
 */

import type {
  BoundingBox,
  EntityGroup,
  EntityType,
  TextMatch,
  Word,
} from "@anonly/anonymization-core";

/** Palabras de contexto a cada lado del resultado. */
export const CONTEXT_WORDS = 6;

export interface MatchContext {
  readonly before: string;
  readonly match: string;
  readonly after: string;
}

/**
 * La frase alrededor de un resultado. Si la página no trae las palabras que
 * el `wordSpan` apunta (no debería pasar: son las mismas de `findText`), se
 * cae al texto del match solo.
 */
export function matchContext(
  pageWords: ReadonlyArray<Word>,
  match: TextMatch,
  radius: number = CONTEXT_WORDS,
): MatchContext {
  const { startIndex, endIndexExclusive } = match.wordSpan;
  const inside = pageWords.slice(startIndex, endIndexExclusive);
  if (inside.length === 0) return { before: "", match: match.text, after: "" };
  const join = (words: ReadonlyArray<Word>): string => words.map((word) => word.text).join(" ");
  const before = join(pageWords.slice(Math.max(0, startIndex - radius), startIndex));
  const after = join(pageWords.slice(endIndexExclusive, endIndexExclusive + radius));
  return {
    before: before === "" ? "" : `${before} `,
    match: join(inside),
    after: after === "" ? "" : ` ${after}`,
  };
}

/** Qué fracción del match tiene que caer dentro de un fragmento para contar como oculto. */
export const HIDDEN_OVERLAP_RATIO = 0.5;

function intersectionArea(a: BoundingBox, b: BoundingBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function coveredBy(match: TextMatch, box: BoundingBox): boolean {
  const area = match.bbox.width * match.bbox.height;
  if (area <= 0) return false;
  return intersectionArea(match.bbox, box) / area >= HIDDEN_OVERLAP_RATIO;
}

export type MatchStatus =
  | {
      readonly kind: "hidden";
      readonly groupId: string;
      readonly type: EntityType;
      readonly indexInType: number;
    }
  | { readonly kind: "unhidden" };

/** El estado de un resultado: sobre qué grupo cae, o "Sin ocultar". */
export function resolveMatchStatus(
  match: TextMatch,
  groupsByType: ReadonlyMap<EntityType, ReadonlyArray<EntityGroup>>,
): MatchStatus {
  for (const groups of groupsByType.values()) {
    for (const group of groups) {
      for (const member of group.members) {
        if (member.pageIndex !== match.pageIndex) continue;
        const boxes = member.fragments ?? [member.bbox];
        if (boxes.some((box) => coveredBy(match, box))) {
          return {
            kind: "hidden",
            groupId: group.id,
            type: group.type,
            indexInType: group.indexInType,
          };
        }
      }
    }
  }
  return { kind: "unhidden" };
}

/** El encabezado de la lista: "N ocultos · M sin ocultar", los dos siempre presentes. */
export function summarizeMatchStatuses(statuses: ReadonlyArray<MatchStatus>): {
  readonly hidden: number;
  readonly unhidden: number;
} {
  const hidden = statuses.filter((status) => status.kind === "hidden").length;
  return { hidden, unhidden: statuses.length - hidden };
}

/** Texto del contador de la ranura fija del campo ("1 resultado", "7 resultados", vacío). */
export function describeResultCount(query: string, count: number): string {
  if (query.trim().length < 2) return "";
  return count === 1 ? "1 resultado" : `${count} resultados`;
}
