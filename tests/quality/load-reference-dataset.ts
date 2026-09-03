/**
 * Carga y valida `tests/fixtures/reference/manifest.json` y los
 * `*.truth.json` que referencia (`tests/fixtures/README.md` "Dataset de
 * referencia"). Se valida en runtime porque son datos leídos de disco, no
 * tipados por el compilador: un `truth.json` con un `entityType` que no está
 * en el enum tiene que fallar ruidoso al cargar el dataset, no producir un
 * valor silenciosamente mal tipado que infle o desinfle el recall sin que
 * nadie lo note (mismo criterio que Code_Standards.md §7 para decoders de
 * boundary, aplicado acá al boundary del filesystem).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EntityType } from "@anonly/shared";

import type {
  DatasetCategory,
  DocumentTruth,
  ManifestEntry,
  ReferenceManifest,
  TruthDetector,
  TruthEntity,
} from "./types.js";

/*
 * `fileURLToPath` + `import.meta.url`, no `__dirname`: esta suite corre como
 * script ESM bajo `tsx` (`pnpm test:quality`), donde `__dirname` no existe.
 * Mismo patrón que `readGenderLexiconProvenance` en la app.
 */
const REFERENCE_DIR = fileURLToPath(new URL("../fixtures/reference/", import.meta.url));

const ENTITY_TYPE_VALUES = new Set<string>(Object.values(EntityType));
const CATEGORY_VALUES = new Set<string>(["dense", "sparse", "trap", "empty", "forms"]);
const DETECTOR_VALUES = new Set<string>(["regex", "ner"]);

function fail(filePath: string, reason: string): never {
  throw new Error(`Dataset de referencia inválido en ${filePath}: ${reason}`);
}

function asRecord(value: unknown, filePath: string, reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(filePath, reason);
  return value as Record<string, unknown>;
}

function parseTruthEntity(raw: unknown, filePath: string, index: number): TruthEntity {
  const record = asRecord(raw, filePath, `entities[${index}] no es un objeto`);
  const { entityType, value, pageIndex, detector } = record;

  if (typeof entityType !== "string" || !ENTITY_TYPE_VALUES.has(entityType)) {
    fail(filePath, `entities[${index}].entityType inválido: ${JSON.stringify(entityType)}`);
  }
  if (typeof value !== "string" || value.length === 0) {
    fail(filePath, `entities[${index}].value inválido: ${JSON.stringify(value)}`);
  }
  if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) {
    fail(filePath, `entities[${index}].pageIndex inválido: ${JSON.stringify(pageIndex)}`);
  }
  if (typeof detector !== "string" || !DETECTOR_VALUES.has(detector)) {
    fail(filePath, `entities[${index}].detector inválido: ${JSON.stringify(detector)}`);
  }

  return {
    // Narrowing seguro: `ENTITY_TYPE_VALUES`/`DETECTOR_VALUES` ya validaron
    // la membresía en runtime arriba (Code_Standards.md §2, "`as` solo para
    // narrowing seguro documentado").
    entityType: entityType as EntityType,
    value,
    pageIndex,
    detector: detector as TruthDetector,
  };
}

function parseDocumentTruth(raw: unknown, filePath: string): DocumentTruth {
  const record = asRecord(raw, filePath, "no es un objeto");
  const { documentId, entities } = record;

  if (typeof documentId !== "string" || documentId.length === 0) {
    fail(filePath, `documentId inválido: ${JSON.stringify(documentId)}`);
  }
  if (!Array.isArray(entities)) {
    fail(filePath, `entities no es un array: ${JSON.stringify(entities)}`);
  }

  return {
    documentId,
    entities: entities.map((entity, index) => parseTruthEntity(entity, filePath, index)),
  };
}

function parseManifestEntry(raw: unknown, filePath: string, index: number): ManifestEntry {
  const record = asRecord(raw, filePath, `documents[${index}] no es un objeto`);
  const { documentId, pdf, truth, category, entityCount } = record;

  if (typeof documentId !== "string" || documentId.length === 0) {
    fail(filePath, `documents[${index}].documentId inválido`);
  }
  if (typeof pdf !== "string" || pdf.length === 0) {
    fail(filePath, `documents[${index}].pdf inválido`);
  }
  if (typeof truth !== "string" || truth.length === 0) {
    fail(filePath, `documents[${index}].truth inválido`);
  }
  if (typeof category !== "string" || !CATEGORY_VALUES.has(category)) {
    fail(filePath, `documents[${index}].category inválida: ${JSON.stringify(category)}`);
  }
  if (typeof entityCount !== "number" || !Number.isInteger(entityCount) || entityCount < 0) {
    fail(filePath, `documents[${index}].entityCount inválido`);
  }

  return {
    documentId,
    pdf,
    truth,
    // Narrowing seguro: `CATEGORY_VALUES.has` ya validó la membresía arriba.
    category: category as DatasetCategory,
    entityCount,
  };
}

function parseManifest(raw: unknown, filePath: string): ReferenceManifest {
  const record = asRecord(raw, filePath, "no es un objeto");
  const { documents } = record;
  if (!Array.isArray(documents)) fail(filePath, "documents no es un array");
  return {
    documents: documents.map((entry, index) => parseManifestEntry(entry, filePath, index)),
  };
}

export interface ReferenceDocument {
  readonly entry: ManifestEntry;
  readonly truth: DocumentTruth;
  readonly pdfBuffer: ArrayBuffer;
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as unknown;
}

/** Lee `manifest.json` + cada `*.truth.json` + cada `*.pdf` de `tests/fixtures/reference/`. */
export async function loadReferenceDataset(): Promise<ReadonlyArray<ReferenceDocument>> {
  const manifestPath = resolve(REFERENCE_DIR, "manifest.json");
  const manifest = parseManifest(await readJson(manifestPath), manifestPath);

  return Promise.all(
    manifest.documents.map(async (entry): Promise<ReferenceDocument> => {
      const truthPath = resolve(REFERENCE_DIR, entry.truth);
      const pdfPath = resolve(REFERENCE_DIR, entry.pdf);
      const truth = parseDocumentTruth(await readJson(truthPath), truthPath);
      const bytes = await readFile(pdfPath);
      const pdfBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return { entry, truth, pdfBuffer };
    }),
  );
}
