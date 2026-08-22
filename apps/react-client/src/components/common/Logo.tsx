/**
 * `Logo` — la marca de Anonly.
 *
 * **Concepto**: un documento con una línea de texto reemplazada por una barra
 * sólida. Es literalmente lo que hace la app, y la barra sobre texto es el
 * símbolo universal de "censurado".
 *
 * Se evaluó la alternativa que el humano propuso —el incógnito de Chrome
 * (sombrero + anteojos) junto a un icono de PDF— y se descartó por dos
 * razones: el sombrero con anteojos es una marca muy identificada con Chrome,
 * así que usarla se lee como derivada; y su significado es "sin historial de
 * navegación", que no es la promesa de Anonly. La promesa acá es "este
 * documento ya no tiene datos personales", y eso lo dice la barra.
 *
 * **Legible a 16 px**: a tamaño de favicon lo único que se distingue es la
 * silueta de página y una barra oscura cruzándola, que es exactamente el
 * mensaje. Las dos líneas finas de texto son detalle que aparece al crecer, no
 * información que se pierda si desaparece.
 *
 * `animated` dibuja la barra "tapando" la línea de texto que hay debajo, una
 * sola vez al montar: la marca *hace* lo que la app hace. Respeta
 * `prefers-reduced-motion` (`UX_Guidelines.md` §9) — con movimiento reducido la
 * barra aparece ya completa, sin transición.
 */

export interface LogoProps {
  /** Lado en px. El `viewBox` es cuadrado. */
  readonly size?: number;
  readonly animated?: boolean;
  readonly className?: string;
}

export function Logo({ size = 32, animated = false, className = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Anonly"
    >
      {/* Página con esquina doblada. `currentColor` para que herede del contexto. */}
      <path
        d="M8 2.5h10.5L26 10v19.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-25a2 2 0 0 1 2-2Z"
        className="fill-bg-primary stroke-text-primary"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 2.5V8a2 2 0 0 0 2 2H26"
        className="stroke-text-primary"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />

      {/* Texto: dos renglones finos. Detalle, no información. */}
      <rect x="10" y="14" width="9" height="1.6" rx="0.8" className="fill-text-secondary" />
      <rect x="10" y="24" width="6.5" height="1.6" rx="0.8" className="fill-text-secondary" />

      {/*
        El renglón que la barra tapa. Se dibuja debajo para que, animado, se lo
        vea desaparecer bajo ella en vez de aparecer de la nada.
      */}
      <rect x="10" y="19" width="12" height="1.6" rx="0.8" className="fill-text-secondary" />

      {/* La barra de censura: el elemento que carga el significado. */}
      <rect
        x="10"
        y="17.6"
        width="12"
        height="4.4"
        rx="1"
        className={`fill-accent ${animated ? "anonly-logo-bar" : ""}`}
      />
    </svg>
  );
}
