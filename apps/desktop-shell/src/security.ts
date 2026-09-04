/**
 * Fuente única de la postura de seguridad que el shell impone al renderer
 * (ADR-132 §2).
 *
 * Vive acá y no inline en `main.ts` para que sea testeable sin levantar
 * Electron, y para que el gate `csp-under-app-protocol` tenga un solo lugar
 * contra el cual comparar.
 */

/**
 * CSP de `architecture/08_Security_Model.md` §3.2, sin cambios.
 *
 * Se copia en vez de derivarse porque el documento es la autoridad y esto es
 * su implementación: si divergen, el gate tiene que fallar, y eso solo pasa
 * si hay dos textos que comparar.
 *
 * `connect-src 'self'` NO lleva excepción para el actualizador: el updater
 * corre en el proceso main, donde la CSP no aplica (ADR-132 §1). El renderer
 * no gana ningún destino de red.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
].join("; ");

/**
 * Los dos headers de ADR-100, ahora servidos por el shell en vez de por un
 * hosting. Sin ellos `onnxruntime-web` se autolimita a un hilo (13 564 ms
 * contra 6 287 ms sobre el dataset de referencia).
 *
 * `Cross-Origin-Resource-Policy` acompaña a `require-corp`: bajo COEP toda
 * subrequest tiene que estar habilitada explícitamente, y todo lo que sirve
 * este protocolo es del mismo origen.
 */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
});

/**
 * Headers para una respuesta del protocolo `app://`.
 *
 * La CSP va **solo en los documentos**: un `Content-Security-Policy` sobre un
 * `.wasm` o un `.onnx` no significa nada, y repetirlo en cada asset solo
 * agrega bytes y ruido a la hora de auditar qué política rige.
 */
export function headersFor(pathname: string): Record<string, string> {
  const headers: Record<string, string> = { ...ISOLATION_HEADERS };
  if (pathname.endsWith(".html")) {
    headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY;
  }
  return headers;
}
