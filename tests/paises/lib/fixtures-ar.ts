/**
 * Textos argentinos sintéticos que ya viven en el repo, usados como corpus de
 * choque: el dataset de referencia (`tests/fixtures/generate.ts`,
 * `buildReferenceDocSpecs()`, 26 documentos) y las diez páginas de
 * `TEXT_10P_PAGES`. Son datos sintéticos de las fixtures del proyecto.
 */

import { TEXT_10P_PAGES, buildReferenceDocSpecs } from "../../fixtures/generate.js";

import type { CorpusDoc, Truth } from "./types.js";

export interface ArFixtureSummary {
  readonly docs: ReadonlyArray<CorpusDoc>;
  readonly referenceDocs: number;
  readonly referencePages: number;
  readonly text10pPages: number;
}

export function loadArFixtures(): ArFixtureSummary {
  const docs: CorpusDoc[] = [];
  const specs = buildReferenceDocSpecs();
  let pages = 0;
  for (const spec of specs) {
    spec.pages.forEach((page, pageIndex) => {
      pages += 1;
      const text = page.text.replace(/\s*\n\s*/g, " ");
      const truths: Truth[] = [];
      let cursor = 0;
      for (const ent of page.entities) {
        let at = text.indexOf(ent.value, cursor);
        if (at < 0) at = text.indexOf(ent.value);
        if (at < 0) continue;
        cursor = at + ent.value.length;
        truths.push({
          kind: "P",
          entityType: String(ent.entityType),
          form: `ar-fixture:${String(ent.entityType)}`,
          shape: ent.detector,
          key: ent.value,
          start: at,
          end: at + ent.value.length,
          text: ent.value,
        });
      }
      docs.push({
        id: `${spec.documentId}-p${pageIndex}`,
        country: "AR",
        rendering: "normal",
        added: false,
        text,
        truths,
        negs: [],
      });
    });
  }
  TEXT_10P_PAGES.forEach((text, i) => {
    docs.push({
      id: `text-10p-p${i}`,
      country: "AR",
      rendering: "normal",
      added: false,
      text: text.replace(/\s*\n\s*/g, " "),
      truths: [],
      negs: [],
    });
  });
  return {
    docs,
    referenceDocs: specs.length,
    referencePages: pages,
    text10pPages: TEXT_10P_PAGES.length,
  };
}
