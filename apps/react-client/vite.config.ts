import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
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
