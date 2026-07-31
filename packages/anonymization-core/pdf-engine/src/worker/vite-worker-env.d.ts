/**
 * Ambient para el import `?url` de Vite, usado únicamente por `entry.ts` (el
 * único archivo de `pdf-engine` que Vite bundlea como Worker real, ADR-036
 * §2) para resolver `pdfjs-dist/build/pdf.worker.min.mjs?url` — mismo patrón
 * que `apps/react-client/src/vite-env.d.ts` (`/// <reference types="vite/client" />`),
 * reproducido acá sin agregar `vite` como dependencia de este paquete
 * (Code_Standards.md §1: "El Core no usa bundler"; el paquete en general no
 * depende de Vite, pero este único entry-point sí es bundleado por él).
 */
declare module "*?url" {
  const url: string;
  export default url;
}
