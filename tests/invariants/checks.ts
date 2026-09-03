/**
 * Invariantes del pipeline: propiedades que tienen que valer para
 * **cualquier** documento.
 *
 * **Por qué existen, y por qué son puros.** Un fixture con ground truth mide
 * un caso conocido, pero alguien tiene que escribir la verdad — y ahí se cuela
 * la suposición de quien la escribe. Un invariante no necesita ground truth:
 * afirma algo que el propio contrato del repo ya promete. Por eso **corre
 * sobre documentos reales sin que nadie lea su contenido**, que es donde esta
 * campaña encontró casi todo lo que importaba.
 *
 * Cada invariante cita el documento que lo promete. Si uno falla, o hay un
 * defecto o el documento miente; las dos cosas hay que arreglarlas.
 *
 * Las violaciones se reportan **sin contenido del documento**: tipo de
 * entidad, página, índices y medidas. Nunca el texto.
 */
import type { BoundingBox, EntityGroup, Occurrence, Page } from "@anonly/shared";

export interface Violation {
  /** Qué invariante se violó, en una línea. */
  readonly invariant: string;
  /** Dónde, sin contenido: página, tipo, índices. */
  readonly where: string;
  /** El número que lo delata. */
  readonly detail: string;
}

export interface PipelineSnapshot {
  readonly pages: ReadonlyArray<Page>;
  readonly occurrences: ReadonlyArray<Occurrence>;
  readonly groups: ReadonlyArray<EntityGroup>;
}

/** Tolerancia geométrica en puntos: por debajo es ruido de punto flotante. */
const EPSILON = 0.01;

function union(rects: ReadonlyArray<BoundingBox>): BoundingBox | undefined {
  if (rects.length === 0) return undefined;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function sameRect(a: BoundingBox, b: BoundingBox): boolean {
  return (
    Math.abs(a.x - b.x) <= EPSILON &&
    Math.abs(a.y - b.y) <= EPSILON &&
    Math.abs(a.width - b.width) <= EPSILON &&
    Math.abs(a.height - b.height) <= EPSILON
  );
}

function intersectionRatio(a: BoundingBox, b: BoundingBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return minArea === 0 ? 0 : (w * h) / minArea;
}

function rectsOf(o: {
  bbox: BoundingBox;
  fragments?: ReadonlyArray<BoundingBox>;
}): ReadonlyArray<BoundingBox> {
  return o.fragments ?? [o.bbox];
}

/**
 * ADR-074 §1, textual: *"`bbox` es la unión exacta de `fragments`, ninguno se
 * solapa verticalmente, y `union(fragments) ⊆ bbox`"*. Y: *"Cuando está
 * presente, `fragments.length ≥ 2` siempre — un array de un elemento sería la
 * envolvente escrita dos veces"*.
 */
export function checkFragments(snapshot: PipelineSnapshot): ReadonlyArray<Violation> {
  const violations: Violation[] = [];
  for (const o of snapshot.occurrences) {
    const { fragments } = o;
    if (fragments === undefined) continue;
    const where = `${o.entityType} p${o.pageIndex} ${o.source}`;

    if (fragments.length < 2) {
      violations.push({
        invariant: "fragments presente implica length >= 2 (ADR-074 §1)",
        where,
        detail: `length=${fragments.length}`,
      });
    }

    const u = union(fragments);
    if (u !== undefined && !sameRect(u, o.bbox)) {
      violations.push({
        invariant: "bbox es la unión exacta de fragments (ADR-074 §1)",
        where,
        detail: `union=${u.width.toFixed(2)}x${u.height.toFixed(2)} bbox=${o.bbox.width.toFixed(2)}x${o.bbox.height.toFixed(2)}`,
      });
    }

    for (let i = 0; i < fragments.length; i += 1) {
      for (let j = i + 1; j < fragments.length; j += 1) {
        const a = fragments[i]!;
        const b = fragments[j]!;
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapY > EPSILON) {
          violations.push({
            invariant: "los fragments no se solapan verticalmente (ADR-074 §1)",
            where,
            detail: `solape=${overlapY.toFixed(2)}pt entre ${i} y ${j}`,
          });
        }
      }
    }
  }
  return violations;
}

/**
 * ADR-028: `indexInType` es un ordinal por tipo, renumerado canónicamente por
 * primera aparición documental. Sin huecos ni repetidos.
 */
export function checkIndexInType(snapshot: PipelineSnapshot): ReadonlyArray<Violation> {
  const violations: Violation[] = [];
  const byType = new Map<string, number[]>();
  for (const g of snapshot.groups) {
    const list = byType.get(g.type);
    if (list) list.push(g.indexInType);
    else byType.set(g.type, [g.indexInType]);
  }
  for (const [type, indices] of byType) {
    const sorted = [...indices].sort((a, b) => a - b);
    const esperado = sorted.map((_, i) => i + 1);
    if (JSON.stringify(sorted) !== JSON.stringify(esperado)) {
      violations.push({
        invariant: "indexInType es 1..n sin huecos ni repetidos por tipo (ADR-028)",
        where: type,
        detail: `n=${sorted.length} obtenido=[${sorted.join(",")}]`,
      });
    }
  }
  return violations;
}

/**
 * ADR-107: el solapamiento se mide entre fragmentos. Dos grupos **habilitados**
 * no deberían solaparse por encima del umbral: si lo hacen, uno tapa lo del
 * otro y el conflicto que debería haberlo resuelto no se levantó.
 */
export function checkNoOverlapBetweenEnabledGroups(
  snapshot: PipelineSnapshot,
): ReadonlyArray<Violation> {
  const violations: Violation[] = [];
  const enabled = snapshot.groups.filter((g) => g.enabled);
  for (let i = 0; i < enabled.length; i += 1) {
    for (let j = i + 1; j < enabled.length; j += 1) {
      for (const a of enabled[i]!.members) {
        for (const b of enabled[j]!.members) {
          if (a.pageIndex !== b.pageIndex) continue;
          for (const ra of rectsOf(a)) {
            for (const rb of rectsOf(b)) {
              const ratio = intersectionRatio(ra, rb);
              if (ratio > 0.5) {
                violations.push({
                  invariant: "dos grupos habilitados no se solapan > 50 % (ADR-107)",
                  where: `${enabled[i]!.type}/${enabled[j]!.type} p${a.pageIndex}`,
                  detail: `ratio=${ratio.toFixed(2)}`,
                });
              }
            }
          }
        }
      }
    }
  }
  return violations;
}

/**
 * El valor de una ocurrencia tiene que **empezar donde empieza su primera
 * `Word`**. Si no, el mapeo span→Word está corrido y la caja se pinta sobre
 * texto que no es el detectado.
 *
 * Es el invariante que explicaría el `ORGANIZATION "fono de contacto"` visto
 * en un documento real (`NER_Engine.md` §14.1): un valor que arranca a mitad
 * de palabra.
 */
export function checkValueStartsAtWord(snapshot: PipelineSnapshot): ReadonlyArray<Violation> {
  const violations: Violation[] = [];
  for (const o of snapshot.occurrences) {
    const { wordSpan } = o;
    if (wordSpan === undefined) continue;
    const page = snapshot.pages[o.pageIndex];
    const first = page?.words[wordSpan.startIndex];
    if (first === undefined) continue;

    const primeraPalabraDelValor = o.value.trim().split(/\s+/)[0] ?? "";
    if (primeraPalabraDelValor.length === 0) continue;
    // Cualquiera de los dos puede ser prefijo del otro: el valor puede cubrir
    // parte de la palabra (un DNI pegado a un signo) o la palabra parte del
    // valor. Lo que NO puede pasar es que el valor arranque en el MEDIO.
    const encaja =
      first.text.startsWith(primeraPalabraDelValor) ||
      primeraPalabraDelValor.startsWith(first.text);
    if (!encaja) {
      violations.push({
        invariant: "el valor arranca donde arranca su primera Word (mapeo span→Word)",
        where: `${o.entityType} p${o.pageIndex} ${o.source}`,
        detail: `word=${first.text.length}ch valor=${primeraPalabraDelValor.length}ch`,
      });
    }
  }
  return violations;
}

/** Corre todos los invariantes y devuelve las violaciones juntas. */
export function checkAll(snapshot: PipelineSnapshot): ReadonlyArray<Violation> {
  return [
    ...checkFragments(snapshot),
    ...checkIndexInType(snapshot),
    ...checkNoOverlapBetweenEnabledGroups(snapshot),
    ...checkValueStartsAtWord(snapshot),
  ];
}
