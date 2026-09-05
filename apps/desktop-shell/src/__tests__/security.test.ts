import { describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY, headersFor, ISOLATION_HEADERS } from "../security";

describe("CONTENT_SECURITY_POLICY", () => {
  it("mantiene las directivas que 08_Security_Model.md §3.2 declara", () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split("; ").map((d) => {
        const [name, ...rest] = d.split(" ");
        return [name ?? "", rest.join(" ")];
      }),
    );

    expect(directives.get("default-src")).toBe("'self'");
    expect(directives.get("object-src")).toBe("'none'");
    expect(directives.get("frame-src")).toBe("'none'");
    expect(directives.get("base-uri")).toBe("'self'");
  });

  it("no le abre un destino de red al renderer: el updater vive en el main (ADR-132 §1)", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/connect-src[^;]*(https?:|\*)/);
  });

  it("conserva las dos concesiones que ADR-039 justificó, y ninguna más", () => {
    expect(CONTENT_SECURITY_POLICY).toContain("'wasm-unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).toContain("worker-src 'self' blob:");
    // `unsafe-eval` completo habilitaría eval()/new Function(): nunca.
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval';");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe("ISOLATION_HEADERS", () => {
  it("son los dos de ADR-100 más el CORP que require-corp necesita", () => {
    expect(ISOLATION_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(ISOLATION_HEADERS["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
    expect(ISOLATION_HEADERS["Cross-Origin-Resource-Policy"]).toBe("same-origin");
  });

  it("es inmutable: nada puede aflojar el aislamiento en runtime", () => {
    expect(Object.isFrozen(ISOLATION_HEADERS)).toBe(true);
  });
});

describe("headersFor", () => {
  it("pone la CSP en los documentos", () => {
    expect(headersFor("/index.html")["Content-Security-Policy"]).toBe(CONTENT_SECURITY_POLICY);
  });

  it("no la pone en assets, donde no significa nada", () => {
    for (const p of [
      "/assets/ort-wasm-simd-threaded.wasm",
      "/models/ner/model_quantized.onnx",
      "/a.js",
    ]) {
      expect(headersFor(p)["Content-Security-Policy"]).toBeUndefined();
    }
  });

  it("manda el aislamiento en TODA respuesta, no solo en el documento", () => {
    // Un asset sin CORP lo bloquea COEP, y el pipeline se cae en el worker
    // que lo pide, no acá.
    for (const p of ["/index.html", "/assets/x.wasm", "/models/y.onnx"]) {
      expect(headersFor(p)["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
      expect(headersFor(p)["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    }
  });

  it("marca los assets como inmutables: sus bytes viajan adentro del instalador", () => {
    for (const p of [
      "/assets/ort-wasm-simd-threaded.wasm",
      "/models/ner/model_quantized.onnx",
      "/assets/index-a1b2c3.js",
    ]) {
      expect(headersFor(p)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    }
  });

  it("no cachea el documento, que es lo único que puede quedar viejo", () => {
    // Un index.html cacheado entre versiones apunta a chunks con hash que la
    // versión nueva ya no trae: la app abriría rota y sin forma de recuperarse.
    expect(headersFor("/index.html")["Cache-Control"]).toBeUndefined();
  });

  it("devuelve un objeto nuevo cada vez, sin alias al congelado", () => {
    const first = headersFor("/index.html");
    first["Cross-Origin-Embedder-Policy"] = "unsafe-none";
    expect(headersFor("/index.html")["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  });
});
