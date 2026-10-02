import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_LICENSES,
  ASSET_FAMILIES,
  BACKUP_LICENSES,
  EMBEDDING_HOSTS,
  SPARKLE_VERSION,
  TESSERACT_CORE_NOTE,
  collectEmptyTextProblems,
  collectHostProblems,
  collectProblems,
  createBundleRegistry,
  extractPackageFromModuleId,
  familyForAssetId,
  isAllowedLicense,
  isLicenseFileName,
  isNoticeFileName,
  isWorkspacePackage,
  readAuthorField,
  readLicenseField,
  readRepositoryField,
  renderDeclaredOnlyText,
  renderLicenseFile,
  sortAndDedupe,
  type PackageInfo,
} from "../../scripts/third-party-licenses.js";
import { THIRD_PARTY_SOFTWARE } from "../components/toolbar/thirdPartySoftware.js";

function fromRepo(relative: string): string {
  return fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));
}

function pkg(overrides: Partial<PackageInfo> = {}): PackageInfo {
  return {
    name: "ejemplo",
    version: "1.0.0",
    license: "MIT",
    licenseFiles: [{ name: "LICENSE", text: "texto" }],
    noticeFiles: [],
    ...overrides,
  };
}

function readLockAssetIds(): ReadonlyArray<string> {
  const lock: unknown = JSON.parse(readFileSync(fromRepo("assets.lock.json"), "utf-8"));
  const assets = (lock as { readonly assets: ReadonlyArray<{ readonly id: string }> }).assets;
  return assets.map((asset) => asset.id);
}

describe("extractPackageFromModuleId", () => {
  it("toma el paquete de una ruta común de node_modules", () => {
    expect(extractPackageFromModuleId("/repo/node_modules/zustand/esm/index.mjs")).toEqual({
      name: "zustand",
      dir: "/repo/node_modules/zustand",
    });
  });

  it("respeta los scopes", () => {
    expect(
      extractPackageFromModuleId("/repo/node_modules/@radix-ui/react-dialog/dist/index.mjs"),
    ).toEqual({ name: "@radix-ui/react-dialog", dir: "/repo/node_modules/@radix-ui/react-dialog" });
  });

  it("con el layout de pnpm toma el paquete de la derecha, no la carpeta .pnpm", () => {
    expect(
      extractPackageFromModuleId(
        "C:/r/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/index.js",
      ),
    ).toEqual({
      name: "react-dom",
      dir: "C:/r/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom",
    });
    expect(
      extractPackageFromModuleId(
        "/r/node_modules/.pnpm/@floating-ui+dom@1.7.6/node_modules/@floating-ui/dom/dist/x.mjs",
      )?.name,
    ).toBe("@floating-ui/dom");
  });

  it("normaliza barras de Windows, el prefijo \\0 y el sufijo ?query", () => {
    expect(
      extractPackageFromModuleId(
        "\0C:\\r\\node_modules\\lucide-react\\dist\\esm\\x.js?commonjs-proxy",
      ),
    ).toEqual({ name: "lucide-react", dir: "C:/r/node_modules/lucide-react" });
  });

  it("devuelve null para código propio, módulos virtuales y rutas sin paquete", () => {
    expect(extractPackageFromModuleId("/repo/apps/react-client/src/main.tsx")).toBeNull();
    expect(extractPackageFromModuleId("\0vite/preload-helper.js")).toBeNull();
    expect(extractPackageFromModuleId("/r/node_modules/.pnpm")).toBeNull();
    expect(extractPackageFromModuleId("/r/node_modules/@scope")).toBeNull();
  });

  it("los paquetes del workspace no son de terceros", () => {
    expect(isWorkspacePackage("@anonly/pdf-engine")).toBe(true);
    expect(isWorkspacePackage("@radix-ui/react-dialog")).toBe(false);
  });
});

describe("licencias admitidas y archivos de licencia", () => {
  it("la lista admitida es la de ADR-196 §3", () => {
    expect(ALLOWED_LICENSES).toEqual([
      "MIT",
      "ISC",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "0BSD",
      "Zlib",
      "BlueOak-1.0.0",
      "Python-2.0",
    ]);
    expect(isAllowedLicense("MIT")).toBe(true);
    expect(isAllowedLicense("Zlib")).toBe(true);
    expect(isAllowedLicense("BlueOak-1.0.0")).toBe(true);
    expect(isAllowedLicense("Python-2.0")).toBe(true);
    expect(isAllowedLicense("AFL-3.0")).toBe(false);
    expect(isAllowedLicense(null)).toBe(false);
  });

  it("las expresiones AND piden todos los términos y las OR, alguno", () => {
    expect(isAllowedLicense("(MIT AND Zlib)")).toBe(true);
    expect(isAllowedLicense("MIT AND GPL-3.0")).toBe(false);
    expect(isAllowedLicense("GPL-3.0 OR MIT")).toBe(true);
    expect(isAllowedLicense("GPL-3.0 OR LGPL-2.1")).toBe(false);
    expect(isAllowedLicense("MIT OR GPL-3.0 AND LGPL-2.1")).toBe(true);
    expect(isAllowedLicense("(GPL-3.0 OR MIT) AND ISC")).toBe(true);
    expect(isAllowedLicense("(GPL-3.0 OR MIT) AND AGPL-3.0")).toBe(false);
    expect(isAllowedLicense("MIT AND")).toBe(false);
    expect(isAllowedLicense("(MIT")).toBe(false);
    expect(isAllowedLicense("")).toBe(false);
  });

  it("lee la licencia declarada en sus tres formas", () => {
    expect(readLicenseField({ license: "ISC" })).toBe("ISC");
    expect(readLicenseField({ license: { type: "MIT" } })).toBe("MIT");
    expect(readLicenseField({ licenses: [{ type: "Apache-2.0" }] })).toBe("Apache-2.0");
    expect(readLicenseField({})).toBeNull();
    expect(readLicenseField(null)).toBeNull();
  });

  it("reconoce los nombres de archivos de licencia y de NOTICE", () => {
    for (const name of [
      "LICENSE",
      "LICENSE.md",
      "license.txt",
      "LICENCE",
      "COPYING",
      "LICENSE-MIT",
    ]) {
      expect(isLicenseFileName(name), name).toBe(true);
    }
    for (const name of ["README.md", "licenses.json", "package.json"]) {
      expect(isLicenseFileName(name), name).toBe(false);
    }
    expect(isNoticeFileName("NOTICE")).toBe(true);
    expect(isNoticeFileName("NOTICE.txt")).toBe(true);
    expect(isNoticeFileName("LICENSE")).toBe(false);
  });
});

describe("collectProblems (las tres fallas de ADR-196 §3)", () => {
  it("no informa nada cuando todo está en regla", () => {
    expect(collectProblems([pkg()], ["tesseract-worker"])).toEqual([]);
  });

  it("falla si un paquete no tiene archivo de licencia", () => {
    const problems = collectProblems([pkg({ name: "sin-archivo", licenseFiles: [] })], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sin-archivo@1.0.0");
    expect(problems[0]).toContain("archivo de licencia");
  });

  it("falla si un paquete sin archivo no tiene fila de respaldo", () => {
    const problems = collectProblems([pkg({ name: "huerfano", licenseFiles: [] })], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("huerfano@1.0.0");
    expect(problems[0]).toContain("respaldo");
  });

  it("falla si la fila de respaldo es de otra versión, y pasa si es la misma", () => {
    const row = BACKUP_LICENSES[0];
    expect(row).toBeDefined();
    const base = { name: row?.name ?? "", licenseFiles: [] };
    const stale = collectProblems([pkg({ ...base, version: "9.9.9" })], []);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain(row?.version ?? "");
    expect(collectProblems([pkg({ ...base, version: row?.version ?? "" })], [])).toEqual([]);
  });

  it("un paquete que sí trae archivo no mira la tabla de respaldo", () => {
    const row = BACKUP_LICENSES[0];
    expect(collectProblems([pkg({ name: row?.name ?? "", version: "9.9.9" })], [])).toEqual([]);
  });

  it("los textos de respaldo commiteados existen y no están vacíos", () => {
    for (const row of BACKUP_LICENSES) {
      for (const file of [row.licenseFile, row.noticeFile]) {
        if (file === undefined) continue;
        expect(readFileSync(fromRepo(file), "utf-8").trim().length, file).toBeGreaterThan(0);
      }
    }
  });

  it("falla si la licencia declarada no está admitida o no está declarada", () => {
    const problems = collectProblems(
      [pkg({ name: "gpl", license: "GPL-3.0" }), pkg({ name: "nada", license: null })],
      [],
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("GPL-3.0");
    expect(problems[1]).toContain("no declarada");
  });

  it("falla si un id de assets.lock.json no cae en ninguna familia", () => {
    const problems = collectProblems([], ["tesseract-worker", "asset-nuevo"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("asset-nuevo");
  });
});

describe("fila declaredOnly (ADR-196 §2ter)", () => {
  const row = BACKUP_LICENSES.find((entry) => entry.declaredOnly === true);

  it("hay una sola, la de lazy-val@1.0.5, y apunta al texto estándar de SPDX", () => {
    expect(BACKUP_LICENSES.filter((entry) => entry.declaredOnly === true)).toHaveLength(1);
    expect(row?.name).toBe("lazy-val");
    expect(row?.version).toBe("1.0.5");
    const standard = readFileSync(fromRepo(row?.licenseFile ?? ""), "utf-8");
    expect(standard).toContain("<year>");
    expect(standard).toContain("<copyright holders>");
  });

  it("con la misma versión no falla; con otra, sí", () => {
    const base = { name: "lazy-val", licenseFiles: [] };
    expect(collectProblems([pkg({ ...base, version: "1.0.5" })], [])).toEqual([]);
    const stale = collectProblems([pkg({ ...base, version: "1.0.6" })], []);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toContain("1.0.5");
  });

  it("la entrada rotula el texto estándar, copia lo declarado y no completa el copyright", () => {
    const standard = readFileSync(fromRepo(row?.licenseFile ?? ""), "utf-8");
    const text = renderDeclaredOnlyText(
      { license: "MIT", author: "Autor Ejemplo", repository: "org/repo" },
      standard,
    );
    expect(text).toContain("MIT");
    expect(text).toContain("Autor Ejemplo");
    expect(text).toContain("org/repo");
    expect(text).toContain("no publica un texto de licencia propio");
    expect(text).toContain("ESTÁNDAR");
    expect(text).toContain("<year>");
    expect(text).not.toMatch(/Copyright \(c\) \d{4}/);
  });

  it("lee autor y repositorio del package.json en sus formas", () => {
    expect(readAuthorField({ author: "A B" })).toBe("A B");
    expect(readAuthorField({ author: { name: "C D" } })).toBe("C D");
    expect(readAuthorField({})).toBeNull();
    expect(readRepositoryField({ repository: "o/r" })).toBe("o/r");
    expect(readRepositoryField({ repository: { url: "git+https://x/y.git" } })).toBe(
      "git+https://x/y.git",
    );
    expect(readRepositoryField({})).toBeNull();
  });
});

describe("archivo de licencia vacío (ADR-196 §3)", () => {
  it("un LICENSE vacío o en blanco falla, aunque exista", () => {
    const problems = collectProblems(
      [pkg({ name: "vacio", licenseFiles: [{ name: "LICENSE", text: " \n\t" }] })],
      [],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("vacío");
  });

  it("también falla sobre las entradas finales (respaldo, tabla, embebidos)", () => {
    const entry = {
      name: "x",
      version: "1.0.0",
      licenseFiles: [{ name: "LICENSE.txt", text: "" }],
    };
    expect(collectEmptyTextProblems([entry])).toHaveLength(1);
    expect(
      collectEmptyTextProblems([{ ...entry, licenseFiles: [{ name: "LICENSE", text: "ok" }] }]),
    ).toEqual([]);
  });
});

describe("registro de bundles compartido (worker.plugins)", () => {
  const worker = {
    "w.js": { type: "chunk", modules: { "/r/node_modules/zlibjs/a.js": { renderedLength: 5 } } },
  };
  const main = {
    "m.js": { type: "chunk", modules: { "/r/node_modules/react/index.js": { renderedLength: 9 } } },
  };

  it("lo que registra el bundle del worker lo ve quien arma el archivo desde el principal", () => {
    const registry = createBundleRegistry();
    // Dos consumidores del mismo estado, como el plugin principal y el de worker.
    const collectFromWorker = (): void => registry.collect(worker);
    const collectFromMain = (): void => registry.collect(main);
    collectFromWorker();
    collectFromMain();
    expect([...registry.bundled.values()].sort()).toEqual(["react", "zlibjs"]);
  });

  it("ignora assets, módulos propios, del workspace y sin código renderizado", () => {
    const registry = createBundleRegistry();
    registry.collect({
      "a.png": { type: "asset" },
      "c.js": {
        type: "chunk",
        modules: {
          "/r/apps/react-client/src/main.tsx": { renderedLength: 10 },
          "/r/node_modules/@anonly/pdf-engine/x.js": { renderedLength: 10 },
          "/r/node_modules/vacio/x.js": { renderedLength: 0 },
        },
      },
    });
    expect(registry.bundled.size).toBe(0);
  });

  // Si `vite.config.ts` deja de pasar `licenses.worker` a `worker.plugins`, los
  // paquetes que solo entran por los workers (p. ej. @huggingface/transformers)
  // desaparecen del archivo sin que falle nada más.
  it("vite.config.ts registra el plugin en worker.plugins", () => {
    const config = readFileSync(fromRepo("apps/react-client/vite.config.ts"), "utf-8");
    expect(config).toMatch(/worker:\s*\{[^}]*plugins:\s*licenses\.worker/s);
    expect(config).toMatch(/plugins:\s*\[[^\]]*licenses\.main/s);
  });
});

describe("licenses/SOURCES.txt (ADR-196 §2bis)", () => {
  const dir = "apps/react-client/licenses";
  const sources = readFileSync(fromRepo(`${dir}/SOURCES.txt`), "utf-8");
  const blocks = [
    ...sources.matchAll(/^(\S+\.txt)\n {2}url: .*\n {2}commit: (\S+)\n {2}sha256: (\S+)\n/gm),
  ];

  it("cada archivo de la tabla de respaldo y de familias figura con commit completo y sha256 vigente", () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const [, file, commit, sha256] of blocks) {
      expect(commit, `${file}: commit`).toMatch(/^[0-9a-f]{40}$/);
      const actual = createHash("sha256")
        .update(readFileSync(fromRepo(`${dir}/${file ?? ""}`)))
        .digest("hex");
      expect(actual, `${file}: sha256`).toBe(sha256);
    }
  });

  it("no queda ningún texto commiteado sin registrar", () => {
    const listed = new Set(blocks.map((block) => block[1]));
    const files = readdirSync(fromRepo(dir)).filter((name) => name.endsWith(".txt"));
    for (const name of files) {
      if (name === "SOURCES.txt" || name === "AUDITORIA-EMBEBIDOS.txt") continue;
      expect(listed.has(name), `${name} falta en SOURCES.txt`).toBe(true);
    }
  });
});

describe("sortAndDedupe (ADR-196 §2quater)", () => {
  const base = { license: "MIT", licenseFiles: [], noticeFiles: [] };

  it("al deduplicar conserva la nota del embebido en la entrada que queda", () => {
    const merged = sortAndDedupe([
      { ...base, name: "regenerator-runtime", version: "0.13.11" },
      { ...base, name: "regenerator-runtime", version: "0.13.11", note: "Embebido en X." },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.note).toBe("Embebido en X.");
  });

  it("junta las notas si las dos entradas tienen una, y no repite una igual", () => {
    const merged = sortAndDedupe([
      { ...base, name: "p", version: "1", note: "A." },
      { ...base, name: "p", version: "1", note: "B." },
      { ...base, name: "p", version: "1", note: "B." },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.note).toBe("A. B.");
  });
});

describe("nota de tesseract.js-core (ADR-196 §2quinquies)", () => {
  const component = ASSET_FAMILIES.flatMap((family) => family.components).find(
    (entry) => entry.name === "tesseract.js-core",
  );

  it("la entrada lleva la nota, con lo observado y sin afirmar versiones ni licencias", () => {
    expect(component?.note).toBe(TESSERACT_CORE_NOTE);
    for (const library of ["Leptonica", "libjpeg", "libtiff", "libwebp"]) {
      expect(TESSERACT_CORE_NOTE).toContain(library);
    }
    expect(TESSERACT_CORE_NOTE).toContain("no publica avisos de terceros");
    expect(TESSERACT_CORE_NOTE).toContain("no se pudieron verificar");
    // Nada que no se haya observado, y ningún texto de licencia.
    expect(TESSERACT_CORE_NOTE).not.toMatch(/libpng|zlib|IJG|Permission is hereby granted/i);
  });

  it.skipIf(!existsSync(distCoreFile()))("la nota llega al archivo generado", () => {
    const text = readFileSync(distCoreFile(), "utf-8");
    const start = text.indexOf("\ntesseract.js-core ");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(text.slice(start, start + 600)).toContain(TESSERACT_CORE_NOTE);
  });

  it.skipIf(!existsSync(distCoreFile()))(
    "cada embebido lleva su nota y dice de dónde sale su versión (los 11)",
    () => {
      const text = readFileSync(distCoreFile(), "utf-8");
      const sections = text.split(`
${"=".repeat(80)}
`);
      let checked = 0;
      for (const host of EMBEDDING_HOSTS) {
        for (const embedded of host.embedded) {
          const section = sections.find((s) => s.startsWith(`${embedded.name} `));
          expect(section, `${embedded.name}: no hay entrada`).toBeDefined();
          // Solo el encabezado de la entrada, antes de los textos de licencia.
          const header =
            (section ?? "").split(`
${"-".repeat(80)}
`)[0] ?? "";
          expect(header, embedded.name).toContain(
            `Embebido, ya compilado, en ${host.name}@${host.version}.`,
          );
          expect(header, embedded.name).toMatch(/Versión \S+: (verificada|se asume|la declara)/);
          checked += 1;
        }
      }
      expect(checked).toBe(11);
    },
  );
});

function distCoreFile(): string {
  return fromRepo("apps/react-client/dist/licenses/THIRD_PARTY_LICENSES.txt");
}

describe("tabla de embebidos (ADR-196 §2quater)", () => {
  const installedOk = new Map(EMBEDDING_HOSTS.map((host) => [host.name, host.version]));

  it("cubre los casos conocidos del anfitrión", () => {
    const transformers = EMBEDDING_HOSTS.find((h) => h.name === "@huggingface/transformers");
    const tesseract = EMBEDDING_HOSTS.find((h) => h.name === "tesseract.js");
    const names = (host: typeof tesseract): ReadonlyArray<string> =>
      host?.embedded.map((e) => e.name) ?? [];
    expect([...names(transformers)].sort()).toEqual([
      "@huggingface/jinja",
      "@huggingface/tokenizers",
    ]);
    expect([...names(tesseract)].sort()).toEqual([
      "base64-js",
      "bmp-js",
      "buffer",
      "idb-keyval",
      "ieee754",
      "is-url",
      "regenerator-runtime",
      "wasm-feature-detect",
      "zlibjs",
    ]);
    expect(tesseract?.artifactNotices).toContain("dist/worker.min.js.LICENSE.txt");
  });

  it("no informa nada si los anfitriones están en la versión fijada", () => {
    expect(collectHostProblems(installedOk)).toEqual([]);
  });

  it("falla si un anfitrión está instalado en otra versión", () => {
    const changed = new Map(installedOk).set("tesseract.js", "7.0.0");
    const problems = collectHostProblems(changed);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("tesseract.js@7.0.0");
    expect(problems[0]).toContain("6.0.1");
  });

  it("falla si un anfitrión no está instalado", () => {
    const missing = new Map<string, string | null>(installedOk).set("tesseract.js", null);
    expect(collectHostProblems(missing)).toHaveLength(1);
  });

  it("todo embebido tiene licencia admitida, y los no instalados tienen fila de respaldo de su versión", () => {
    for (const host of EMBEDDING_HOSTS) {
      for (const embedded of host.embedded) {
        expect(isAllowedLicense(embedded.license), embedded.name).toBe(true);
      }
    }
    for (const name of ["buffer", "ieee754"]) {
      const embedded = EMBEDDING_HOSTS.flatMap((h) => h.embedded).find((e) => e.name === name);
      const backup = BACKUP_LICENSES.find((row) => row.name === name);
      expect(embedded?.embeddedVersion, name).toBeDefined();
      expect(backup?.version, name).toBe(embedded?.embeddedVersion);
    }
  });
});

describe("tabla de familias (ADR-196 §2.3)", () => {
  it("cada id del assets.lock.json real cae en una familia", () => {
    const ids = readLockAssetIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(familyForAssetId(id), `el id ${id} no tiene familia`).not.toBeNull();
    }
    expect(collectProblems([], ids)).toEqual([]);
  });

  it("mapea los ids a la familia correcta", () => {
    expect(familyForAssetId("tesseract-worker")?.family).toBe("tesseract-worker");
    expect(familyForAssetId("tesseract-core-simd-lstm")?.family).toBe("tesseract-core*");
    expect(familyForAssetId("tesseract-lang-osd")?.family).toBe("tesseract-lang-*");
    expect(familyForAssetId("ner-model-vocab")?.family).toBe("ner-model-*");
    expect(familyForAssetId("onnxruntime-wasm-simd-threaded-asyncify-wasm")?.family).toBe(
      "onnxruntime-*",
    );
    expect(familyForAssetId("otra-cosa")).toBeNull();
  });

  it("toda familia tiene al menos un componente con licencia", () => {
    for (const family of ASSET_FAMILIES) {
      expect(family.components.length).toBeGreaterThan(0);
      for (const component of family.components) {
        expect(component.license.length).toBeGreaterThan(0);
      }
    }
  });

  it("la versión de Sparkle coincide con la que vendorea fetch-sparkle.sh", () => {
    const script = readFileSync(
      fromRepo("apps/desktop-shell/native/scripts/fetch-sparkle.sh"),
      "utf-8",
    );
    expect(script).toContain(`SPARKLE_VERSION="${SPARKLE_VERSION}"`);
  });

  it("los textos de licencia commiteados existen y no están vacíos", () => {
    for (const file of [
      "apps/react-client/licenses/AFL-3.0.txt",
      `apps/react-client/licenses/Sparkle-${SPARKLE_VERSION}-LICENSE.txt`,
    ]) {
      expect(readFileSync(fromRepo(file), "utf-8").trim().length, file).toBeGreaterThan(0);
    }
  });
});

describe("renderLicenseFile", () => {
  it("lleva nombre, versión, licencia, texto y NOTICE de cada componente, sin duplicados", () => {
    const alfa = {
      name: "alfa",
      version: "1.0.0",
      license: "MIT",
      licenseFiles: [{ name: "LICENSE.md", text: "TEXTO-ALFA" }],
      noticeFiles: [],
    };
    const text = renderLicenseFile([
      {
        name: "zeta",
        version: "2.0.0",
        license: "Apache-2.0",
        licenseFiles: [{ name: "LICENSE", text: "TEXTO-ZETA" }],
        noticeFiles: [{ name: "NOTICE", text: "AVISO-ZETA" }],
      },
      alfa,
      alfa,
    ]);
    expect(text).toContain("alfa 1.0.0");
    expect(text).toContain("Licencia: Apache-2.0");
    expect(text).toContain("TEXTO-ZETA");
    expect(text).toContain("AVISO-ZETA");
    expect(text.match(/TEXTO-ALFA/g)).toHaveLength(1);
    expect(text.indexOf("alfa 1.0.0")).toBeLessThan(text.indexOf("zeta 2.0.0"));
    expect(text).toContain("Componentes: 2");
  });
});

// ADR-196 §6: comprobación sobre el `dist` ya construido. Se saltea si no hay
// `dist` (`pnpm --filter @anonly/react-client build` lo genera).
describe("dist/licenses/THIRD_PARTY_LICENSES.txt", () => {
  const distFile = fromRepo("apps/react-client/dist/licenses/THIRD_PARTY_LICENSES.txt");
  // Una pista por componente principal, como título de entrada (`nombre versión`
  // al principio de línea). Sin versiones fijas: se actualizan solas.
  const NEEDLES: Readonly<Record<string, RegExp>> = {
    react: /^react \S+$/m,
    "radix-ui": /^@radix-ui\/react-dialog \S+$/m,
    lucide: /^lucide-react \S+$/m,
    zustand: /^zustand \S+$/m,
    pdfjs: /^pdfjs-dist \S+$/m,
    "pdf-lib": /^pdf-lib \S+$/m,
    tesseract: /^tesseract\.js-core \S+$/m,
    "tesseract-data": /^tessdata /m,
    sparkle: /^Sparkle \S+$/m,
    "transformers-js": /^@huggingface\/transformers \S+$/m,
    "onnx-runtime": /^onnxruntime-web \S+$/m,
    "ner-model": /^bert-base-multilingual-cased-ner-hrl /m,
    "electron-updater": /^electron-updater \S+$/m,
  };
  // Electron y Chromium no van en este archivo: `electron-builder` pone
  // LICENSE.electron.txt y LICENSES.chromium.html (ADR-196 §1, §4).
  const OUTSIDE_THIS_FILE: ReadonlyArray<string> = ["electron"];

  it.skipIf(!existsSync(distFile))(
    "existe, no está vacío y nombra a cada componente principal",
    () => {
      const text = readFileSync(distFile, "utf-8");
      expect(text.trim().length).toBeGreaterThan(0);
      for (const item of THIRD_PARTY_SOFTWARE) {
        if (OUTSIDE_THIS_FILE.includes(item.id)) continue;
        const needle = NEEDLES[item.id];
        expect(needle, `falta la pista de ${item.id} en el test`).toBeDefined();
        expect(text, `${item.name} no figura en el archivo`).toMatch(needle ?? /$^/);
      }
    },
  );

  it.skipIf(!existsSync(distFile))(
    "incluye cada embebido de la tabla y los avisos del worker de tesseract.js",
    () => {
      const text = readFileSync(distFile, "utf-8");
      for (const host of EMBEDDING_HOSTS) {
        for (const embedded of host.embedded) {
          expect(text, `${embedded.name} falta`).toContain(
            `\n${embedded.name} ${embedded.embeddedVersion ?? ""}`,
          );
        }
        for (const notice of host.artifactNotices) {
          expect(text, `${notice} falta`).toContain(`[${notice}]`);
        }
      }
    },
  );
});
