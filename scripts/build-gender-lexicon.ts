/**
 * Léxico de género por nombre de pila para el reemplazo por género de
 * `Person` (ADR-069 §1-§3, `Grouping_Engine.md` checklist 15e).
 *
 * Fuente única: Buenos Aires Data, recurso "Nombres Permitidos"
 * (CC-BY-2.5-AR). Sin fusión de fuentes y sin umbral de confianza —
 * mapeo directo `F → f`, `M → m`, `A → ambiguous` (ADR-069 §1, supersede
 * la fusión con UCI de ADR-060 §9).
 *
 * Emite un MÓDULO TYPESCRIPT GENERADO — no un JSON suelto — que
 * `grouping-engine` y `regex-engine` importan desde `@anonly/shared`: sin
 * fetch, sin Cache Storage, sin URL configurable (ADR-069 §2). El CSV
 * original nunca entra al repo; el módulo generado sí.
 *
 * Uso:
 *   pnpm lexicon:build
 *
 * Regenera:
 *   - packages/anonymization-core/shared/src/gender-lexicon.generated.ts
 *   - packages/anonymization-core/shared/assets/gender-lexicon.provenance.json
 *
 * Determinista: mismo CSV de origen ⇒ mismo módulo ⇒ mismo hash.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// ADR-091 §1: el artefacto vive en `shared`, no en `grouping-engine`. La
// fuente, el filtro y el contenido no cambian — el `sha256` de procedencia se
// calcula sobre los DATOS (`serializeArtifact`), no sobre el módulo, así que
// la mudanza no lo mueve.
const SHARED_SRC_DIR = resolve(REPO_ROOT, "packages/anonymization-core/shared/src");
const ASSETS_DIR = resolve(REPO_ROOT, "packages/anonymization-core/shared/assets");
const GENERATED_MODULE_PATH = resolve(SHARED_SRC_DIR, "gender-lexicon.generated.ts");
const PROVENANCE_PATH = resolve(ASSETS_DIR, "gender-lexicon.provenance.json");
const GENERATED_MODULE_REPO_PATH =
  "packages/anonymization-core/shared/src/gender-lexicon.generated.ts";

// ─── Fuente (ADR-069 §1) ───

export const BUENOS_AIRES_SOURCE = {
  id: "buenos-aires-nombres-permitidos",
  datasetPage: "https://data.buenosaires.gob.ar/dataset/nombres",
  url: "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-gobierno/nombres/nombres-permitidos.csv",
  license: "CC-BY-2.5-AR",
} as const;

// ─── Parsing CSV mínimo (RFC4180: comillas, comillas escapadas ""). Sin
// dependencia externa (R-12): el CSV de origen es simple y esto son ~15
// líneas. Solo se leen NOMBRE/SEXO (las dos primeras columnas); ninguna de
// las dos contiene delimitadores ni comillas en la fuente real, así que el
// escapado de ORIGEN/SIGNIFICADO (que sí lo usan) nunca afecta el resultado. ───

function parseCsvLine(line: string, delimiter: string): ReadonlyArray<string> {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (line.charAt(i + 1) === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

// Rango Unicode "Combining Diacritical Marks" (U+0300–U+036F) en forma de
// escape explícito (no literal): un carácter combinante pegado en el código
// fuente es indistinguible a simple vista de texto normal y frágil frente a
// cualquier re-normalización del archivo por el editor/herramientas (mismo
// criterio que `shared/src/types.ts`).
/** Normalización de ADR-060 §4: NFC, minúsculas, sin diacríticos. */
const DIACRITICS_RE = /[\u0300-\u036f]/g;

function normalizeForLexicon(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .trim()
    .replace(/\s+/g, " ");
}

// ─── Buenos Aires Data ("Nombres Permitidos") ───

export type BaGenderCode = "F" | "M" | "A";

/**
 * Parsea el CSV de Buenos Aires (`NOMBRE;SEXO;ORIGEN;SIGNIFICADO`). Filas
 * con `SEXO` fuera de `{F,M,A}` se descartan (no se inventa un valor).
 */
export function parseBuenosAiresCsv(text: string): ReadonlyMap<string, BaGenderCode> {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const result = new Map<string, BaGenderCode>();
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line, ";");
    const rawName = fields[0];
    const rawSexo = fields[1];
    if (rawName === undefined || rawSexo === undefined) continue;
    const sexo = rawSexo.trim().toUpperCase();
    if (sexo !== "F" && sexo !== "M" && sexo !== "A") continue;
    const name = normalizeForLexicon(rawName);
    if (name.length === 0) continue;
    // Último gana en caso de fila duplicada con SEXO distinto (no observado
    // en la fuente real al momento de escribir esto, pero no se asume).
    result.set(name, sexo);
  }
  return result;
}

// ─── Mapeo directo y saneamiento (ADR-069 §1/§3) ───

/**
 * Alineado con `GenderLexiconLabel` de `shared/src/types.ts` (ADR-091 §1)
 * (ADR-069 §2: son las dos mitades de una misma pieza — el build las emite,
 * `inferPersonGender` las consume — y nunca se habían cruzado: el script
 * original emitía "ambiguo", `gender.ts` esperaba "ambiguous"). No se
 * importa el tipo real porque `scripts/` es tooling de build sin
 * dependencia hacia ningún motor (mismo aislamiento que
 * `scripts/mirror-assets.ts`); las dos declaraciones deben coincidir.
 */
export type GenderLexiconLabel = "f" | "m" | "ambiguous";

function toGenderLabel(sexo: BaGenderCode): GenderLexiconLabel {
  if (sexo === "F") return "f";
  if (sexo === "M") return "m";
  return "ambiguous";
}

const TOKEN_WITH_DOT_OR_DIGIT_RE = /[.0-9]/;

/**
 * Saneamiento en el build (ADR-069 §3, candado 1 de 2): descarta toda clave
 * con un token que contenga un punto o un dígito — 8 abreviaturas del
 * registro (`franc.de caracciolo`, `atahualpa d.l.andes`). NO filtra por
 * longitud de token: `maria de la o` es un nombre real del registro y tiene
 * que sobrevivir junto con el resto de los compuestos.
 */
export function sanitizeLexiconKeys(
  lexicon: ReadonlyMap<string, GenderLexiconLabel>,
): ReadonlyMap<string, GenderLexiconLabel> {
  const result = new Map<string, GenderLexiconLabel>();
  for (const [name, label] of lexicon) {
    const hasBadToken = name.split(" ").some((token) => TOKEN_WITH_DOT_OR_DIGIT_RE.test(token));
    if (!hasBadToken) result.set(name, label);
  }
  return result;
}

/** CSV crudo → léxico saneado, en un solo paso (lo que `main()` necesita). */
export function buildGenderLexicon(csvText: string): ReadonlyMap<string, GenderLexiconLabel> {
  const ba = parseBuenosAiresCsv(csvText);
  const labeled = new Map<string, GenderLexiconLabel>();
  for (const [name, sexo] of ba) labeled.set(name, toGenderLabel(sexo));
  return sanitizeLexiconKeys(labeled);
}

// ─── Serialización canónica (solo para el hash de procedencia — el artefacto
// commiteado es el módulo TS de `renderGeneratedModule`, no este JSON) ───

/**
 * Serialización determinista: SOLO `nombre → f | m | ambiguous`. Claves
 * ordenadas alfabéticamente para que el hash no dependa del orden de
 * iteración del `Map` de origen.
 */
export function serializeArtifact(lexicon: ReadonlyMap<string, GenderLexiconLabel>): string {
  const sortedNames = [...lexicon.keys()].sort();
  const sorted: Record<string, GenderLexiconLabel> = {};
  for (const name of sortedNames) {
    const label = lexicon.get(name);
    if (label !== undefined) sorted[name] = label;
  }
  return JSON.stringify(sorted);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

// ─── Emisión del módulo TypeScript generado (ADR-069 §2) ───

export interface GeneratedModuleMeta {
  readonly generatedAt: string;
  readonly sha256: string;
}

/**
 * Emite el módulo commiteado que `@anonly/shared` reexporta
 * (sin fetch, sin `public/`, ADR-069 §2). `JSON.stringify` por clave/valor
 * en vez de interpolar el string a mano: es una serialización de string
 * literal de JS/TS válida sin escribir un escapador propio, y cubre sin
 * casos especiales el puñado de nombres del CSV con bytes de control o
 * símbolos residuales de un mojibake de origen (p. ej. "MARIA DE BEGO¤A"),
 * que sobreviven sin filtrar por la misma razón que cualquier otro nombre
 * ausente del léxico: nunca calzan contra un `canonicalValue` normalizado y
 * caen a sin determinar, no a un falso positivo.
 */
export function renderGeneratedModule(
  lexicon: ReadonlyMap<string, GenderLexiconLabel>,
  meta: GeneratedModuleMeta,
): string {
  const sortedNames = [...lexicon.keys()].sort();
  const entries = sortedNames
    .map((name) => `  [${JSON.stringify(name)}, ${JSON.stringify(lexicon.get(name))}],`)
    .join("\n");

  return `/**
 * GENERADO por scripts/build-gender-lexicon.ts — no editar a mano.
 * Regenerar con \`pnpm lexicon:build\`.
 *
 * Léxico de género por nombre de pila (ADR-069 §1-§3), fuente única Buenos
 * Aires Data "Nombres Permitidos" (CC-BY-2.5-AR). Procedencia completa
 * (URL, licencia, fecha de descarga, hash) en
 * packages/anonymization-core/shared/assets/gender-lexicon.provenance.json.
 *
 * ${sortedNames.length} entradas, claves en orden alfabético (el hash de
 * procedencia no depende del orden de iteración).
 * Generado ${meta.generatedAt} — sha256 ${meta.sha256}.
 */
import type { GenderLexiconLabel } from "./types.js";

export const GENDER_LEXICON: ReadonlyMap<string, GenderLexiconLabel> = new Map([
${entries}
]);
`;
}

// ─── main(): descarga real + emisión del módulo + provenance commiteados ───

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} devolvió HTTP ${response.status}.`);
  }
  return response.text();
}

interface Provenance {
  readonly generatedAt: string;
  readonly generator: string;
  readonly source: {
    readonly id: string;
    readonly datasetPage: string;
    readonly url: string;
    readonly license: string;
    readonly retrievedAt: string;
  };
  readonly artifact: {
    readonly modulePath: string;
    readonly sha256: string;
    readonly entryCount: number;
    readonly counts: { readonly f: number; readonly m: number; readonly ambiguous: number };
  };
}

function countByLabel(lexicon: ReadonlyMap<string, GenderLexiconLabel>): {
  readonly f: number;
  readonly m: number;
  readonly ambiguous: number;
} {
  let f = 0;
  let m = 0;
  let ambiguous = 0;
  for (const label of lexicon.values()) {
    if (label === "f") f += 1;
    else if (label === "m") m += 1;
    else ambiguous += 1;
  }
  return { f, m, ambiguous };
}

async function main(): Promise<void> {
  const retrievedAt = new Date().toISOString();

  process.stdout.write(`Descargando ${BUENOS_AIRES_SOURCE.url} ...\n`);
  const csvText = await fetchText(BUENOS_AIRES_SOURCE.url);

  const lexicon = buildGenderLexicon(csvText);
  const artifactHash = sha256Hex(serializeArtifact(lexicon));
  const counts = countByLabel(lexicon);

  process.stdout.write(
    `Léxico: ${lexicon.size} nombres (f=${counts.f}, m=${counts.m}, ambiguous=${counts.ambiguous}). ` +
      `sha256=${artifactHash}\n`,
  );

  const moduleSource = renderGeneratedModule(lexicon, {
    generatedAt: retrievedAt,
    sha256: artifactHash,
  });

  const provenance: Provenance = {
    generatedAt: retrievedAt,
    generator: "scripts/build-gender-lexicon.ts",
    source: { ...BUENOS_AIRES_SOURCE, retrievedAt },
    artifact: {
      modulePath: GENERATED_MODULE_REPO_PATH,
      sha256: artifactHash,
      entryCount: lexicon.size,
      counts,
    },
  };

  await mkdir(SHARED_SRC_DIR, { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });
  await writeFile(GENERATED_MODULE_PATH, moduleSource);
  await writeFile(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`);

  process.stdout.write(`Escrito: ${GENERATED_MODULE_PATH}\n`);
  process.stdout.write(`Escrito: ${PROVENANCE_PATH}\n`);
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isMainModule()) {
  try {
    await main();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
