import { join, resolve } from "node:path";

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
