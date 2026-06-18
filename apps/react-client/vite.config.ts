import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
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
