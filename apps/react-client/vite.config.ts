import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const POLYFILLS = fileURLToPath(new URL("./src/polyfills.ts", import.meta.url));

/**
 * Mete `src/polyfills.ts` en **cada worker de motor**, no solo en el hilo
 * principal.
 *
 * `main.tsx` importa el polyfill, pero un Web Worker es un scope global
 * aparte: nada de lo que se parchea en la página llega adentro. Y `pdfjs-dist`
 * —que es quien usa `Promise.withResolvers`— corre justamente **dentro** de
 * los workers de `pdf-engine` y `render-engine`. Medido en Safari 17.0: con
 * el polyfill solo en `main.tsx`, `getDocument()` seguía tirando
 * `Promise.withResolvers is not a function` y la UI seguía diciendo "El
 * archivo no es un PDF válido".
 *
 * Va acá y no en los entry-points de los motores porque los motores no pueden
 * saber de compatibilidad de navegadores ni tienen bundler: la app es la única
 * capa que resuelve esto (`Code_Standards.md` §1), mismo criterio con el que
 * `GlobalWorkerOptions.workerSrc` vive en `main.tsx` y no en `pdf-engine`.
 *
 * Se inyecta como `import` y no como código inline para que haya **una sola**
 * copia del polyfill —la que testea `__tests__/polyfills.test.ts`— y para que
 * quede primero: los `import` de un módulo ES se evalúan antes que su cuerpo.
 */
function polyfillWorkers(): Plugin {
  return {
    name: "anonly:polyfill-workers",
    enforce: "pre",
    transform(code, id) {
      if (id === POLYFILLS) return null;
      if (!/[/\\]worker[/\\]entry\.ts(\?|$)/.test(id)) return null;
      return { code: `import ${JSON.stringify(POLYFILLS)};\n${code}`, map: null };
    },
  };
}

export default defineConfig({
  plugins: [polyfillWorkers(), react()],
  server: {
    port: 5173,
    /*
     * Falla si 5173 esta ocupado, en vez de correrse al puerto de al lado.
     *
     * Con `false`, un segundo `pnpm dev` arrancaba en silencio en 5174 — y
     * los dos servers compartian el mismo cache en disco,
     * `node_modules/.vite/deps`, que Vite sirve con
     * `Cache-Control: max-age=31536000, immutable`. Como el unico
     * cache-buster de esas URLs es el `?v=<browserHash>` de
     * `deps/_metadata.json`, si el hash no cambia el navegador se queda para
     * siempre con las copias que cacheo durante la convivencia: los Web
     * Workers mueren con `WorkerCrashedError` o el PDF se reclasifica como
     * `PDF_INVALID`, y el estado sobrevive a reiniciar el server, reiniciar
     * la maquina y descartar los cambios del repo — porque no vive en el
     * repo. Peor: no se reproduce desde un navegador que nunca vio el server
     * viejo, asi que parece un bug de codigo y no lo es.
     *
     * Fallar al arrancar convierte eso en un mensaje en la terminal. Si de
     * verdad hace falta un segundo server, `pnpm dev --port <otro>`, que es
     * explicito y no se cuela.
     *
     * Si el cache ya quedo envenenado: borrar `apps/react-client/node_modules/.vite`
     * y `node_modules/.vite`, y reiniciar (el `browserHash` nuevo cambia
     * todas las URLs).
     */
    strictPort: true,
    /*
     * ADR-100: los mismos dos headers que `public/_headers` le pide al
     * hosting. Van acá para que **dev y producción se comporten igual**: sin
     * esto, el dev server dejaría la app en un hilo y cualquier medición
     * local describiría una app distinta de la que se publica.
     */
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Code splitting manual: los chunks de engines se cargan lazy.
        // Se refinan en Hito 10 (React Client) cuando los engines existen.
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "radix-vendor": [
            "@radix-ui/react-checkbox",
            "@radix-ui/react-dialog",
            "@radix-ui/react-select",
            "@radix-ui/react-toast",
            "@radix-ui/react-tooltip",
          ],
        },
      },
    },
  },
  worker: {
    format: "es",
  },
});
