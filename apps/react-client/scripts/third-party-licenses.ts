/**
 * Lógica pura del archivo de licencias de terceros (ADR-196): extraer el
 * paquete de un id de módulo, validar licencias, mapear los ids de
 * `assets.lock.json` a familias y armar el texto final.
 *
 * Sin `fs` ni Vite: todo lo que toca el disco vive en
 * `third-party-licenses-plugin.ts`. Separarlos deja testear las fallas de
 * ADR-196 §3 sin correr un build (`src/__tests__/third-party-licenses.test.ts`).
 */

/** Lista admitida (ADR-196 §3). Una licencia fuera de ella es decisión del planificador. */
export const ALLOWED_LICENSES: ReadonlyArray<string> = [
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Zlib",
  "BlueOak-1.0.0",
  "Python-2.0",
];

/**
 * Admite un identificador o una expresión SPDX: `AND` pide que todos sus
 * términos estén en la lista; `OR`, que alguno lo esté (`AND` ata más fuerte,
 * y los paréntesis agrupan). Una expresión mal formada no se admite.
 */
export function isAllowedLicense(license: string | null): boolean {
  if (license === null) return false;
  const tokens = license.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;

  const parseOr = (): boolean | null => {
    let result = parseAnd();
    while (result !== null && tokens[position] === "OR") {
      position += 1;
      const next = parseAnd();
      result = next === null ? null : result || next;
    }
    return result;
  };
  const parseAnd = (): boolean | null => {
    let result = parseTerm();
    while (result !== null && tokens[position] === "AND") {
      position += 1;
      const next = parseTerm();
      result = next === null ? null : result && next;
    }
    return result;
  };
  const parseTerm = (): boolean | null => {
    const token = tokens[position];
    if (token === undefined || token === ")" || token === "AND" || token === "OR") return null;
    position += 1;
    if (token === "(") {
      const inner = parseOr();
      if (inner === null || tokens[position] !== ")") return null;
      position += 1;
      return inner;
    }
    return ALLOWED_LICENSES.includes(token);
  };

  const result = parseOr();
  return result === true && position === tokens.length;
}

export interface PackageRef {
  readonly name: string;
  /** Raíz del paquete, con `/` como separador, sin `/` final. */
  readonly dir: string;
}

const NODE_MODULES = "/node_modules/";

/**
 * Paquete de `node_modules` al que pertenece un id de módulo de Rollup, o
 * `null` si el módulo no viene de `node_modules` (código propio, módulos
 * virtuales de Vite).
 *
 * Se toma el **último** `/node_modules/` del id: con el layout de pnpm el id
 * real es `.../node_modules/.pnpm/<x>@<v>/node_modules/<x>/...` y el paquete es
 * el de la derecha. Cubre scopes (`@scope/nombre`), ids con prefijo `\0`
 * (módulos virtuales de plugins) y sufijos `?query`.
 */
export function extractPackageFromModuleId(id: string): PackageRef | null {
  const path = (id.replace(/\0/g, "").split("?")[0] ?? "").replace(/\\/g, "/");
  const index = path.lastIndexOf(NODE_MODULES);
  if (index === -1) return null;

  const segments = path.slice(index + NODE_MODULES.length).split("/");
  const first = segments[0];
  if (first === undefined || first === "" || first.startsWith(".")) return null;

  let name = first;
  let depth = 1;
  if (first.startsWith("@")) {
    const second = segments[1];
    if (second === undefined || second === "") return null;
    name = `${first}/${second}`;
    depth = 2;
  }
  return {
    name,
    dir: path.slice(0, index + NODE_MODULES.length) + segments.slice(0, depth).join("/"),
  };
}

/** Los paquetes del workspace no son de terceros: no entran a la lista. */
export function isWorkspacePackage(name: string): boolean {
  return name.startsWith("@anonly/");
}

/**
 * Licencia declarada en un `package.json` ya parseado: `license` string,
 * `license: { type }` o `licenses: [{ type }]` con una sola entrada.
 */
export function readLicenseField(packageJson: unknown): string | null {
  if (typeof packageJson !== "object" || packageJson === null) return null;
  const record = packageJson as Readonly<Record<string, unknown>>;
  const direct = record["license"];
  if (typeof direct === "string" && direct !== "") return direct;
  if (typeof direct === "object" && direct !== null) {
    const type = (direct as Readonly<Record<string, unknown>>)["type"];
    if (typeof type === "string" && type !== "") return type;
  }
  const legacy = record["licenses"];
  if (Array.isArray(legacy) && legacy.length === 1) {
    const only: unknown = legacy[0];
    if (typeof only === "object" && only !== null) {
      const type = (only as Readonly<Record<string, unknown>>)["type"];
      if (typeof type === "string" && type !== "") return type;
    }
  }
  return null;
}

const LICENSE_FILE = /^(licen[cs]e|copying|unlicen[cs]e)([._-].*)?$/i;
const NOTICE_FILE = /^notice([._-].*)?$/i;

export function isLicenseFileName(name: string): boolean {
  return LICENSE_FILE.test(name);
}

export function isNoticeFileName(name: string): boolean {
  return NOTICE_FILE.test(name);
}

/** Texto de un archivo (de licencia o `NOTICE`) con el nombre que tenía. */
export interface TextFile {
  readonly name: string;
  readonly text: string;
}

/**
 * Texto de respaldo (ADR-196 §2bis) para un paquete que declara su licencia en
 * `package.json` pero no trae el archivo. Fija la versión: si la instalada
 * cambia, el build falla hasta que alguien revise el texto y actualice la fila.
 * Las rutas son relativas a la raíz del repo; cada archivo se tomó, sin
 * editar, del repositorio oficial del paquete (el origen exacto está en
 * `licenses/SOURCES.txt`).
 */
export interface BackupLicense {
  readonly name: string;
  readonly version: string;
  readonly licenseFile: string;
  readonly noticeFile?: string;
  /**
   * ADR-196 §2ter: el proyecto declara licencia pero no publica texto.
   * `licenseFile` es entonces el texto **estándar** de SPDX, y la entrada
   * generada lo rotula como tal (`renderDeclaredOnlyText`).
   */
  readonly declaredOnly?: true;
}

export const BACKUP_LICENSES: ReadonlyArray<BackupLicense> = [
  {
    name: "onnxruntime-web",
    version: "1.26.0-dev.20260416-b7804b056c",
    licenseFile: "apps/react-client/licenses/onnxruntime-LICENSE.txt",
    // Cubre el código de terceros que `dist` trae ya compilado y que no
    // aparece como módulo del bundle.
    noticeFile: "apps/react-client/licenses/onnxruntime-ThirdPartyNotices.txt",
  },
  {
    name: "onnxruntime-common",
    version: "1.24.3",
    licenseFile: "apps/react-client/licenses/onnxruntime-LICENSE.txt",
  },
  {
    // §2quater: embebido en el worker.min.js de tesseract.js; no está instalado.
    name: "buffer",
    version: "6.0.3",
    licenseFile: "apps/react-client/licenses/buffer-6.0.3-LICENSE.txt",
  },
  {
    name: "ieee754",
    version: "1.2.1",
    licenseFile: "apps/react-client/licenses/ieee754-1.2.1-LICENSE.txt",
  },
  {
    // §2ter: declara MIT y no publica texto; va el estándar de SPDX.
    name: "lazy-val",
    version: "1.0.5",
    licenseFile: "apps/react-client/licenses/MIT-standard.txt",
    declaredOnly: true,
  },
  {
    name: "react-remove-scroll-bar",
    version: "2.3.8",
    licenseFile: "apps/react-client/licenses/react-remove-scroll-bar-LICENSE.txt",
  },
];

/** Licencia, autor y repositorio tal como figuran en el `package.json`. */
export interface DeclaredMeta {
  readonly license: string | null;
  readonly author: string | null;
  readonly repository: string | null;
}

/** `author` como string o como `{ name, email }`; `null` si no figura. */
export function readAuthorField(packageJson: unknown): string | null {
  if (typeof packageJson !== "object" || packageJson === null) return null;
  const author = (packageJson as Readonly<Record<string, unknown>>)["author"];
  if (typeof author === "string" && author !== "") return author;
  if (typeof author === "object" && author !== null) {
    const name = (author as Readonly<Record<string, unknown>>)["name"];
    if (typeof name === "string" && name !== "") return name;
  }
  return null;
}

/** `repository` como string o como `{ url }`; `null` si no figura. */
export function readRepositoryField(packageJson: unknown): string | null {
  if (typeof packageJson !== "object" || packageJson === null) return null;
  const repository = (packageJson as Readonly<Record<string, unknown>>)["repository"];
  if (typeof repository === "string" && repository !== "") return repository;
  if (typeof repository === "object" && repository !== null) {
    const url = (repository as Readonly<Record<string, unknown>>)["url"];
    if (typeof url === "string" && url !== "") return url;
  }
  return null;
}

/**
 * Texto de una fila `declaredOnly` (ADR-196 §2ter): lo declarado por el
 * paquete, que el proyecto no publica un texto propio y el texto estándar de
 * SPDX con los campos de año y titular sin completar. No se escribe ningún
 * aviso de copyright.
 */
export function renderDeclaredOnlyText(meta: DeclaredMeta, standardText: string): string {
  const missing = "no figura en el package.json";
  return [
    `Licencia declarada en el package.json: ${meta.license ?? missing}`,
    `Autor, tal como figura en el package.json: ${meta.author ?? missing}`,
    `Repositorio, tal como figura en el package.json: ${meta.repository ?? missing}`,
    "",
    "El proyecto no publica un texto de licencia propio, ni en el paquete ni en su repositorio.",
    "A continuación, el texto ESTÁNDAR de esa licencia según SPDX, con los campos de año y",
    "titular sin completar. No es un aviso de copyright del autor.",
    "",
    standardText.trim(),
  ].join("\n");
}

/** Fila de respaldo para ese nombre (cualquier versión), si existe. */
export function findBackupForName(name: string): BackupLicense | null {
  return BACKUP_LICENSES.find((row) => row.name === name) ?? null;
}

/** Un paquete del bundle o del contenedor, ya leído del disco. */
export interface PackageInfo {
  readonly name: string;
  readonly version: string;
  /** Licencia declarada, o `null` si el `package.json` no declara ninguna. */
  readonly license: string | null;
  /** Autor y repositorio del `package.json`, para las filas `declaredOnly`. */
  readonly author?: string | null;
  readonly repository?: string | null;
  readonly licenseFiles: ReadonlyArray<TextFile>;
  readonly noticeFiles: ReadonlyArray<TextFile>;
}

/**
 * Las fallas de ADR-196 §3. Devuelve un mensaje por problema; vacío si
 * todo está bien. El plugin hace fallar el build si hay alguno.
 */
export function collectProblems(
  packages: ReadonlyArray<PackageInfo>,
  lockAssetIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const problems: string[] = [];
  for (const pkg of packages) {
    const label = `${pkg.name}@${pkg.version}`;
    for (const file of pkg.licenseFiles) {
      if (file.text.trim() === "") {
        problems.push(`${label}: el archivo de licencia "${file.name}" está vacío.`);
      }
    }
    if (pkg.licenseFiles.length === 0) {
      const backup = findBackupForName(pkg.name);
      if (backup === null) {
        problems.push(
          `${label}: no tiene archivo de licencia ni fila en la tabla de respaldo (ADR-196 §2bis).`,
        );
      } else if (backup.version !== pkg.version) {
        problems.push(
          `${label}: la fila de respaldo es de la versión ${backup.version}; revisar el texto y actualizarla (ADR-196 §2bis).`,
        );
      }
    }
    if (!isAllowedLicense(pkg.license)) {
      problems.push(
        `${label}: licencia ${pkg.license === null ? "no declarada" : `"${pkg.license}"`} fuera de la lista admitida (${ALLOWED_LICENSES.join(", ")}).`,
      );
    }
  }
  for (const id of lockAssetIds) {
    if (familyForAssetId(id) === null) {
      problems.push(
        `assets.lock.json: el id "${id}" no corresponde a ninguna familia de la tabla de ADR-196 §2.3.`,
      );
    }
  }
  return problems;
}

/** De dónde sale la versión de un componente de la tabla. */
export type StaticVersion =
  | { readonly fromPackage: true }
  | { readonly lockAssetId: string }
  | { readonly literal: string };

/**
 * De dónde sale el texto de un componente de la tabla: archivos de un paquete
 * instalado (`from` es la carpeta desde la que se resuelve, relativa a la raíz
 * del repo; `via` encadena paquetes intermedios, como pide pnpm para llegar a
 * una dependencia transitiva) o un archivo de texto commiteado en la app.
 */
export type StaticTextSource =
  | {
      readonly kind: "package";
      readonly pkg: string;
      readonly from: string;
      readonly via?: ReadonlyArray<string>;
      /** Rutas dentro del paquete. Sin ellas, los `LICENSE*` y `NOTICE*` de su raíz. */
      readonly files?: ReadonlyArray<string>;
    }
  | { readonly kind: "repo-file"; readonly file: string };

export interface StaticComponent {
  readonly name: string;
  readonly version: StaticVersion;
  /** Licencia escrita a mano: la tabla no pasa por la lista admitida (AFL-3.0, OFL). */
  readonly license: string;
  readonly source: StaticTextSource;
  /** Si el texto no sale del paquete del componente, de dónde sale (se imprime). */
  readonly note?: string;
}

export interface AssetFamily {
  /** Nombre de la familia, tal cual ADR-196 §2.3. */
  readonly family: string;
  /** Ids de `assets.lock.json` que cubre, o `null` si no viene del espejo. */
  readonly matchesAssetId: ((id: string) => boolean) | null;
  readonly components: ReadonlyArray<StaticComponent>;
}

const OCR = "packages/anonymization-core/ocr-engine";
const NER = "packages/anonymization-core/ner-engine";
const APP = "apps/react-client";

/** Versión de Sparkle que vendorea `apps/desktop-shell/native/scripts/fetch-sparkle.sh`. */
export const SPARKLE_VERSION = "2.9.4";

/**
 * Nota de `tesseract.js-core` (ADR-196 §2quinquies): lo observado en las
 * cadenas de los `.wasm`, sin afirmar versiones ni licencias y sin textos de
 * licencia de esas librerías.
 */
export const TESSERACT_CORE_NOTE =
  "Los binarios .wasm llevan compiladas, además de Tesseract, otras librerías de terceros. " +
  "Sus cadenas nombran Leptonica, libjpeg, libtiff y libwebp. " +
  "El proyecto no publica avisos de terceros. " +
  "Sus versiones y licencias no se pudieron verificar desde el binario, y no se afirman.";

/** Tabla de ADR-196 §2.3: una entrada por familia de lo que no pasa por el bundle. */
export const ASSET_FAMILIES: ReadonlyArray<AssetFamily> = [
  {
    family: "tesseract-worker",
    matchesAssetId: (id) => id === "tesseract-worker",
    components: [
      {
        name: "tesseract.js",
        version: { fromPackage: true },
        license: "Apache-2.0",
        source: { kind: "package", pkg: "tesseract.js", from: OCR },
      },
    ],
  },
  {
    family: "tesseract-core*",
    matchesAssetId: (id) => id.startsWith("tesseract-core"),
    components: [
      {
        name: "tesseract.js-core",
        version: { fromPackage: true },
        license: "Apache-2.0",
        source: { kind: "package", pkg: "tesseract.js-core", from: OCR, via: ["tesseract.js"] },
        note: TESSERACT_CORE_NOTE,
      },
    ],
  },
  {
    family: "tesseract-lang-*",
    matchesAssetId: (id) => id.startsWith("tesseract-lang-"),
    components: [
      {
        name: "tessdata (@tesseract.js-data: spa, eng, osd)",
        version: { lockAssetId: "tesseract-lang-spa" },
        license: "Apache-2.0",
        // No hay paquete instalado de los datos de idioma: se entrega el texto
        // de Apache-2.0 que trae el motor que los carga.
        source: { kind: "package", pkg: "tesseract.js-core", from: OCR, via: ["tesseract.js"] },
        note: "Texto de la licencia Apache-2.0 tomado del paquete tesseract.js-core.",
      },
    ],
  },
  {
    family: "ner-model-*",
    matchesAssetId: (id) => id.startsWith("ner-model-"),
    components: [
      {
        name: "bert-base-multilingual-cased-ner-hrl (Davlan; conversión ONNX de Xenova)",
        version: { lockAssetId: "ner-model-config" },
        license: "AFL-3.0",
        source: { kind: "repo-file", file: `${APP}/licenses/AFL-3.0.txt` },
      },
    ],
  },
  {
    family: "onnxruntime-*",
    matchesAssetId: (id) => id.startsWith("onnxruntime-"),
    components: [
      {
        name: "onnxruntime-web",
        version: { fromPackage: true },
        license: "MIT",
        source: {
          kind: "package",
          pkg: "onnxruntime-web",
          from: NER,
          via: ["@huggingface/transformers"],
        },
      },
    ],
  },
  {
    family: "pdf.js: cMaps y fuentes estándar",
    matchesAssetId: null,
    components: [
      {
        name: "pdfjs-dist",
        version: { fromPackage: true },
        license: "Apache-2.0",
        source: { kind: "package", pkg: "pdfjs-dist", from: APP },
      },
      {
        name: "pdf.js cMaps",
        version: { fromPackage: true },
        license: "BSD-3-Clause",
        source: { kind: "package", pkg: "pdfjs-dist", from: APP, files: ["cmaps/LICENSE"] },
      },
      {
        name: "pdf.js fuentes estándar",
        version: { fromPackage: true },
        license: "BSD-3-Clause y SIL OFL 1.1",
        source: {
          kind: "package",
          pkg: "pdfjs-dist",
          from: APP,
          files: ["standard_fonts/LICENSE_FOXIT", "standard_fonts/LICENSE_LIBERATION"],
        },
      },
    ],
  },
  {
    family: "Sparkle (solo macOS)",
    matchesAssetId: null,
    components: [
      {
        name: "Sparkle",
        version: { literal: SPARKLE_VERSION },
        license: "MIT, con avisos de terceros",
        source: {
          kind: "repo-file",
          file: `${APP}/licenses/Sparkle-${SPARKLE_VERSION}-LICENSE.txt`,
        },
      },
    ],
  },
];

export function familyForAssetId(id: string): AssetFamily | null {
  return ASSET_FAMILIES.find((family) => family.matchesAssetId?.(id) === true) ?? null;
}

/** Un componente listo para imprimir. */
export interface LicenseEntry {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly note?: string;
  readonly licenseFiles: ReadonlyArray<TextFile>;
  readonly noticeFiles: ReadonlyArray<TextFile>;
}

const RULE = "=".repeat(80);
const THIN = "-".repeat(80);

/**
 * Ordena por nombre y versión y funde los duplicados exactos (nombre +
 * versión): gana la primera entrada, pero las notas de las demás se conservan
 * en ella (ADR-196 §2quater: la entrada de un embebido dice de dónde sale su
 * versión, aunque el mismo paquete también entre como módulo del bundle).
 */
export function sortAndDedupe(entries: ReadonlyArray<LicenseEntry>): ReadonlyArray<LicenseEntry> {
  const byKey = new Map<string, LicenseEntry>();
  for (const entry of entries) {
    const key = `${entry.name}@${entry.version}`;
    const kept = byKey.get(key);
    if (kept === undefined) {
      byKey.set(key, entry);
    } else if (entry.note !== undefined && !(kept.note ?? "").includes(entry.note)) {
      byKey.set(key, {
        ...kept,
        note: kept.note === undefined ? entry.note : `${kept.note} ${entry.note}`,
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
  );
}

/** Arma el contenido de `THIRD_PARTY_LICENSES.txt`. */
export function renderLicenseFile(entries: ReadonlyArray<LicenseEntry>): string {
  const sorted = sortAndDedupe(entries);
  const out: string[] = [
    "Anonly — Licencias de software y modelos de terceros",
    "",
    "Este archivo se genera en cada build (ADR-196). Reúne el nombre, la versión, la licencia",
    "y el texto completo de la licencia de cada componente de terceros que el instalador",
    "distribuye, incluidas las dependencias internas. Las licencias de Electron y de Chromium",
    "van aparte, en LICENSE.electron.txt y LICENSES.chromium.html.",
    "",
    `Componentes: ${sorted.length}`,
    "",
  ];
  for (const entry of sorted) {
    out.push(RULE, `${entry.name} ${entry.version}`, `Licencia: ${entry.license}`);
    if (entry.note !== undefined) out.push(entry.note);
    for (const file of entry.licenseFiles) {
      out.push(THIN, `[${file.name}]`, "", file.text.trim());
    }
    for (const file of entry.noticeFiles) {
      out.push(THIN, `[${file.name}]`, "", file.text.trim());
    }
    out.push("");
  }
  return `${out.join("\n")}\n`;
}

/** Módulos de un chunk de Rollup: lo único que el registro necesita de ellos. */
export type RenderedModules = Readonly<Record<string, { readonly renderedLength: number }>>;

/** Forma mínima de un `OutputBundle` de Rollup (assets y chunks). */
export type BundleLike = Readonly<
  Record<string, { readonly type: string; readonly modules?: RenderedModules }>
>;

/**
 * Registro de los paquetes de `node_modules` que entran a los bundles.
 *
 * El plugin principal y el de los workers **comparten uno solo**: los workers
 * se construyen aparte y no pasan por los hooks del principal (ver
 * `third-party-licenses-plugin.ts`).
 */
export interface BundleRegistry {
  /** Raíz del paquete -> nombre. */
  readonly bundled: ReadonlyMap<string, string>;
  collect(bundle: BundleLike): void;
}

export function createBundleRegistry(): BundleRegistry {
  const bundled = new Map<string, string>();
  return {
    bundled,
    collect(bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk" || output.modules === undefined) continue;
        for (const [id, info] of Object.entries(output.modules)) {
          // Un módulo con `renderedLength === 0` quedó sin código en el chunk
          // (tree-shaking total), así que no viaja y no se acredita. Lo que
          // este criterio NO cubre: un módulo que aporta código mínimo (un
          // `export {}` o una constante) cuenta como incluido aunque casi no
          // haya nada suyo; acreditar de más es el lado seguro. Tampoco cubre
          // lo contrario: un paquete que entra solo por CSS (una hoja de
          // estilos importada desde `node_modules`) no aporta ningún módulo
          // JS a un chunk y no quedaría registrado.
          if (info.renderedLength === 0) continue;
          const ref = extractPackageFromModuleId(id);
          if (ref === null || isWorkspacePackage(ref.name)) continue;
          bundled.set(ref.dir, ref.name);
        }
      }
    },
  };
}

/**
 * Paquete que llega **ya compilado dentro del `dist` de otro** (ADR-196
 * §2quater): no aparece como módulo del bundle y por eso se lista aparte.
 */
export interface EmbeddedPackage {
  readonly name: string;
  /** Licencia que declara el paquete; se valida contra la lista admitida. */
  readonly license: string;
  /**
   * Versión que trae el artefacto, si se conoce y difiere de la instalada, o
   * si el paquete no está instalado (entonces es obligatoria y la fila de
   * `BACKUP_LICENSES` tiene que ser de esa versión).
   */
  readonly embeddedVersion?: string;
  /**
   * `true` si el propio artefacto nombra la versión (p. ej. un comentario con
   * la ruta `.../paquete@x.y.z/...`); sin esto la versión es una suposición.
   */
  readonly versionVerifiedInArtifact?: true;
}

/** Un anfitrión de embebidos, con su versión fijada (ADR-196 §2quater.2). */
export interface EmbeddingHost {
  readonly name: string;
  /** Si la versión instalada cambia, el build falla hasta repetir la auditoría. */
  readonly version: string;
  /** Carpeta desde la que se resuelve el anfitrión, relativa a la raíz del repo. */
  readonly from: string;
  /** Archivos de avisos junto al artefacto, relativos a la raíz del paquete (§2quater.1). */
  readonly artifactNotices: ReadonlyArray<string>;
  readonly embedded: ReadonlyArray<EmbeddedPackage>;
}

/**
 * Tabla de embebidos, armada auditando cada artefacto precompilado uno por uno.
 * Qué se miró y qué se encontró en cada uno: `licenses/AUDITORIA-EMBEBIDOS.txt`.
 */
export const EMBEDDING_HOSTS: ReadonlyArray<EmbeddingHost> = [
  {
    // transformers.web.js: el único dist de transformers que entra al bundle.
    name: "@huggingface/transformers",
    version: "4.2.0",
    from: "packages/anonymization-core/ner-engine",
    artifactNotices: [],
    embedded: [
      {
        name: "@huggingface/tokenizers",
        license: "Apache-2.0",
        embeddedVersion: "0.1.3",
        versionVerifiedInArtifact: true,
      },
      // El artefacto embebe 0.5.6; el instalado como hermano es 0.5.9.
      {
        name: "@huggingface/jinja",
        license: "MIT",
        embeddedVersion: "0.5.6",
        versionVerifiedInArtifact: true,
      },
    ],
  },
  {
    // worker.min.js (el asset espejado `tesseract-worker`): su mapa de fuentes
    // lista nueve paquetes; su worker.min.js.LICENSE.txt solo nombra cuatro.
    name: "tesseract.js",
    version: "6.0.1",
    from: "packages/anonymization-core/ocr-engine",
    artifactNotices: ["dist/worker.min.js.LICENSE.txt"],
    embedded: [
      // Dependencia de `buffer@6.0.3` (^1.3.1), no de tesseract.js: se fija para que
      // no dependa de qué otro paquete la hace visible.
      { name: "base64-js", license: "MIT", embeddedVersion: "1.5.1" },
      { name: "bmp-js", license: "MIT" },
      // `buffer` y `ieee754` no están instalados: se acreditan con la tabla de
      // respaldo. 6.0.3 es la devDependency de tesseract.js (`buffer@^6.0.3`) y
      // 1.2.1 la de `buffer@6.0.3`.
      { name: "buffer", license: "MIT", embeddedVersion: "6.0.3" },
      { name: "idb-keyval", license: "Apache-2.0" },
      { name: "ieee754", license: "BSD-3-Clause", embeddedVersion: "1.2.1" },
      { name: "is-url", license: "MIT" },
      { name: "regenerator-runtime", license: "MIT" },
      { name: "wasm-feature-detect", license: "Apache-2.0" },
      { name: "zlibjs", license: "MIT" },
    ],
  },
];

/**
 * Fallas de la tabla de embebidos (ADR-196 §2quater.2, §3): un anfitrión
 * instalado en otra versión que la fijada, o no instalado; y un embebido con
 * licencia fuera de la lista. `installed` mapea anfitrión -> versión instalada
 * (o `null` si no se encontró).
 */
export function collectHostProblems(
  installed: ReadonlyMap<string, string | null>,
): ReadonlyArray<string> {
  const problems: string[] = [];
  for (const host of EMBEDDING_HOSTS) {
    const found = installed.get(host.name) ?? null;
    if (found === null) {
      problems.push(`${host.name}: anfitrión de embebidos no instalado (ADR-196 §2quater).`);
    } else if (found !== host.version) {
      problems.push(
        `${host.name}@${found}: la tabla de embebidos fija la versión ${host.version}; auditar qué trae adentro la versión nueva y actualizar la fila (ADR-196 §2quater).`,
      );
    }
    for (const embedded of host.embedded) {
      if (!isAllowedLicense(embedded.license)) {
        problems.push(
          `${embedded.name} (embebido en ${host.name}): licencia "${embedded.license}" fuera de la lista admitida.`,
        );
      }
    }
  }
  return problems;
}

/** Entradas con un archivo de licencia vacío (ADR-196 §3). */
export function collectEmptyTextProblems(
  entries: ReadonlyArray<Pick<LicenseEntry, "name" | "version" | "licenseFiles">>,
): ReadonlyArray<string> {
  const problems: string[] = [];
  for (const entry of entries) {
    for (const file of entry.licenseFiles) {
      if (file.text.trim() === "") {
        problems.push(
          `${entry.name}@${entry.version}: el archivo de licencia "${file.name}" está vacío.`,
        );
      }
    }
  }
  return problems;
}
