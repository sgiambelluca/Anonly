/**
 * Schema de `DetectionBaseline` (ADR-147 §1/§6): la baseline revisable de
 * `tests/quality/baselines/reference-v1.json`. Reemplaza al porcentaje
 * redondeado por conteos enteros, por documento y por entidad, más la
 * identidad completa de la corrida que la produjo — corpus, runtime, modelo,
 * config efectiva, commit.
 *
 * `schemaVersion` es un entero que se incrementa cada vez que la FORMA de
 * `DetectionBaseline` cambia de manera incompatible (un campo que se saca, se
 * renombra, o cambia de tipo). Agregar un campo nuevo opcional no lo exige;
 * sacar o resignificar uno sí, porque un comparador viejo leyendo una
 * baseline nueva (o viceversa) tiene que poder notar la diferencia en vez de
 * comparar campos que ya no significan lo mismo.
 */

/**
 * ADR-147 §6: "el producto hoy es el contenedor de escritorio (ADR-130), así
 * que la baseline obligatoria se mide sobre Chromium/WASM" — `"node"` queda
 * en el tipo porque `tests/quality/main.ts` sigue produciendo mediciones sin
 * NER en Node (ADR-095 §5) y en algún momento se podría querer una baseline
 * de esa corrida también; hoy la única baseline versionada es
 * `"chromium-wasm"`.
 */
export type BaselineRuntime = "node" | "chromium-wasm";

/**
 * Identidad completa de la corrida que produjo la baseline (ADR-147 §1/§6).
 * El comparador (`compare.ts`) exige que coincida antes de comparar
 * cobertura — ver ahí la justificación de qué campos son obligatorios.
 */
export interface BaselineIdentity {
  /** Hash del corpus: `manifest.json` + cada `*.truth.json` referenciado (ver `identity.ts`). */
  readonly corpusHash: string;
  readonly runtime: BaselineRuntime;
  /** Identificador legible del modelo (p. ej. `"ner-model@<revision>"`, ver `identity.ts`). */
  readonly modelId: string;
  /** Hash de las entradas `ner-model-*` de `assets.lock.json` (ver `identity.ts`). */
  readonly modelHash: string;
  /** Config efectiva de la corrida (subconjunto relevante de `EngineConfig`). Informativo: el comparador no lo exige igual. */
  readonly effectiveConfig: unknown;
  /** `git rev-parse HEAD` al momento de medir. Informativo: el comparador no lo exige igual. */
  readonly commit: string;
}

/** Una entidad del truth, con su identidad estable (`entity-id.ts`) y su resultado de cobertura (`matching.ts`). */
export interface BaselineEntity {
  readonly id: string;
  readonly entityType: string;
  readonly pageIndex: number;
  readonly covered: boolean;
  readonly typedCovered: boolean;
}

export interface BaselineDocument {
  readonly documentId: string;
  /** `false` si el pipeline terminó en `PIPELINE_FAILED` (`MeasuredDocument.ok`). */
  readonly ok: boolean;
  /** `truth.entities.length` de este documento — el denominador (ADR-147 §3, "denominador inesperado"). */
  readonly expectedEntityCount: number;
  readonly falsePositiveCount: number;
  readonly entities: ReadonlyArray<BaselineEntity>;
}

export const BASELINE_SCHEMA_VERSION = 1;

export interface DetectionBaseline {
  readonly schemaVersion: typeof BASELINE_SCHEMA_VERSION;
  readonly identity: BaselineIdentity;
  readonly documents: ReadonlyArray<BaselineDocument>;
}

/*
 * Validación en runtime (Code_Standards.md §7, mismo criterio que
 * `load-reference-dataset.ts`): una baseline o un candidato son JSON leído de
 * disco, no tipado por el compilador. Un archivo con un campo faltante o mal
 * tipado tiene que fallar ruidoso al cargar, no producir un `DetectionBaseline`
 * silenciosamente incompleto que el comparador lea como si tuviera, por
 * ejemplo, cero falsos positivos donde en realidad el campo no estaba.
 */
function fail(filePath: string, reason: string): never {
  throw new Error(`Baseline inválida en ${filePath}: ${reason}`);
}

function asRecord(value: unknown, filePath: string, reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(filePath, reason);
  return value as Record<string, unknown>;
}

function parseBaselineEntity(raw: unknown, filePath: string, index: number): BaselineEntity {
  const record = asRecord(raw, filePath, `entities[${index}] no es un objeto`);
  const { id, entityType, pageIndex, covered, typedCovered } = record;

  if (typeof id !== "string" || id.length === 0) {
    fail(filePath, `entities[${index}].id inválido: ${JSON.stringify(id)}`);
  }
  if (typeof entityType !== "string" || entityType.length === 0) {
    fail(filePath, `entities[${index}].entityType inválido: ${JSON.stringify(entityType)}`);
  }
  if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) {
    fail(filePath, `entities[${index}].pageIndex inválido: ${JSON.stringify(pageIndex)}`);
  }
  if (typeof covered !== "boolean") {
    fail(filePath, `entities[${index}].covered inválido: ${JSON.stringify(covered)}`);
  }
  if (typeof typedCovered !== "boolean") {
    fail(filePath, `entities[${index}].typedCovered inválido: ${JSON.stringify(typedCovered)}`);
  }

  return { id, entityType, pageIndex, covered, typedCovered };
}

function parseBaselineDocument(raw: unknown, filePath: string, index: number): BaselineDocument {
  const record = asRecord(raw, filePath, `documents[${index}] no es un objeto`);
  const { documentId, ok, expectedEntityCount, falsePositiveCount, entities } = record;

  if (typeof documentId !== "string" || documentId.length === 0) {
    fail(filePath, `documents[${index}].documentId inválido`);
  }
  if (typeof ok !== "boolean") {
    fail(filePath, `documents[${index}].ok inválido: ${JSON.stringify(ok)}`);
  }
  if (
    typeof expectedEntityCount !== "number" ||
    !Number.isInteger(expectedEntityCount) ||
    expectedEntityCount < 0
  ) {
    fail(
      filePath,
      `documents[${index}].expectedEntityCount inválido: ${JSON.stringify(expectedEntityCount)}`,
    );
  }
  if (
    typeof falsePositiveCount !== "number" ||
    !Number.isInteger(falsePositiveCount) ||
    falsePositiveCount < 0
  ) {
    fail(
      filePath,
      `documents[${index}].falsePositiveCount inválido: ${JSON.stringify(falsePositiveCount)}`,
    );
  }
  if (!Array.isArray(entities)) {
    fail(filePath, `documents[${index}].entities no es un array`);
  }

  return {
    documentId,
    ok,
    expectedEntityCount,
    falsePositiveCount,
    entities: entities.map((entity, entityIndex) =>
      parseBaselineEntity(entity, filePath, entityIndex),
    ),
  };
}

const RUNTIME_VALUES = new Set<string>(["node", "chromium-wasm"]);

function parseBaselineIdentity(raw: unknown, filePath: string): BaselineIdentity {
  const record = asRecord(raw, filePath, "identity no es un objeto");
  const { corpusHash, runtime, modelId, modelHash, effectiveConfig, commit } = record;

  if (typeof corpusHash !== "string" || corpusHash.length === 0) {
    fail(filePath, `identity.corpusHash inválido: ${JSON.stringify(corpusHash)}`);
  }
  if (typeof runtime !== "string" || !RUNTIME_VALUES.has(runtime)) {
    fail(filePath, `identity.runtime inválido: ${JSON.stringify(runtime)}`);
  }
  if (typeof modelId !== "string" || modelId.length === 0) {
    fail(filePath, `identity.modelId inválido: ${JSON.stringify(modelId)}`);
  }
  if (typeof modelHash !== "string" || modelHash.length === 0) {
    fail(filePath, `identity.modelHash inválido: ${JSON.stringify(modelHash)}`);
  }
  if (typeof commit !== "string" || commit.length === 0) {
    fail(filePath, `identity.commit inválido: ${JSON.stringify(commit)}`);
  }

  return {
    corpusHash,
    // Narrowing seguro: `RUNTIME_VALUES.has` ya validó la membresía arriba
    // (mismo criterio que `load-reference-dataset.ts`).
    runtime: runtime as BaselineRuntime,
    modelId,
    modelHash,
    effectiveConfig,
    commit,
  };
}

/**
 * Valida y parsea un `DetectionBaseline` leído de disco (baseline o
 * candidato: mismo schema). Tira ruidoso ante cualquier forma inesperada —
 * ver cabecera del archivo.
 */
export function parseDetectionBaseline(raw: unknown, filePath: string): DetectionBaseline {
  const record = asRecord(raw, filePath, "no es un objeto");
  const { schemaVersion, identity, documents } = record;

  if (schemaVersion !== BASELINE_SCHEMA_VERSION) {
    fail(
      filePath,
      `schemaVersion inválido: ${JSON.stringify(schemaVersion)} (esperado ${BASELINE_SCHEMA_VERSION})`,
    );
  }
  if (!Array.isArray(documents)) {
    fail(filePath, "documents no es un array");
  }

  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    identity: parseBaselineIdentity(identity, filePath),
    documents: documents.map((doc, index) => parseBaselineDocument(doc, filePath, index)),
  };
}
