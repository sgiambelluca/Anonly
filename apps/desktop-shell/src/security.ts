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
/**
 * Los assets de un build son inmutables: viajan adentro del instalador y solo
 * cambian cuando cambia la versión.
 *
 * `immutable` es literal acá, más que en cualquier CDN: el archivo no puede
 * cambiar sin que cambie el paquete instalado.
 *
 * **Sin efecto medible sobre el caso que lo motivó, y conviene decirlo.** Se
 * agregó al investigar por qué el modelo NER tarda ~30 s en quedar listo en el
 * contenedor contra ~1 s en la web: el archivo de 178 MB se pide **tres
 * veces** en una importación, una por worker de la pool. Con el header puesto
 * se sigue pidiendo tres veces — Chromium no aplica caché HTTP a un esquema
 * propio desde contextos de worker— y el tiempo no cambió (36,4 s / 33,4 s
 * contra 39,1 s / 32,1 s: ruido).
 *
 * Se conserva porque es correcto para el resto de los assets y es el default
 * sensato para bytes inmutables, no porque resuelva algo.
 */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export function headersFor(pathname: string): Record<string, string> {
  const headers: Record<string, string> = { ...ISOLATION_HEADERS };
  /*
   * El documento no: es el punto de entrada, y cachearlo entre versiones
   * dejaría al usuario con el HTML de la versión anterior apuntando a chunks
   * que ya no existen. Todo lo demás lleva hash en el nombre o vive adentro
   * del paquete.
   */
  if (pathname.endsWith(".html")) {
    headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY;
  } else {
    headers["Cache-Control"] = IMMUTABLE_CACHE;
  }
  return headers;
}
