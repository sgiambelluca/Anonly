/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /*
         * Tokens de `ui/Components.md` §10. Los valores viven en `index.css`
         * como canales RGB, para que exista el modo oscuro y para que los
         * modificadores de opacidad (`border-accent/30`) sigan funcionando —
         * con un hex adentro de la variable se romperían en silencio.
         */
        bg: {
          primary: "rgb(var(--color-bg-primary) / <alpha-value>)",
          secondary: "rgb(var(--color-bg-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--color-bg-tertiary) / <alpha-value>)",
        },
        border: "rgb(var(--color-border) / <alpha-value>)",
        text: {
          primary: "rgb(var(--color-text-primary) / <alpha-value>)",
          secondary: "rgb(var(--color-text-secondary) / <alpha-value>)",
        },
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        /*
         * El color del texto **encima** del relleno accent. Es un token y no
         * `text-white` porque en oscuro el accent se aclara (#60a5fa) y el
         * blanco cae a 2.54:1, muy por debajo del 4.5:1 que `UX_Guidelines.md`
         * §9 promete. En claro vale blanco (5.17:1); en oscuro, #111827
         * (6.98:1). Mismo criterio para `error-foreground`.
         */
        "accent-foreground": "rgb(var(--color-accent-foreground) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        "warning-strong": "rgb(var(--color-warning-strong) / <alpha-value>)",
        error: "rgb(var(--color-error) / <alpha-value>)",
        "error-foreground": "rgb(var(--color-error-foreground) / <alpha-value>)",
        /*
         * Highlight por tipo de entidad (`ui/Components.md` §9). **No tienen
         * variante oscura y no es un olvido**: pintan encima de la página
         * renderizada del PDF, que es blanca en los dos temas. Cambiarlos con
         * el tema los movería respecto del fondo real sobre el que se ven.
         */
        hl: {
          person: "#10b981",
          organization: "#6366f1",
          address: "#f59e0b",
          dni: "#3b82f6",
          cuit: "#3b82f6",
          phone: "#8b5cf6",
          email: "#8b5cf6",
          iban: "#ec4899",
          creditcard: "#ec4899",
          date: "#14b8a6",
          license: "#a855f7",
          plate: "#a855f7",
          custom: "#64748b",
          conflict: "#ef4444",
        },
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.1)",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
