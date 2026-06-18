/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Tokens de ui/Components.md §10
        bg: {
          primary: "#ffffff",
          secondary: "#f9fafb",
          tertiary: "#f3f4f6",
        },
        border: "#e5e7eb",
        text: {
          primary: "#111827",
          secondary: "#6b7280",
        },
        accent: "#3b82f6",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
        // Highlight por tipo de entidad (ui/Components.md §9)
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
