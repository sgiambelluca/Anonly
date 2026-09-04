import { join, resolve, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import { rendererRoot, resolveAssetPath } from "../paths";

const ROOT = resolve("/tmp/anonly-renderer");

describe("resolveAssetPath", () => {
  it("resuelve un asset normal dentro de la raíz", () => {
    expect(resolveAssetPath(ROOT, "/assets/index.js")).toBe(join(ROOT, "assets", "index.js"));
  });

  it("sirve index.html en la raíz y en la cadena vacía", () => {
    expect(resolveAssetPath(ROOT, "/")).toBe(join(ROOT, "index.html"));
    expect(resolveAssetPath(ROOT, "")).toBe(join(ROOT, "index.html"));
  });

  it("decodifica antes de normalizar", () => {
    expect(resolveAssetPath(ROOT, "/models/ner%20model.onnx")).toBe(
      join(ROOT, "models", "ner model.onnx"),
    );
  });

  describe("rechaza todo lo que salga de la raíz", () => {
    it("con `..` literales", () => {
      expect(resolveAssetPath(ROOT, "/../../etc/passwd")).toBeNull();
      expect(resolveAssetPath(ROOT, "/assets/../../../secreto")).toBeNull();
    });

    it("con `..` percent-encoded, que normalizar primero dejaría pasar", () => {
      expect(resolveAssetPath(ROOT, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
      expect(resolveAssetPath(ROOT, "/%2e%2e%2f%2e%2e%2fsecreto")).toBeNull();
    });

    it("con `..` como separador de Windows", () => {
      expect(resolveAssetPath(ROOT, "/assets\\..\\..\\secreto")).toBeNull();
    });

    it("con `..` en el medio, aunque el resultado cayera dentro de la raíz", () => {
      // `normalize` sola lo dejaría en `<raíz>/b`, que es inocuo. Se rechaza
      // igual: un pathname con `..` no es un asset del build, y devolver 403
      // deja la sonda visible en vez de disolverla en un 404.
      expect(resolveAssetPath(ROOT, "/assets/../b")).toBeNull();
    });

    it("con un byte NUL", () => {
      expect(resolveAssetPath(ROOT, "/index.html\0.png")).toBeNull();
    });

    it("con percent-encoding inválido, en vez de tirar excepción", () => {
      expect(resolveAssetPath(ROOT, "/%")).toBeNull();
      expect(resolveAssetPath(ROOT, "/%zz")).toBeNull();
    });
  });

  it("acepta la raíz exacta sin confundirla con una fuga", () => {
    expect(resolveAssetPath(ROOT, "/index.html")).toBe(join(ROOT, "index.html"));
  });
});

describe("rendererRoot", () => {
  it("empaquetada, lee del directorio de recursos", () => {
    const root = rendererRoot({
      isPackaged: true,
      resourcesPath: "/Applications/Anonly.app/Contents/Resources",
      shellDir: "/irrelevante",
    });
    expect(root).toBe(join("/Applications/Anonly.app/Contents/Resources", "renderer"));
  });

  it("en desarrollo, apunta al dist del react-client del workspace", () => {
    const root = rendererRoot({
      isPackaged: false,
      resourcesPath: "/irrelevante",
      shellDir: "/repo/apps/desktop-shell/dist",
    });
    expect(root).toBe(resolve("/repo/apps/react-client/dist"));
  });
});

/*
 * Windows verificado desde macOS.
 *
 * `node:path` cambia de semántica según la plataforma donde corre, así que sin
 * pasarle `win32` explícitamente estos tests solo probarían POSIX — y el
 * instalador de Windows es el que más usuarios va a tener. Esto no reemplaza
 * correr la app en Windows (eso lo hace el smoke test de CI), pero cubre lo que
 * más chances tenía de romperse en silencio: la resolución de rutas y el
 * guardia de traversal bajo separadores y raíces distintas.
 */
describe("resolveAssetPath — semántica de Windows", () => {
  const WROOT = "C:\\Program Files\\Anonly\\resources\\renderer";

  it("resuelve un asset con separadores de Windows", () => {
    expect(resolveAssetPath(WROOT, "/assets/index.js", win32)).toBe(`${WROOT}\\assets\\index.js`);
  });

  it("sirve index.html en la raíz", () => {
    expect(resolveAssetPath(WROOT, "/", win32)).toBe(`${WROOT}\\index.html`);
  });

  it("resuelve las rutas hondas del modelo NER, que son las más largas", () => {
    const deep =
      "/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx";
    expect(resolveAssetPath(WROOT, deep, win32)).toBe(
      `${WROOT}\\models\\ner\\Xenova\\bert-base-multilingual-cased-ner-hrl\\onnx\\model_quantized.onnx`,
    );
  });

  it("rechaza traversal con `..`, en las dos formas de separador", () => {
    expect(resolveAssetPath(WROOT, "/../../Windows/System32/config/SAM", win32)).toBeNull();
    expect(resolveAssetPath(WROOT, "/assets\\..\\..\\secreto", win32)).toBeNull();
    expect(resolveAssetPath(WROOT, "/%2e%2e%5c%2e%2e%5csecreto", win32)).toBeNull();
  });

  it("no deja escapar a otra unidad ni a una ruta UNC", () => {
    /*
     * El invariante que importa no es "devuelve null", es "no sale de la raíz".
     * Una letra de unidad o un prefijo UNC metidos en el pathname no producen
     * una fuga: `join` los pega **adentro** de la raíz y sale una ruta que no
     * existe (`...\renderer\D:\secreto.txt`), o sea un 404. Afirmar `null`
     * sería afirmar una implementación, no la propiedad de seguridad — y de
     * hecho la primera versión de este test lo hizo y falló contra un
     * comportamiento correcto.
     */
    for (const probe of ["/D:/secreto.txt", "//servidor/share/x", "/C:/Windows/System32"]) {
      const resolved = resolveAssetPath(WROOT, probe, win32);
      if (resolved !== null) expect(resolved.startsWith(WROOT + win32.sep)).toBe(true);
    }
  });

  it("acepta la raíz exacta sin leerla como fuga", () => {
    expect(resolveAssetPath(WROOT, "/index.html", win32)).toBe(`${WROOT}\\index.html`);
  });
});

describe("rendererRoot — semántica de Windows", () => {
  it("empaquetada, arma la ruta de recursos con separadores de Windows", () => {
    const root = rendererRoot(
      {
        isPackaged: true,
        resourcesPath: "C:\\Program Files\\Anonly\\resources",
        shellDir: "irrelevante",
      },
      win32,
    );
    expect(root).toBe("C:\\Program Files\\Anonly\\resources\\renderer");
  });
});
