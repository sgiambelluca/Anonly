/**
 * Marcado de los corpus sintéticos. Un documento se escribe como texto con
 * marcas en línea, y de ahí salen el texto plano y las anotaciones de verdad.
 *
 *   p(tipo, forma, rótulo, texto, clave?)  entidad de un formato nuevo (verdad)
 *   u(tipo, rótulo, texto)                 entidad de un formato universal (verdad)
 *   n(clase, texto)                        negativo: algo que NO es una entidad
 *
 * El texto de página del Core es las palabras unidas con un espacio (sin saltos
 * de línea), así que los saltos de línea del fuente se vuelven espacios.
 */

import type { CorpusDoc, CorpusSource, Negative, Rendering, Truth } from "./types.js";

export const p = (type: string, form: string, shape: string, text: string, key?: string): string =>
  `{{P|${type}|${form}|${shape}|${key ?? text.toUpperCase().replace(/[^A-Z0-9]/g, "")}|${text}}}`;

export const u = (type: string, shape: string, text: string): string =>
  `{{U|${type}|${shape}|${text}}}`;

export const n = (kind: string, text: string): string => `{{N|${kind}|${text}}}`;

type Segment =
  | { readonly t: "plain"; readonly text: string }
  | { readonly t: "P"; readonly f: ReadonlyArray<string> }
  | { readonly t: "U"; readonly f: ReadonlyArray<string> }
  | { readonly t: "N"; readonly f: ReadonlyArray<string> };

const MARK_RE = /\{\{([PUN])\|([^}]*)\}\}/g;

function segmentsOf(source: string): Segment[] {
  const flat = source.replace(/\s*\n\s*/g, " ").trim();
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = MARK_RE.exec(flat)) !== null) {
    if (m.index > last) out.push({ t: "plain", text: flat.slice(last, m.index) });
    const kind = m[1] as "P" | "U" | "N";
    out.push({ t: kind, f: (m[2] ?? "").split("|") });
    last = m.index + m[0].length;
  }
  if (last < flat.length) out.push({ t: "plain", text: flat.slice(last) });
  return out;
}

export function renderDoc(src: CorpusSource, country: string, rendering: Rendering): CorpusDoc {
  let text = "";
  const truths: Truth[] = [];
  const negs: Negative[] = [];
  const ctx = (s: string): string =>
    rendering === "mayus" ? s.toUpperCase() : rendering === "minus" ? s.toLowerCase() : s;
  const ent = (s: string): string => (rendering === "mayus" ? s.toUpperCase() : s);

  for (const seg of segmentsOf(src.source)) {
    if (seg.t === "plain") {
      text += ctx(seg.text);
      continue;
    }
    const start = text.length;
    if (seg.t === "P") {
      const [type = "", form = "", shape = "", key = "", raw = ""] = seg.f;
      const shown = ent(raw);
      text += shown;
      truths.push({
        kind: "P",
        entityType: type,
        form,
        shape,
        key,
        start,
        end: start + shown.length,
        text: shown,
      });
    } else if (seg.t === "U") {
      const [type = "", shape = "", raw = ""] = seg.f;
      const shown = ent(raw);
      text += shown;
      truths.push({
        kind: "U",
        entityType: type,
        form: "universal",
        shape,
        key: shown,
        start,
        end: start + shown.length,
        text: shown,
      });
    } else {
      const [kind = "", raw = ""] = seg.f;
      // En la versión en minúsculas, los negativos (palabras y números) también van en minúscula.
      const shown = rendering === "minus" ? raw.toLowerCase() : ent(raw);
      text += shown;
      negs.push({ kind, start, end: start + shown.length, text: shown });
    }
  }

  const suffix = rendering === "normal" ? "" : `-${rendering}`;
  return {
    id: `${src.id}${suffix}`,
    country,
    rendering,
    added: src.added === true,
    text,
    truths,
    negs,
  };
}

export function renderCorpus(country: string, sources: ReadonlyArray<CorpusSource>): CorpusDoc[] {
  const docs: CorpusDoc[] = [];
  for (const src of sources) {
    docs.push(renderDoc(src, country, "normal"));
    for (const r of src.renderings ?? []) docs.push(renderDoc(src, country, r));
  }
  return docs;
}
