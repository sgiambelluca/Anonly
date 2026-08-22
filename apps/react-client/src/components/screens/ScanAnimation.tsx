/**
 * `ScanAnimation` — el documento que se escanea, para `ScanScreen`.
 *
 * Silueta tomada del icono de PDF que el humano pasó como referencia: página
 * con esquina doblada y renglones gruesos redondeados. **No** se toma el 3D ni
 * el naranja de esa referencia: chocarían con el resto de la interfaz, que es
 * plana y monocroma con un solo acento.
 *
 * Tres movimientos que juntos cuentan "está recorriendo todo el documento":
 *
 * 1. La **lupa** baja y sube sobre la página.
 * 2. Cada **renglón se enciende** cuando la lupa pasa por encima — el retardo
 *    de cada uno está calzado con la posición de la lupa en ese momento, así
 *    que el resaltado se lee como consecuencia y no como un parpadeo suelto.
 * 3. La página **se corre hacia arriba** y se difumina contra los bordes, que
 *    es lo que simula pasar de página sin dibujar páginas distintas.
 *
 * Todo el movimiento vive detrás de `prefers-reduced-motion: no-preference`
 * (`index.css`): con movimiento reducido queda un documento quieto con la lupa
 * apoyada, que sigue diciendo "esto se está revisando" sin animar nada.
 *
 * **Es decorativa** (`aria-hidden`): lo que está pasando lo dice el texto de
 * estado y la barra de progreso, que sí son leíbles por un lector de pantalla.
 * Duplicarlo acá sería anunciar dos veces lo mismo.
 */

/** Renglones de la página: `y` dentro del viewBox y ancho. */
const LINES: ReadonlyArray<{ readonly y: number; readonly width: number }> = [
  { y: 26, width: 34 },
  { y: 35, width: 42 },
  { y: 44, width: 28 },
  { y: 53, width: 40 },
  { y: 62, width: 32 },
  { y: 71, width: 38 },
];

/**
 * El ciclo de la lupa dura 3,2 s y baja en la primera mitad. Cada renglón se
 * enciende cuando la lupa está a su altura: retardo = (posición del renglón
 * dentro del recorrido) × medio ciclo.
 */
function highlightDelayMs(index: number): number {
  const CYCLE_MS = 3200;
  return Math.round((index / LINES.length) * (CYCLE_MS / 2));
}

export function ScanAnimation() {
  return (
    <div className="relative h-[132px] w-[104px]" aria-hidden>
      <svg viewBox="0 0 80 100" className="h-full w-full overflow-visible">
        <defs>
          {/*
            Difuminado contra los bordes: la página se corre hacia arriba y
            entra/sale por una máscara, así el desplazamiento se lee como
            "sigue habiendo documento" en vez de como un recorte.

            **Blanco y no negro**: una `mask` de SVG usa *luminancia*, así que
            el negro vale cero y oculta todo lo que cubre. Con stops negros la
            máscara borraba el documento entero y solo quedaba la lupa flotando
            — verificado en el browser. Lo visible se pinta en blanco.
          */}
          <linearGradient id="anonly-scan-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.18" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.82" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="anonly-scan-mask">
            <rect x="0" y="0" width="80" height="100" fill="url(#anonly-scan-fade)" />
          </mask>
        </defs>

        <g mask="url(#anonly-scan-mask)">
          <g className="anonly-scan-scroll">
            {/* Página con esquina doblada. */}
            <path
              d="M10 4h40l20 20v72a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z"
              className="fill-bg-primary stroke-border"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M50 4v16a4 4 0 0 0 4 4h16"
              className="stroke-border"
              fill="none"
              strokeWidth="2"
              strokeLinejoin="round"
            />

            {LINES.map((line, index) => (
              <g key={line.y}>
                <rect
                  x="18"
                  y={line.y}
                  width={line.width}
                  height="5"
                  rx="2.5"
                  className="fill-bg-tertiary"
                />
                {/* La misma barra en acento, encendiéndose al pasar la lupa. */}
                <rect
                  x="18"
                  y={line.y}
                  width={line.width}
                  height="5"
                  rx="2.5"
                  className="anonly-scan-hit fill-accent"
                  style={{ animationDelay: `${highlightDelayMs(index)}ms` }}
                />
              </g>
            ))}
          </g>
        </g>

        {/* La lupa va fuera de la máscara: no se desplaza con la página. */}
        <g className="anonly-scan-lens">
          <circle
            cx="52"
            cy="40"
            r="15"
            className="fill-bg-primary/70 stroke-accent"
            strokeWidth="3"
          />
          <line
            x1="63"
            y1="51"
            x2="72"
            y2="60"
            className="stroke-accent"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      </svg>
    </div>
  );
}
