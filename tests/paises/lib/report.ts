/**
 * Arma las tablas de la medición de la tanda 1 (markdown + JSON). Ver
 * `medicion.spec.ts` para cómo se corre.
 */

import { DEFAULT_PATTERNS_AR } from "../../../packages/anonymization-core/regex-engine/src/patterns/default-ar.js";
import { AR_SOURCES } from "../corpus/ar.js";
import { BO_SOURCES } from "../corpus/bo.js";
import { CL_SOURCES } from "../corpus/cl.js";
import { PY_SOURCES } from "../corpus/py.js";
import { UY_SOURCES } from "../corpus/uy.js";

import { renderCorpus } from "./dsl.js";
import { fromArPattern, runFormats } from "./engine.js";
import { REPORT_EXAMPLES } from "./examples.js";
import { loadArFixtures } from "./fixtures-ar.js";
import { allCountryFormats, normalizeBoCiNumberOnly } from "./formats.js";
import {
  evaluate,
  expectedFor,
  hitCounts,
  pct,
  tally,
  type ClassifiedHit,
  type TruthResult,
} from "./measure.js";
import type { CorpusDoc, ProtoFormat } from "./types.js";

const COUNTRIES = ["CL", "UY", "PY", "BO", "AR"] as const;
type Country = (typeof COUNTRIES)[number];

const UNIVERSAL_IDS = new Set([
  "email",
  "iban",
  "credit-card",
  "date-ar",
  "date-textual-ar",
  "caratula-ar",
  "address-keyword-ar",
]);

const md = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string => {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `|${headers.map(() => "---").join("|")}|`;
  // Primero la barra invertida y después la vertical: si no, un `\` del dato
  // (los patrones traen `\d`, `\s`) se come el escape de la `|` que le sigue.
  const cell = (c: string | number): string =>
    String(c).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const body = rows.map((r) => `| ${r.map(cell).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
};

const isCountryForm = (id: string): boolean => id.includes(":");
const short = (s: string, max = 60): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const q = (s: string): string => `«${short(s)}»`;

/** Un match por (forma, valor, clase): los textos repetidos de las copias no se listan dos veces. */
function uniqueHits(hits: ReadonlyArray<ClassifiedHit>): ClassifiedHit[] {
  const seen = new Set<string>();
  const out: ClassifiedHit[] = [];
  for (const h of hits) {
    const k = `${h.hit.formId}|${h.hit.value}|${h.kind}|${h.truth?.text ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

function countBy<T>(items: ReadonlyArray<T>, key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return m;
}

/** PRNG determinista (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Report {
  readonly markdown: string;
  readonly json: Record<string, unknown>;
}

export function buildReport(): Report {
  const forms = allCountryFormats();
  const corpora: Record<Country, CorpusDoc[]> = {
    CL: renderCorpus("CL", CL_SOURCES),
    UY: renderCorpus("UY", UY_SOURCES),
    PY: renderCorpus("PY", PY_SOURCES),
    BO: renderCorpus("BO", BO_SOURCES),
    AR: renderCorpus("AR", AR_SOURCES),
  };
  const arCatalog = DEFAULT_PATTERNS_AR.map((p) => fromArPattern(p));
  const universals = arCatalog.filter((f) => UNIVERSAL_IDS.has(f.id));
  const json: Record<string, unknown> = {};
  const out: string[] = [];
  const push = (s: string): void => {
    out.push(s, "");
  };

  // ───────────────────────── 1. Tamaño del corpus ─────────────────────────
  push("## 1. Tamaño del corpus");
  const sizeRows: Array<Array<string | number>> = [];
  const formCountRows: Array<Array<string | number>> = [];
  const negRows: Array<Array<string | number>> = [];
  const uniRows: Array<Array<string | number>> = [];
  for (const c of COUNTRIES) {
    const docs = corpora[c];
    const normal = docs.filter((d) => d.rendering === "normal");
    const pAll = docs.flatMap((d) => d.truths.filter((t) => t.kind === "P"));
    const pNormal = normal.flatMap((d) => d.truths.filter((t) => t.kind === "P"));
    const negAll = docs.flatMap((d) => d.negs);
    const negNormal = normal.flatMap((d) => d.negs);
    const uNormal = normal.flatMap((d) => d.truths.filter((t) => t.kind === "U"));
    sizeRows.push([
      c,
      normal.length,
      docs.filter((d) => d.rendering === "mayus").length,
      docs.filter((d) => d.rendering === "minus").length,
      docs.reduce((a, d) => a + d.text.length, 0),
      pNormal.length,
      pAll.length,
      negNormal.length,
      negAll.length,
      uNormal.length,
    ]);
    const byFormNormal = countBy(pNormal, (t) => t.form);
    const byFormAll = countBy(pAll, (t) => t.form);
    for (const [form, count] of [...byFormAll.entries()].sort()) {
      const type = pAll.find((t) => t.form === form)?.entityType ?? "";
      formCountRows.push([c, form, type, byFormNormal.get(form) ?? 0, count]);
    }
    const negKinds = countBy(negNormal, (nn) => nn.kind);
    negRows.push([
      c,
      [...negKinds.entries()]
        .sort()
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    ]);
    const uKinds = countBy(uNormal, (t) => t.entityType);
    uniRows.push([
      c,
      [...uKinds.entries()]
        .sort()
        .map(([k, v]) => `${k}: ${v}`)
        .join("; "),
    ]);
  }
  push(
    md(
      [
        "País",
        "Docs normal",
        "Docs MAYÚS",
        "Docs minús",
        "Caracteres",
        "Entidades P (normal)",
        "Entidades P (total)",
        "Negativos (normal)",
        "Negativos (total)",
        "Universales U (normal)",
      ],
      sizeRows,
    ),
  );
  push(
    "«Normal» son los documentos escritos; «MAYÚS» son copias de algunos pasadas a mayúsculas (todo el texto y las entidades); «minús» son copias con el texto de contexto en minúsculas (las entidades quedan como están, los negativos van en minúscula). Las copias repiten las mismas entidades, por eso se cuenta aparte lo «normal».",
  );
  push("Entidades por forma (P):");
  push(md(["País", "Forma", "Tipo", "Normal", "Total"], formCountRows));
  push("Negativos por clase (corpus normal):");
  push(md(["País", "Clases"], negRows));
  push("Universales anotados (verdad U, corpus normal):");
  push(md(["País", "Tipos"], uniRows));
  push("### Casos sumados al corpus en la segunda medición");
  push(
    "Documentos nuevos (los anteriores no se tocaron, salvo la etiqueta de forma de las verdades cuyo formato cambió de nombre o dejó de existir: ver la cabecera). Entidades y negativos que traen:",
  );
  const addedRows: Array<Array<string | number>> = [];
  for (const c of COUNTRIES) {
    for (const doc of corpora[c].filter((x) => x.added && x.rendering === "normal")) {
      const ps = countBy(
        doc.truths.filter((t) => t.kind === "P"),
        (t) => t.form,
      );
      const ns = countBy(doc.negs, (nn) => nn.kind);
      const fmt = (m: Map<string, number>): string =>
        [...m.entries()]
          .sort()
          .map(([k, v]) => `${k} ×${v}`)
          .join("; ");
      addedRows.push([c, doc.id, fmt(ps), fmt(ns)]);
    }
  }
  push(md(["País", "Documento", "Entidades (forma ×N)", "Negativos (clase ×N)"], addedRows));

  // ───────────────────────── 2. Ejemplos del informe ─────────────────────────
  push("## 2. Los ejemplos del informe contra los prototipos");
  push(
    "Cada «Detectar» y «No detectar» de `Paises_Tanda1_Investigacion_2026-11-22.md`, corridos tal cual contra su prototipo (solo esas formas, con guarda de corrida). Un desacuerdo es una duda, no un fallo: puede ser un error del informe, uno del prototipo o una decisión posterior del Plan §5.",
  );
  const allForms = new Map<string, ProtoFormat>();
  for (const c of COUNTRIES) for (const f of forms[c] ?? []) allForms.set(f.id, f);
  const exRows: Array<Array<string | number>> = [];
  const exIssues: string[] = [];
  const exJson: unknown[] = [];
  for (const fam of REPORT_EXAMPLES) {
    const fs = fam.forms
      .map((id) => allForms.get(id))
      .filter((f): f is ProtoFormat => f !== undefined);
    let yesOk = 0;
    let noOk = 0;
    for (const ex of fam.yes) {
      const [text, expected] = typeof ex === "string" ? [ex, ex] : ex;
      const hits = runFormats(fs, text);
      const ok = hits.some((h) => h.value === expected);
      if (ok) yesOk += 1;
      else
        exIssues.push(
          `- \`${fam.family}\`, debería detectar ${q(text)}: ${hits.length === 0 ? "no detecta nada" : `detecta ${hits.map((h) => q(h.value)).join(", ")}`}.`,
        );
    }
    for (const text of fam.no) {
      const hits = runFormats(fs, text);
      if (hits.length === 0) noOk += 1;
      else
        exIssues.push(
          `- \`${fam.family}\`, NO debería detectar ${q(text)}: detecta ${hits.map((h) => `${q(h.value)} (${h.formId})`).join(", ")}.`,
        );
    }
    exRows.push([fam.family, fam.source, `${yesOk}/${fam.yes.length}`, `${noOk}/${fam.no.length}`]);
    exJson.push({ family: fam.family, yesOk, yes: fam.yes.length, noOk, no: fam.no.length });
  }
  push(
    md(
      [
        "Familia de formas",
        "Informe",
        "Detecta (de los «detectar»)",
        "No detecta (de los «no detectar»)",
      ],
      exRows,
    ),
  );
  push("Desacuerdos:");
  push(exIssues.length === 0 ? "(ninguno)" : exIssues.join("\n"));
  json["examples"] = exJson;

  // ───────────────────────── 3. Medición por forma ─────────────────────────
  push("## 3. Medición por forma");
  push(
    "**Método.** Cada forma se corre **sola** (con la guarda de corrida de ADR-075 §2 y el control propio) sobre todos los documentos de su país, y se compara con la verdad anotada. *Esperadas* = entidades P cuya forma es esa (o la que esa forma reemplaza). *Exactas* = el match tiene el mismo tramo y el mismo tipo que la verdad. *Parcial* = solapa una verdad del mismo tipo con otro tramo. *Otro tipo* = solapa una verdad de otro tipo. *FP negativo* = el match cae sobre un negativo anotado; *FP texto* = cae en texto corriente sin verdad ni negativo. *Solapa* = match parcial o de otro tipo sobre una verdad.",
  );
  const standaloneJson: unknown[] = [];
  for (const c of COUNTRIES) {
    const docs = corpora[c];
    push(`### ${c}`);
    const rows: Array<Array<string | number>> = [];
    const shapeRows: Array<Array<string | number>> = [];
    for (const f of forms[c] ?? []) {
      const res = evaluate([f], docs);
      const exp = expectedFor(f, res.truths);
      const tl = tally(exp);
      const hc = hitCounts(res.hits);
      const byRend = (r: string): string => {
        const sub = exp.filter((e) => e.doc.rendering === r);
        return sub.length === 0
          ? "-"
          : `${sub.filter((e) => e.status === "exact").length}/${sub.length}`;
      };
      const tpOther = res.hits.filter(
        (h) =>
          h.kind === "tp" &&
          h.truth !== null &&
          h.truth.form !== f.id &&
          h.truth.form !== (f.replaces ?? ""),
      ).length;
      const hcNormal = hitCounts(res.hits.filter((h) => h.doc.rendering === "normal"));
      // Lo mismo sobre el corpus anterior (sin los documentos sumados en la segunda medición).
      const docsOld = docs.filter((d) => !d.added);
      const resOld = evaluate([f], docsOld);
      const tlOld = tally(expectedFor(f, resOld.truths));
      const hcOldNormal = hitCounts(resOld.hits.filter((h) => h.doc.rendering === "normal"));
      const negOldNormal = docsOld
        .filter((d) => d.rendering === "normal")
        .reduce((a, d) => a + d.negs.length, 0);
      const negNormal = corpora[c]
        .filter((d) => d.rendering === "normal")
        .reduce((a, d) => a + d.negs.length, 0);
      rows.push([
        `\`${f.id}\``,
        f.entityType,
        f.cls,
        f.optional
          ? f.replaces === undefined
            ? "opcional"
            : `alternativa de \`${f.replaces}\``
          : "núcleo",
        tl.expected,
        tl.exact,
        pct(tl.exact, tl.expected),
        tl.partial,
        tl.other,
        tl.miss,
        hc["fp-neg"] + hc["fp-text"],
        `${hcNormal["fp-neg"] + hcNormal["fp-text"]} de ${negNormal}`,
        hc.partial + hc.other,
        tpOther,
        byRend("normal"),
        byRend("mayus"),
        byRend("minus"),
      ]);
      standaloneJson.push({
        country: c,
        form: f.id,
        type: f.entityType,
        optional: f.optional,
        replaces: f.replaces ?? null,
        expected: tl.expected,
        exact: tl.exact,
        partial: tl.partial,
        other: tl.other,
        miss: tl.miss,
        fpNeg: hc["fp-neg"],
        fpText: hc["fp-text"],
        fpNormalOnly: hcNormal["fp-neg"] + hcNormal["fp-text"],
        negativesNormal: negNormal,
        oldExpected: tlOld.expected,
        oldExact: tlOld.exact,
        oldFpNormalOnly: hcOldNormal["fp-neg"] + hcOldNormal["fp-text"],
        oldNegativesNormal: negOldNormal,
        recallPct: tl.expected === 0 ? null : Math.round((1000 * tl.exact) / tl.expected) / 10,
      });
      // Detalle por rótulo de escritura.
      const shapes = countBy(exp, (e) => e.truth.shape);
      for (const [shape, n] of [...shapes.entries()].sort()) {
        const ok = exp.filter((e) => e.truth.shape === shape && e.status === "exact").length;
        const other = exp.filter(
          (e) => e.truth.shape === shape && e.status !== "exact" && e.status !== "miss",
        ).length;
        shapeRows.push([`\`${f.id}\``, shape, n, ok, other, n - ok - other]);
      }
    }
    push(
      md(
        [
          "Forma",
          "Tipo",
          "Clase",
          "Rol",
          "Esperadas",
          "Exactas",
          "Recall",
          "Parcial",
          "Otro tipo",
          "Perdidas",
          "FP (todas las copias)",
          "FP (corpus normal) de negativos",
          "Solapa",
          "TP de otra forma",
          "Exactas normal",
          "Exactas MAYÚS",
          "Exactas minús",
        ],
        rows,
      ),
    );
    push(
      "Por forma de escribir el dato (rótulo `shape`; Exactas / Parcial u otro tipo / Perdidas):",
    );
    push(md(["Forma", "Escritura", "N", "Exactas", "Parcial u otro tipo", "Perdidas"], shapeRows));
  }
  json["standalone"] = standaloneJson;
  const summaryRows = (
    standaloneJson as Array<{
      country: string;
      form: string;
      type: string;
      optional: boolean;
      replaces: string | null;
      expected: number;
      exact: number;
      miss: number;
      fpNeg: number;
      fpText: number;
      fpNormalOnly: number;
      negativesNormal: number;
      oldExpected: number;
      oldExact: number;
      oldFpNormalOnly: number;
      oldNegativesNormal: number;
    }>
  ).map((s) => [
    s.country,
    `\`${s.form}\``,
    s.type,
    s.optional ? (s.replaces === null ? "opcional" : "alternativa") : "núcleo",
    s.expected,
    s.exact,
    pct(s.exact, s.expected),
    `${s.fpNormalOnly} de ${s.negativesNormal}`,
    s.fpNeg + s.fpText,
    s.oldExpected === 0
      ? "n/a"
      : `${s.oldExact}/${s.oldExpected} (${pct(s.oldExact, s.oldExpected)})`,
    `${s.oldFpNormalOnly} de ${s.oldNegativesNormal}`,
  ]);
  const summaryMd = [
    "## 0. Resumen por forma",
    "",
    "Cada forma corrida sola sobre el corpus de su país (detalle en §3). *Rol*: «núcleo» = lo que el Plan §5 manda llevar a la tanda; «opcional» = el Plan todavía no lo decide; «alternativa» = reemplaza a otra forma. *Recall* = exactas / esperadas, sobre todas las copias del corpus (normal, MAYÚS, minús), con los casos sumados en la segunda medición. *Corpus anterior* = lo mismo sin los documentos sumados (comparable con la primera medición, salvo el relleno de las etiquetas de forma). *FP corpus normal* = matches de la forma en los documentos normales que no son una entidad (caen sobre un negativo anotado o en texto corriente), de cuántos negativos anotados hay. *FP todas* = lo mismo sobre todas las copias (las copias en mayúsculas repiten los negativos).",
    "",
    md(
      [
        "País",
        "Forma",
        "Tipo",
        "Rol",
        "Esperadas",
        "Exactas",
        "Recall",
        "FP corpus normal",
        "FP todas",
        "Recall (corpus anterior)",
        "FP normal (corpus anterior)",
      ],
      summaryRows,
    ),
    "",
  ].join("\n");

  // ───────────────────────── 3b. Verdades sin forma ─────────────────────────
  push("## 3b. Verdades cuya forma ya no existe (decisiones del mantenedor)");
  push(
    "Las formas `*-pegado` (teléfonos de 8 dígitos sin separadores de UY y BO) y el complemento de la CI boliviana no entran (Plan §5). Las verdades del corpus que las escribían **se quedan** y se miden contra las formas que sí entran: lo que tapan por casualidad y lo que dejan a la vista.",
  );
  const orphanRows: Array<Array<string | number>> = [];
  const orphanJson: unknown[] = [];
  for (const c of COUNTRIES) {
    // Las verdades del catálogo argentino (`ar:dni-ar`, etc.) no tienen formato nuevo: no son huérfanas.
    const ids = new Set([
      ...(forms[c] ?? []).map((f) => f.id),
      ...arCatalog.map((f) => `ar:${f.id}`),
    ]);
    const res = evaluate(forms[c] ?? [], corpora[c]);
    const orphans = res.truths.filter((r) => r.truth.kind === "P" && !ids.has(r.truth.form));
    for (const [form, count] of [...countBy(orphans, (r) => r.truth.form).entries()].sort()) {
      const rs = orphans.filter((r) => r.truth.form === form);
      const tl = tally(rs);
      const uniq = [...new Set(rs.map((r) => r.truth.text))].slice(0, 3);
      orphanRows.push([
        c,
        `\`${form}\``,
        count,
        tl.exact,
        tl.partial + tl.other,
        tl.miss,
        uniq.map((x) => q(x)).join(", "),
      ]);
      orphanJson.push({
        country: c,
        form,
        n: count,
        exact: tl.exact,
        partialOrOther: tl.partial + tl.other,
        miss: tl.miss,
      });
    }
  }
  push(
    md(
      [
        "País",
        "Forma (sin formato)",
        "N",
        "Tapadas enteras",
        "Parcial u otro tipo",
        "A la vista",
        "Ejemplos",
      ],
      orphanRows,
    ),
  );
  json["orphanTruths"] = orphanJson;

  // ───────────────────────── 4. Combinaciones ─────────────────────────
  push("## 4. Combinaciones: núcleo, núcleo más cada forma opcional, completo");
  push(
    "País activo = las formas del país más los universales (email, IBAN, tarjeta, fecha, fecha en texto, carátula, dirección), con control, guarda y prioridad del match más largo entre formatos base (caso 10). *Núcleo* = las formas no opcionales. *Alcance* = las verdades cuya forma está en la combinación. FP país / FP universal se separan por el origen del match. Δ = cambio contra el núcleo (exactas y FP del país). La fila «en lugar de» reemplaza la forma que dice la alternativa.",
  );
  const configJson: unknown[] = [];
  for (const c of COUNTRIES) {
    const fs = forms[c] ?? [];
    const nucleo = fs.filter((f) => !f.optional);
    const opt = fs.filter((f) => f.optional);
    const extra = opt.filter((f) => f.replaces === undefined);
    const alts = opt.filter((f) => f.replaces !== undefined);
    interface Cfg {
      readonly name: string;
      readonly formsList: ProtoFormat[];
      readonly scope: Set<string>;
    }
    const cfgs: Cfg[] = [];
    const mk = (name: string, list: ProtoFormat[], extraScope: string[] = []): Cfg => ({
      name,
      formsList: list,
      scope: new Set([...list.map((f) => f.id), ...extraScope]),
    });
    cfgs.push(mk("núcleo", nucleo));
    for (const x of extra) cfgs.push(mk(`núcleo + \`${x.id}\``, [...nucleo, x]));
    for (const a of alts) {
      const r = a.replaces ?? "";
      const inNucleo = nucleo.some((f) => f.id === r);
      const list = inNucleo ? [...nucleo.filter((f) => f.id !== r), a] : [...nucleo, a];
      cfgs.push(mk(`núcleo con \`${a.id}\` en lugar de \`${r}\``, list, [r]));
    }
    cfgs.push(
      mk("completo (núcleo + todas las opcionales, sin alternativas)", [...nucleo, ...extra]),
    );
    push(`### ${c}`);
    const base = evaluate([...nucleo, ...universals], corpora[c]);
    const baseExact = base.truths.filter(
      (r) =>
        r.truth.kind === "P" &&
        r.status === "exact" &&
        new Set(nucleo.map((f) => f.id)).has(r.truth.form),
    ).length;
    const baseFp = base.hits.filter(
      (h) => isCountryForm(h.hit.formId) && (h.kind === "fp-neg" || h.kind === "fp-text"),
    ).length;
    const rows: Array<Array<string | number>> = [];
    for (const cfg of cfgs) {
      const res = evaluate([...cfg.formsList, ...universals], corpora[c]);
      const inScope = res.truths.filter((r) => r.truth.kind === "P" && cfg.scope.has(r.truth.form));
      const outScope = res.truths.filter(
        (r) => r.truth.kind === "P" && !cfg.scope.has(r.truth.form),
      );
      const tl = tally(inScope);
      const country = res.hits.filter((h) => isCountryForm(h.hit.formId));
      const uni = res.hits.filter((h) => !isCountryForm(h.hit.formId));
      const fpC = (k: string): number => country.filter((h) => h.kind === k).length;
      const fpU = (k: string): number => uni.filter((h) => h.kind === k).length;
      const solapa = res.hits.filter((h) => h.kind === "partial" || h.kind === "other").length;
      rows.push([
        cfg.name,
        tl.expected,
        tl.exact,
        pct(tl.exact, tl.expected),
        tl.partial + tl.other,
        tl.miss,
        fpC("fp-neg"),
        fpC("fp-text"),
        fpU("fp-neg"),
        fpU("fp-text"),
        solapa,
        `${outScope.filter((r) => r.status === "exact").length}/${outScope.length}`,
        `${tl.exact - baseExact >= 0 ? "+" : ""}${tl.exact - baseExact}`,
        `${fpC("fp-neg") + fpC("fp-text") - baseFp >= 0 ? "+" : ""}${fpC("fp-neg") + fpC("fp-text") - baseFp}`,
      ]);
      configJson.push({
        country: c,
        config: cfg.name,
        inScope: tl.expected,
        exact: tl.exact,
        partialOrOther: tl.partial + tl.other,
        miss: tl.miss,
        fpCountryNeg: fpC("fp-neg"),
        fpCountryText: fpC("fp-text"),
        fpUniversalNeg: fpU("fp-neg"),
        fpUniversalText: fpU("fp-text"),
        overlapHits: solapa,
      });
    }
    push(
      md(
        [
          "Combinación",
          "En alcance",
          "Exactas",
          "Recall",
          "Parcial u otro tipo",
          "Perdidas",
          "FP país neg.",
          "FP país texto",
          "FP univ. neg.",
          "FP univ. texto",
          "Matches que solapan una verdad sin acertar",
          "Fuera de alcance (exactas/total)",
          "Δ exactas",
          "Δ FP país",
        ],
        rows,
      ),
    );
    const compRes = evaluate([...nucleo, ...extra, ...universals], corpora[c]);
    const overl = uniqueHits(
      compRes.hits.filter(
        (h) => (h.kind === "partial" || h.kind === "other") && h.doc.rendering === "normal",
      ),
    );
    const fpList = uniqueHits(
      compRes.hits.filter(
        (h) => (h.kind === "fp-neg" || h.kind === "fp-text") && h.doc.rendering === "normal",
      ),
    );
    push(
      `Con «completo»: matches que solapan una verdad sin acertarla (corpus normal): ${overl.length === 0 ? "ninguno" : overl.map((h) => `\`${h.hit.formId}\` ${q(h.hit.value)} sobre ${q(h.truth?.text ?? "")} (${h.truth?.form ?? ""})`).join("; ")}.`,
    );
    push(
      `Con «completo»: falsos positivos (corpus normal, sin repetir): ${fpList.length === 0 ? "ninguno" : fpList.map((h) => `\`${h.hit.formId}\` ${q(h.hit.value)}${h.kind === "fp-text" ? " (texto)" : ""}`).join("; ")}.`,
    );
    // Pérdidas con «completo», con su texto.
    const completoScope = new Set([...nucleo, ...extra].map((f) => f.id));
    const lost = compRes.truths.filter(
      (r) =>
        r.truth.kind === "P" &&
        completoScope.has(r.truth.form) &&
        r.status !== "exact" &&
        r.doc.rendering === "normal",
    );
    push(
      `Con «completo»: entidades P que no se tapan enteras (corpus normal): ${lost.length === 0 ? "ninguna" : lost.map((r) => `${q(r.truth.text)} (${r.truth.form}, ${r.truth.shape}; ${r.status === "miss" ? "nada" : `${q(r.hit?.value ?? "")} de \`${r.byForm ?? ""}\``})`).join("; ")}.`,
    );
  }
  json["configs"] = configJson;

  // ───────────────────────── 5. Choques con el catálogo argentino ─────────────────────────
  push("## 5. Choques");
  push("### 5.1 El catálogo argentino vigente (AR activo) sobre cada corpus");
  push(
    "Se corren los quince patrones de `DEFAULT_PATTERNS_AR` (`BASE_CATALOG` del motor) tal como están, con su checksum, la guarda de corrida y el match más largo. Lo que importa: qué tapa AR de los datos del país (y si lo tapa entero), y qué tapa de más.",
  );
  const arChoqueJson: unknown[] = [];
  const sampleLimit = 14;
  for (const c of COUNTRIES) {
    const docs = corpora[c];
    const res = evaluate(arCatalog, docs);
    push(`#### AR activo sobre el corpus de ${c}`);
    // Por forma esperada: qué hace AR.
    const pTruths = res.truths.filter((r) => r.truth.kind === "P");
    const byForm = new Map<string, TruthResult[]>();
    for (const r of pTruths) byForm.set(r.truth.form, [...(byForm.get(r.truth.form) ?? []), r]);
    const rows: Array<Array<string | number>> = [];
    for (const [form, list] of [...byForm.entries()].sort()) {
      const tl = tally(list);
      const patterns = countBy(
        list.filter((r) => r.byForm !== null),
        (r) => r.byForm ?? "",
      );
      rows.push([
        `\`${form}\``,
        tl.expected,
        tl.exact,
        tl.partial,
        tl.other,
        tl.miss,
        [...patterns.entries()]
          .sort()
          .map(([k, v]) => `${k}: ${v}`)
          .join("; "),
      ]);
      arChoqueJson.push({
        corpus: c,
        form,
        expected: tl.expected,
        exact: tl.exact,
        partial: tl.partial,
        other: tl.other,
        miss: tl.miss,
      });
    }
    push(
      "Por forma de la verdad (qué hace AR con ella). *Exactas* = AR emite el mismo tipo y el mismo tramo (la tapa entera); *Parcial* = mismo tipo, otro tramo; *Otro tipo* = solapa con otro tipo; *Perdidas* = AR no emite nada ahí.",
    );
    push(
      md(
        [
          "Forma de la verdad",
          "N",
          "AR exacta",
          "AR parcial",
          "AR otro tipo",
          "AR no emite",
          "Patrones AR que intervienen",
        ],
        rows,
      ),
    );
    // Por patrón AR: qué emite.
    const byPattern = new Map<string, ClassifiedHit[]>();
    for (const h of res.hits)
      byPattern.set(h.hit.formId, [...(byPattern.get(h.hit.formId) ?? []), h]);
    const prow: Array<Array<string | number>> = [];
    for (const [id, hs] of [...byPattern.entries()].sort()) {
      const hc = hitCounts(hs);
      prow.push([`\`${id}\``, hs.length, hc.tp, hc.partial, hc.other, hc["fp-neg"], hc["fp-text"]]);
    }
    push("Por patrón AR (todo lo que emite sobre este corpus; TP = acierta una verdad P o U):");
    push(
      md(
        ["Patrón AR", "Emite", "TP exacto", "Parcial", "Otro tipo", "FP negativo", "FP texto"],
        prow,
      ),
    );
    // Muestras de lo que no es TP.
    const interesting = uniqueHits(
      res.hits.filter((h) => h.kind !== "tp" && h.doc.rendering === "normal"),
    );
    const samples = interesting.slice(0, sampleLimit).map((h) => {
      const t = h.truth === null ? "sin verdad" : `verdad ${q(h.truth.text)} (${h.truth.form})`;
      return `- \`${h.hit.formId}\` emite ${q(h.hit.value)} → ${h.kind}; ${t}.`;
    });
    push(
      `Muestra de matches AR que no aciertan una verdad (corpus normal, sin repetir: ${interesting.length}; se listan ${samples.length}):`,
    );
    push(samples.length === 0 ? "(ninguno)" : samples.join("\n"));
  }
  json["arCatalogOnCorpora"] = arChoqueJson;

  push("### 5.2 Las formas nuevas sobre textos argentinos de las fixtures del repo");
  const fx = loadArFixtures();
  push(
    `Textos usados (todos sintéticos, ya en el repo): el **dataset de referencia** de \`tests/fixtures/generate.ts\` (\`buildReferenceDocSpecs()\`: ${fx.referenceDocs} documentos, ${fx.referencePages} páginas, con sus entidades anotadas: DNI, CUIT, teléfono, email, patente, matrícula, persona, dirección) y las ${fx.text10pPages} páginas de \`TEXT_10P_PAGES\` (sin anotar: todo match es un hallazgo a mirar). Total: ${fx.docs.length} páginas, ${fx.docs.reduce((a, d) => a + d.text.length, 0)} caracteres.`,
  );
  const fixRows: Array<Array<string | number>> = [];
  const fixSamples: string[] = [];
  const fixJson: unknown[] = [];
  const nonAlt = (list: ProtoFormat[]): ProtoFormat[] =>
    list.filter((f) => f.replaces === undefined);
  for (const c of COUNTRIES) {
    for (const f of nonAlt(forms[c] ?? [])) {
      const res = evaluate([f], fx.docs);
      const hc = hitCounts(res.hits);
      const total = res.hits.length;
      fixRows.push([
        `\`${f.id}\``,
        f.optional ? "opcional" : "núcleo",
        total,
        hc.partial + hc.other,
        hc["fp-text"],
      ]);
      fixJson.push({
        form: f.id,
        hits: total,
        overlapTruth: hc.partial + hc.other,
        fpText: hc["fp-text"],
      });
      for (const h of uniqueHits(res.hits).slice(0, 3)) {
        const t =
          h.truth === null ? "sin verdad" : `solapa ${q(h.truth.text)} (${h.truth.entityType})`;
        fixSamples.push(`- \`${f.id}\` emite ${q(h.hit.value)} en \`${h.doc.id}\`: ${t}.`);
      }
    }
  }
  push(
    "Cada forma corrida sola sobre esos textos (se excluyen las alternativas, que repiten a otra forma):",
  );
  push(md(["Forma", "Rol", "Matches", "Solapan una verdad AR", "En texto sin verdad"], fixRows));
  push("Muestras (hasta 3 por forma):");
  push(
    fixSamples.length === 0
      ? "(ninguna: ninguna forma nueva emite nada sobre los textos argentinos)"
      : fixSamples.join("\n"),
  );
  json["newFormsOnArFixtures"] = fixJson;
  const unionAll = COUNTRIES.flatMap((c) => nonAlt(forms[c] ?? []));
  const unionRes = evaluate(unionAll, fx.docs);
  const unionHc = hitCounts(unionRes.hits);
  push(
    `Todas las formas nuevas juntas (${unionAll.length} formas, con prioridad del match más largo): ${unionRes.hits.length} matches; ${unionHc.partial + unionHc.other} solapan una verdad argentina; ${unionHc["fp-text"]} caen en texto sin verdad.`,
  );
  json["newFormsUnionOnArFixtures"] = {
    forms: unionAll.length,
    hits: unionRes.hits.length,
    ...unionHc,
  };

  push("### 5.3 Las formas nuevas de AR (CBU/CVU y pasaporte) junto al catálogo argentino");
  const arDocs = corpora.AR;
  const arNew = forms.AR ?? [];
  const both = evaluate([...arNew, ...arCatalog], arDocs);
  const onlyNew = evaluate(arNew, arDocs);
  const rowsAr: Array<Array<string | number>> = [];
  for (const f of arNew) {
    const a = tally(expectedFor(f, onlyNew.truths));
    const b = tally(expectedFor(f, both.truths));
    rowsAr.push([
      `\`${f.id}\``,
      a.expected,
      `${a.exact} (${pct(a.exact, a.expected)})`,
      `${b.exact} (${pct(b.exact, b.expected)})`,
      b.partial,
      b.other,
      b.miss,
    ]);
  }
  push(
    "Con AR activo, las formas nuevas se suman al catálogo. Recall de cada forma sola y con el catálogo argentino al lado (prioridad del match más largo, caso 10):",
  );
  push(
    md(
      [
        "Forma",
        "Esperadas",
        "Exactas (sola)",
        "Exactas (con catálogo AR)",
        "Parcial",
        "Otro tipo",
        "Perdidas",
      ],
      rowsAr,
    ),
  );
  const bothHits = uniqueHits(
    both.hits.filter((h) => h.kind !== "tp" && h.doc.rendering === "normal"),
  );
  push(
    `Matches (de todo el conjunto AR + nuevas, corpus normal, sin repetir) que no aciertan una verdad: ${bothHits.length}.`,
  );
  push(
    bothHits
      .slice(0, 18)
      .map(
        (h) =>
          `- \`${h.hit.formId}\` emite ${q(h.hit.value)} en \`${h.doc.id}\` → ${h.kind}${h.truth === null ? "" : `; verdad ${q(h.truth.text)} (${h.truth.form})`}.`,
      )
      .join("\n") || "(ninguno)",
  );
  json["arNewWithCatalog"] = rowsAr;

  // ───────────────────────── 6. Universales ─────────────────────────
  push("## 6. Universales sobre cada corpus");
  push(
    "Solo los universales de hoy (fecha, fecha en texto, dirección con palabra clave, carátula; más email, IBAN y tarjeta, que corren siempre), sin ningún formato de país. La verdad U son fechas, direcciones y carátulas que anoté en los corpus. **Es un hallazgo, no un ajuste:** ADR-236 §4 pide informar, no corregir en silencio.",
  );
  const uniJson: unknown[] = [];
  const typeShapeAgg = new Map<
    string,
    { n: number; exact: number; partial: number; miss: number }
  >();
  for (const c of COUNTRIES) {
    const res = evaluate(universals, corpora[c]);
    const uTruths = res.truths.filter((r) => r.truth.kind === "U");
    const shapes = countBy(uTruths, (r) => `${r.truth.entityType} / ${r.truth.shape}`);
    const rows: Array<Array<string | number>> = [];
    for (const [key, nn] of [...shapes.entries()].sort()) {
      const list = uTruths.filter((r) => `${r.truth.entityType} / ${r.truth.shape}` === key);
      const exact = list.filter((r) => r.status === "exact").length;
      const part = list.filter((r) => r.status === "partial" || r.status === "other").length;
      rows.push([key, nn, exact, part, nn - exact - part]);
      const agg = typeShapeAgg.get(key) ?? { n: 0, exact: 0, partial: 0, miss: 0 };
      typeShapeAgg.set(key, {
        n: agg.n + nn,
        exact: agg.exact + exact,
        partial: agg.partial + part,
        miss: agg.miss + (nn - exact - part),
      });
    }
    push(`### ${c}`);
    push(md(["Tipo / escritura", "N", "Exactas", "Parcial u otro tipo", "Perdidas"], rows));
    const notExact = uTruths.filter((r) => r.status !== "exact");
    const listed = new Set<string>();
    const lines: string[] = [];
    for (const r of notExact) {
      const k = `${r.truth.text.toLowerCase()}|${r.status}`;
      if (listed.has(k)) continue;
      listed.add(k);
      const what =
        r.status === "miss"
          ? "no se detecta"
          : `se detecta ${q(r.hit?.value ?? "")} (\`${r.byForm ?? ""}\`), no el tramo entero`;
      lines.push(
        `- ${r.truth.entityType} / ${r.truth.shape} ${q(r.truth.text)} (${r.doc.rendering}): ${what}.`,
      );
    }
    push(
      lines.length === 0
        ? "Todo lo anotado se detecta entero."
        : `Lo que no se detecta entero (único por texto y rendering):\n${lines.join("\n")}`,
    );
    const tl = tally(uTruths);
    const fp = res.hits.filter((h) => h.kind === "fp-neg" || h.kind === "fp-text");
    const onP = res.hits.filter((h) => h.truth !== null && h.truth.kind === "P");
    push(
      `Total U: ${tl.expected}; exactas ${tl.exact} (${pct(tl.exact, tl.expected)}); parcial u otro tipo ${tl.partial + tl.other}; perdidas ${tl.miss}. Matches universales sin verdad (FP): ${fp.length}${
        fp.length === 0
          ? ""
          : ` — ${fp
              .slice(0, 8)
              .map((h) => `\`${h.hit.formId}\` ${q(h.hit.value)}`)
              .join("; ")}`
      }. Matches universales que pisan una entidad P de un formato del país: ${onP.length}${
        onP.length === 0
          ? ""
          : ` — ${onP
              .slice(0, 8)
              .map((h) => `\`${h.hit.formId}\` ${q(h.hit.value)} sobre ${q(h.truth?.text ?? "")}`)
              .join("; ")}`
      }.`,
    );
    uniJson.push({
      country: c,
      expected: tl.expected,
      exact: tl.exact,
      partialOrOther: tl.partial + tl.other,
      miss: tl.miss,
      fp: fp.length,
      onP: onP.length,
    });
  }
  push("### Todos los países juntos, por tipo y escritura");
  push(
    md(
      ["Tipo / escritura", "N", "Exactas", "Parcial u otro tipo", "Perdidas"],
      [...typeShapeAgg.entries()].sort().map(([k, v]) => [k, v.n, v.exact, v.partial, v.miss]),
    ),
  );
  json["universals"] = uniJson;

  // ───────────────────────── 7. Agrupación ─────────────────────────
  push("## 7. Agrupación: qué junta y qué separa el normalizador");
  push(
    "Con la combinación «completo» de cada país, sobre las entidades que acertó (exactas), se compara la identidad real (`key`, la persona o la cosa) con el `normalizedValue` que emitió la forma. *Separa* = una misma identidad con más de un valor normalizado (queda en dos grupos). *Junta* = un mismo valor normalizado para identidades distintas (queda en un solo grupo).",
  );
  const groupJson: unknown[] = [];
  for (const c of COUNTRIES) {
    const fs = forms[c] ?? [];
    const comp = fs.filter((f) => f.replaces === undefined);
    const res = evaluate(comp, corpora[c]);
    const hit = res.truths.filter(
      (r) => r.truth.kind === "P" && r.status === "exact" && r.hit !== null,
    );
    const byKey = new Map<string, Set<string>>();
    const byNorm = new Map<string, Set<string>>();
    for (const r of hit) {
      const nz = r.hit?.normalized ?? "";
      byKey.set(r.truth.key, (byKey.get(r.truth.key) ?? new Set()).add(nz));
      byNorm.set(nz, (byNorm.get(nz) ?? new Set()).add(r.truth.key));
    }
    const separa = [...byKey.entries()].filter(([, v]) => v.size > 1);
    const junta = [...byNorm.entries()].filter(([, v]) => v.size > 1);
    push(`### ${c}`);
    push(
      `Identidades con una entidad acertada: ${byKey.size}. **Separa**: ${separa.length}. **Junta**: ${junta.length}.`,
    );
    if (separa.length > 0) {
      push("Separa (identidad → valores normalizados distintos):");
      push(
        separa
          .slice(0, 14)
          .map(([k, v]) => `- \`${k}\` → ${[...v].map((x) => `\`${x}\``).join(", ")}`)
          .join("\n"),
      );
    }
    if (junta.length > 0) {
      push("Junta (valor normalizado → identidades distintas):");
      push(
        junta
          .slice(0, 14)
          .map(([k, v]) => `- \`${k}\` ← ${[...v].map((x) => `\`${x}\``).join(", ")}`)
          .join("\n"),
      );
    }
    groupJson.push({
      country: c,
      identities: byKey.size,
      separa: separa.length,
      junta: junta.length,
    });
    if (c === "BO") {
      // D-7: el mismo corpus con un normalizador que solo conserva el número.
      const byNumber = new Map<string, Set<string>>();
      for (const r of hit.filter(
        (x) => x.truth.form === "bo:ci-ext" || x.truth.form === "bo:ci-ctx",
      )) {
        const raw = r.hit?.value ?? "";
        const nz = normalizeBoCiNumberOnly(raw);
        byNumber.set(
          nz,
          (byNumber.get(nz) ?? new Set()).add(r.truth.key.replace(/-\d[A-Z](?=-|$)/, "")),
        );
      }
      const merged = [...byNumber.entries()].filter(([, v]) => v.size > 1);
      push(
        "**D-7 (la CI de BO se repite entre personas).** Mismo corpus con un normalizador alternativo que **solo conserva el número** (sin extensión). Se compara contra la identidad real número + extensión:",
      );
      push(
        `Con el normalizador del Plan §5 (número + extensión; el complemento no se mide) las personas que comparten número **no se juntan** (junta = ${junta.length}). Con el alternativo que solo guarda el número, **se juntan ${merged.length} números** que son de personas distintas: ${merged.map(([k, v]) => `\`${k}\` ← ${[...v].map((x) => `\`${x}\``).join(", ")}`).join("; ") || "(ninguno)"}.`,
      );
      groupJson.push({ country: "BO", alternativeNumberOnlyMerged: merged.length });
    }
  }
  json["grouping"] = groupJson;

  // ───────────────────────── 8. Detalle de falsos positivos del núcleo ─────────────────────────
  push("## 8. Falsos positivos de cada forma, con su texto");
  push(
    "Cada match de una forma corrida sola que cae sobre un negativo o sobre texto sin verdad. Es lo que el mantenedor mira para decidir.",
  );
  for (const c of COUNTRIES) {
    push(`### ${c}`);
    const lines: string[] = [];
    for (const f of forms[c] ?? []) {
      const res = evaluate([f], corpora[c]);
      const fps = res.hits.filter((h) => h.kind === "fp-neg" || h.kind === "fp-text");
      if (fps.length === 0) continue;
      const uniq = countBy(
        fps,
        (h) => `${q(h.hit.value)} (${h.kind === "fp-neg" ? "negativo" : "texto"})`,
      );
      lines.push(
        `- \`${f.id}\` (${f.optional ? "opcional" : "núcleo"}): ${fps.length} FP — ${[...uniq.entries()].map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join("; ")}`,
      );
    }
    push(lines.length === 0 ? "(ninguna forma tiene falsos positivos)" : lines.join("\n"));
  }

  // ───────────────────────── 8b. Ruido numérico ─────────────────────────
  push("## 8b. Ruido numérico: cuánto acierta un número cualquiera");
  push(
    "El corpus escrito a mano tiene pocos negativos numéricos, y las formas con verificador pasan por azar un número cualquiera con una probabilidad conocida. Para medirla se generaron números **al azar** (PRNG fijo, semilla 20261122, primer dígito 1-9; 2000 de cada largo) y se pusieron en frases neutras. *Tramo entero* = el match cubre el número entero; *Cualquier match* = el match solapa el número (incluye tramos). Sirve para estimar el falso positivo de las formas **sin contexto**; los números de verdad del documento (folios, montos) no son aleatorios.",
  );
  const rand = mulberry32(20261122);
  const rndDigits = (len: number): string => {
    let s = String(1 + Math.floor(rand() * 9));
    for (let i = 1; i < len; i++) s += String(Math.floor(rand() * 10));
    return s;
  };
  const dotted = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const N_NOISE = 2000;
  interface NoiseGroup {
    readonly name: string;
    readonly prefix: string;
    readonly make: () => string;
  }
  const groups: NoiseGroup[] = [
    ...[6, 7, 8, 9, 12, 22].map((len) => ({
      name: `${len} dígitos pegados, tras «Folio»`,
      prefix: "Folio ",
      make: () => rndDigits(len),
    })),
    {
      name: "monto con puntos, 7 dígitos («$ 1.234.567»)",
      prefix: "$ ",
      make: () => dotted(rndDigits(7)),
    },
    {
      name: "monto con puntos, 8 dígitos («$ 12.345.678»)",
      prefix: "$ ",
      make: () => dotted(rndDigits(8)),
    },
    {
      name: "cuerpo con puntos de 8 dígitos y guion + DV al azar",
      prefix: "Doc ",
      make: () => `${dotted(rndDigits(8))}-${"0123456789K"[Math.floor(rand() * 11)]}`,
    },
    {
      name: "cuerpo con puntos de 7 dígitos y guion + DV al azar",
      prefix: "Doc ",
      make: () => `${dotted(rndDigits(7))}-${"0123456789K"[Math.floor(rand() * 11)]}`,
    },
    {
      name: "cuerpo sin puntos de 8 dígitos y guion + DV al azar",
      prefix: "Doc ",
      make: () => `${rndDigits(8)}-${"0123456789K"[Math.floor(rand() * 11)]}`,
    },
    {
      name: "cuerpo sin puntos de 7 dígitos y guion + DV al azar",
      prefix: "Doc ",
      make: () => `${rndDigits(7)}-${"0123456789K"[Math.floor(rand() * 11)]}`,
    },
    {
      name: "número de 5 a 8 dígitos tras «Nº»",
      prefix: "Factura Nº ",
      make: () => rndDigits(5 + Math.floor(rand() * 4)),
    },
  ];
  const noiseRows: Array<Array<string | number>> = [];
  const noiseJson: unknown[] = [];
  for (const g of groups) {
    let text = "";
    const spans: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < N_NOISE; i++) {
      text += g.prefix;
      const tok = g.make();
      spans.push({ start: text.length, end: text.length + tok.length });
      text += `${tok}. `;
    }
    for (const c of COUNTRIES) {
      for (const f of nonAlt(forms[c] ?? [])) {
        const hits = runFormats([f], text);
        if (hits.length === 0) continue;
        let any = 0;
        let whole = 0;
        for (const s of spans) {
          const over = hits.filter((h) => h.start < s.end && s.start < h.end);
          if (over.length > 0) any += 1;
          if (over.some((h) => h.start === s.start && h.end === s.end)) whole += 1;
        }
        if (any === 0) continue;
        noiseRows.push([
          g.name,
          `\`${f.id}\``,
          f.optional ? "opcional" : "núcleo",
          N_NOISE,
          whole,
          `${((100 * whole) / N_NOISE).toFixed(1)} %`,
          any,
          `${((100 * any) / N_NOISE).toFixed(1)} %`,
        ]);
        noiseJson.push({ group: g.name, form: f.id, n: N_NOISE, whole, any });
      }
    }
  }
  push(
    md(
      [
        "Número al azar",
        "Forma",
        "Rol",
        "N",
        "Tramo entero",
        "% entero",
        "Cualquier match",
        "% cualquier",
      ],
      noiseRows,
    ),
  );
  push("Las formas que no figuran no matchean ninguno de esos 2000 números.");
  json["noise"] = noiseJson;

  push("## 9. Notas de método");
  push(
    "- La guarda de corrida (`passesRunGuard`) y la prioridad del match más largo son las del motor: la guarda se importa de `regex-engine/src/run-guard.ts`; la resolución de solapamientos se reimplementa para formatos base (ordenar por largo descendente, inicio, orden de la lista; todo choque descarta), que es lo que hace `resolveOverlaps` cuando todos los formatos son `base`.",
  );
  push(
    "- El catálogo argentino se importa de `regex-engine/src/patterns/default-ar.ts` (`DEFAULT_PATTERNS_AR`) por ruta relativa, sin tocar el paquete. El email se corre con su `RegExp` (el motor usa un escáner lineal con la misma salida, ADR-181).",
  );
  push(
    "- Las formas con piezas se recorren con un enumerador de finales posibles (no es el autómata de Thompson del motor) con la semántica del spec: más a la izquierda y más largo, bordes de letra o dígito, contexto con `:` opcional.",
  );
  push(
    "- Las formas de tipo `control` con `RegExp` llevan los bordes del generador (`(?<![\\p{L}\\p{N}])` … `(?![\\p{L}\\p{N}])`), no `\\b`. Con `\\b` un RUT pegado a `_` se comportaría distinto; no aparece en el corpus.",
  );
  push("- Texto de página: palabras unidas con un espacio, sin saltos de línea, como `Page.text`.");

  push("## 10. Tabla final propuesta de la tanda 1");
  push(
    "Las formas que quedan por país, con su tipo, su clase (*structure*: piezas del generador; *control*: RegExp con un control propio, sea un verificador, una lista de códigos o un patrón de prefijos), el control, el contexto (máximo 5 palabras por formato), la máscara y el normalizador. *Estado*: «decidida» = el Plan §5 la lleva a la tanda; «sin decidir» = el Plan no se pronunció. Un control «patrón» no es un verificador: la forma es una RegExp y en los motores sería un `control` trivial (o `structure`, si las piezas la alcanzan).",
  );
  const finalRows: Array<Array<string | number>> = [];
  for (const c of COUNTRIES) {
    for (const f of forms[c] ?? []) {
      const cls = f.cls.startsWith("control") ? "control" : "structure";
      const gap = f.contextGapWords ?? 0;
      const ctx =
        f.context === undefined
          ? "-"
          : `${f.context.map((w) => `«${w}»`).join(", ")}${gap > 0 ? ` (hasta ${gap} palabras de relleno)` : ""}`;
      finalRows.push([
        c,
        `\`${f.id}\``,
        f.entityType,
        cls,
        f.controlName ?? "-",
        ctx,
        `\`${f.maskFormat}\``,
        f.normalizerName ?? "-",
        f.optional ? "sin decidir" : "decidida",
      ]);
    }
  }
  push(
    md(
      [
        "País",
        "Forma",
        "Tipo",
        "Clase",
        "Control",
        "Contexto",
        "Máscara",
        "Normalizador",
        "Estado",
      ],
      finalRows,
    ),
  );

  return { markdown: `${summaryMd}\n${out.join("\n")}`, json };
}
