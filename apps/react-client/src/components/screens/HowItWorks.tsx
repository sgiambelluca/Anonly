/**
 * `HowItWorks` — la caja "Cómo funciona" de `LoadScreen` (ADR-168 §1,
 * `UX_Guidelines.md` §2.1).
 *
 * Una animación en tres fases sincronizada con tres pasos escritos: entra el
 * documento (*Cargá el PDF*), la lupa marca los datos por tipo (*Revisá lo
 * detectado*), los datos se tapan y aparece un check (*Exportá la copia*).
 * Resuelve lo que reportaron las pruebas de usuario: la pantalla no explicaba
 * que después de detectar se puede revisar, ni que el PDF final se reconstruye.
 *
 * Los pasos dicen **qué hace el usuario**; las tarjetas de rasgos de al lado
 * dicen **qué garantiza** la herramienta, y no se repiten.
 *
 * Todo el movimiento vive detrás de `prefers-reduced-motion: no-preference`
 * (`index.css`). Quieto, queda el documento con los datos marcados y el paso 2
 * resaltado. La ilustración es decorativa (`aria-hidden`): los pasos escritos
 * son la información.
 *
 * Los colores de las marcas son los del highlight por tipo (`Components.md`
 * §9), que no cambian con el tema por la misma razón que en el visor: pintan
 * sobre una página.
 */

import { EntityType } from "@anonly/anonymization-core";

import { ENTITY_TYPE_COLOR } from "../entities/entityTypeColors.js";

const STEPS: ReadonlyArray<{ readonly title: string; readonly description: string }> = [
  { title: "Cargá el PDF", description: "Se abre en tu computadora; no se sube a ningún lado." },
  {
    title: "Revisá lo detectado",
    description: "Nombres, DNI, CUIT, direcciones y más. Vos decidís qué se reemplaza.",
  },
  {
    title: "Exportá la copia",
    description: "Un PDF nuevo, reconstruido desde cero y sin texto oculto.",
  },
];

const STEP_CLASS: ReadonlyArray<string> = ["anonly-hw-s1", "anonly-hw-s2", "anonly-hw-s3"];

/** Las tres marcas del documento ilustrado: dónde está el dato y su etiqueta. */
const MARKS: ReadonlyArray<{
  readonly className: string;
  readonly box: { readonly x: number; readonly y: number; readonly width: number };
  readonly lineFrom: number;
  readonly pill: { readonly y: number; readonly width: number };
  readonly label: string;
  readonly color: string;
  readonly textColor: string;
}> = [
  {
    className: "anonly-hw-hl",
    box: { x: 116, y: 47, width: 44 },
    lineFrom: 162,
    pill: { y: 44, width: 56 },
    label: "Persona",
    color: ENTITY_TYPE_COLOR[EntityType.Person],
    textColor: "#052e1f",
  },
  {
    className: "anonly-hw-hl anonly-hw-d2",
    box: { x: 89, y: 79, width: 40 },
    lineFrom: 129,
    pill: { y: 76, width: 40 },
    label: "DNI",
    color: ENTITY_TYPE_COLOR[EntityType.DNI],
    textColor: "#ffffff",
  },
  {
    className: "anonly-hw-hl anonly-hw-d3",
    box: { x: 104, y: 111, width: 56 },
    lineFrom: 162,
    pill: { y: 108, width: 66 },
    label: "Dirección",
    color: ENTITY_TYPE_COLOR[EntityType.Address],
    textColor: "#3b2300",
  },
];

const TEXT_LINES: ReadonlyArray<{ readonly y: number; readonly width: number }> = [
  { y: 34, width: 44 },
  { y: 50, width: 66 },
  { y: 66, width: 56 },
  { y: 82, width: 64 },
  { y: 98, width: 48 },
  { y: 114, width: 66 },
  { y: 130, width: 36 },
];

export function HowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-title"
      className="flex flex-col gap-3.5 rounded-2xl border border-border bg-bg-primary p-5 shadow-sm"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="how-it-works-title" className="text-base font-semibold text-text-primary">
          Cómo funciona
        </h2>
        <span className="text-sm text-text-secondary">3 pasos</span>
      </div>

      <div
        aria-hidden
        className="anonly-dots flex h-40 items-center justify-center overflow-hidden rounded-xl border border-border bg-bg-secondary"
      >
        <svg
          width="300"
          height="156"
          viewBox="0 0 300 156"
          fill="none"
          className="overflow-visible"
        >
          <g className="anonly-hw-doc">
            <path
              d="M84 6h62l22 22v118a4 4 0 0 1-4 4H84a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z"
              className="fill-bg-primary stroke-border"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path
              d="M146 6v18a4 4 0 0 0 4 4h18"
              className="stroke-border"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {TEXT_LINES.map((line) => (
              <rect
                key={line.y}
                x="92"
                y={line.y}
                width={line.width}
                height="6"
                rx="3"
                className="fill-bg-tertiary"
              />
            ))}
            {MARKS.map((mark) => (
              <g key={mark.label} className={mark.className}>
                <rect
                  x={mark.box.x}
                  y={mark.box.y}
                  width={mark.box.width}
                  height="12"
                  rx="3"
                  fill={mark.color}
                  fillOpacity="0.28"
                  stroke={mark.color}
                  strokeWidth="1.5"
                />
                <path
                  d={`M${mark.lineFrom} ${mark.box.y + 6}h${186 - mark.lineFrom - 2}`}
                  stroke={mark.color}
                  strokeWidth="1.5"
                  strokeDasharray="2 2"
                />
                <rect
                  x="186"
                  y={mark.pill.y}
                  width={mark.pill.width}
                  height="18"
                  rx="9"
                  fill={mark.color}
                />
                <text
                  x={186 + mark.pill.width / 2}
                  y={mark.pill.y + 12.5}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill={mark.textColor}
                  fontFamily="system-ui, sans-serif"
                >
                  {mark.label}
                </text>
              </g>
            ))}
            {MARKS.map((mark) => (
              <rect
                key={`bar-${mark.label}`}
                className="anonly-hw-bar"
                x={mark.box.x}
                y={mark.box.y + 1}
                width={mark.box.width}
                height="10"
                rx="2"
                fill="#030712"
              />
            ))}
          </g>

          <g className="anonly-hw-arrow">
            <circle cx="124" cy="78" r="20" className="fill-accent" />
            <path
              d="M124 68v18M116 79l8 8 8-8"
              className="stroke-accent-foreground"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          <g className="anonly-hw-lens">
            <circle
              cx="146"
              cy="36"
              r="14"
              className="fill-bg-primary/60 stroke-accent"
              strokeWidth="3"
            />
            <path d="M156 46l9 9" className="stroke-accent" strokeWidth="4" strokeLinecap="round" />
          </g>

          <g className="anonly-hw-check">
            <circle
              cx="168"
              cy="140"
              r="15"
              className="fill-success stroke-bg-primary"
              strokeWidth="3"
            />
            <path
              d="M161 140l5 5 9-9"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      </div>

      <ol className="flex flex-col gap-2">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="relative flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
          >
            {/* El resaltado del paso que acompaña a la fase de la animación. */}
            <span
              aria-hidden
              className={`anonly-hw-step ${STEP_CLASS[index] ?? ""} absolute -inset-px rounded-lg border border-accent/35 bg-accent/10`}
            />
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-sm font-semibold text-text-primary">
              {index + 1}
            </span>
            <span className="relative flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-text-primary">{step.title}</span>
              <span className="text-sm leading-snug text-text-secondary">{step.description}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
