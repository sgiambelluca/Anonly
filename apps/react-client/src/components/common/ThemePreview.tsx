/**
 * `ThemePreview` — la miniatura de la app en un tema, dibujada.
 *
 * No es una captura: es un SVG. Una captura habría que regenerarla cada vez
 * que cambia la UI, y el día que alguien se olvide, Configuración muestra una
 * app que ya no existe. Esto envejece mal en un solo eje —los colores— y esos
 * son justamente los que se pasan por parámetro.
 *
 * **Los colores van literales y no como tokens**, a propósito: la miniatura
 * del modo oscuro tiene que verse oscura aunque la app esté en claro. Usar
 * `bg-bg-primary` acá haría que las dos miniaturas se vieran idénticas, que es
 * exactamente lo contrario de para qué existen.
 *
 * La hoja del documento es blanca en las dos: es la página del PDF renderizada,
 * y el papel no cambia de color con el tema (mismo criterio que los highlights
 * de entidad en `tailwind.config.js`).
 */

export interface ThemePreviewPalette {
  readonly bg: string;
  readonly surface: string;
  readonly border: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly accent: string;
}

export const LIGHT_PREVIEW: ThemePreviewPalette = {
  bg: "#f9fafb",
  surface: "#ffffff",
  border: "#e5e7eb",
  text: "#111827",
  textSecondary: "#6b7280",
  accent: "#2563eb",
};

export const DARK_PREVIEW: ThemePreviewPalette = {
  bg: "#111827",
  surface: "#1f2937",
  border: "#6b7280",
  text: "#f9fafb",
  textSecondary: "#9ca3af",
  accent: "#60a5fa",
};

/** Colores de highlight de `Components.md` §9: no dependen del tema. */
const HL_PERSON = "#10b981";
const HL_DNI = "#3b82f6";

export function ThemePreview({ palette }: { readonly palette: ThemePreviewPalette }) {
  return (
    <svg viewBox="0 0 200 128" className="h-auto w-full" role="img" aria-hidden focusable="false">
      <rect width="200" height="128" rx="6" fill={palette.bg} />

      {/* Toolbar */}
      <rect x="0" y="0" width="200" height="16" rx="6" fill={palette.surface} />
      <rect x="0" y="10" width="200" height="6" fill={palette.surface} />
      <line x1="0" y1="16" x2="200" y2="16" stroke={palette.border} strokeWidth="1" />
      <rect x="7" y="6" width="26" height="4" rx="2" fill={palette.text} opacity="0.85" />
      <rect x="168" y="5" width="25" height="7" rx="3" fill={palette.accent} />

      {/* Panel de entidades */}
      <rect x="0" y="17" width="72" height="111" fill={palette.surface} />
      <line x1="72" y1="17" x2="72" y2="128" stroke={palette.border} strokeWidth="1" />
      <rect x="7" y="24" width="30" height="4" rx="2" fill={palette.textSecondary} />
      {[36, 50, 64, 78, 92].map((y, index) => (
        <g key={y}>
          <circle cx="12" cy={y + 2} r="3" fill={index % 2 === 0 ? HL_PERSON : HL_DNI} />
          <rect
            x="19"
            y={y}
            width={index % 2 === 0 ? 42 : 34}
            height="4"
            rx="2"
            fill={palette.text}
            opacity="0.7"
          />
        </g>
      ))}

      {/* La hoja del PDF: blanca en los dos temas */}
      <rect x="82" y="24" width="108" height="96" rx="3" fill="#ffffff" />
      <rect
        x="82"
        y="24"
        width="108"
        height="96"
        rx="3"
        fill="none"
        stroke={palette.border}
        strokeWidth="1"
      />
      {[32, 40, 56, 72, 88, 104].map((y) => (
        <rect key={y} x="89" y={y} width={y === 32 ? 52 : 94} height="3" rx="1.5" fill="#d1d5db" />
      ))}
      {/* Entidades detectadas, tapadas */}
      <rect x="89" y="47" width="46" height="6" rx="2" fill={HL_PERSON} opacity="0.85" />
      <rect x="120" y="79" width="34" height="6" rx="2" fill={HL_DNI} opacity="0.85" />
      <rect x="89" y="95" width="28" height="6" rx="2" fill={HL_PERSON} opacity="0.85" />
    </svg>
  );
}
