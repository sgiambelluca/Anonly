/**
 * Ambient para el import `?url` de Vite, usado únicamente por `entry.ts` (el
 * único archivo de `render-engine` que Vite bundlea como Worker real,
 * ADR-036 §2) para resolver `pdfjs-dist/build/pdf.worker.min.mjs?url` — mismo
 * patrón que `pdf-engine/src/worker/vite-worker-env.d.ts` y
 * `apps/react-client/src/vite-env.d.ts`, reproducido acá sin agregar `vite`
 * como dependencia de este paquete (Code_Standards.md §1: "El Core no usa
 * bundler"; el paquete en general no depende de Vite, pero este único
 * entry-point sí es bundleado por él).
 */
declare module "*?url" {
  const url: string;
  export default url;
}
