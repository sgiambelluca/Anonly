/**
 * `releaseNotes.ts` — las novedades de cada versión, escritas para quien usa la
 * aplicación (`ui/Components.md` §2.9b, ADR-216 §3 y §4).
 *
 * Es un dato `readonly` tipado que se compila dentro de la interfaz, igual que
 * el número de versión (`__ANONLY_VERSION__`): el menú de novedades del pie de
 * `LoadScreen` no se conecta a nada (`PRIVACY.md`, ADR-216 Contexto §3). El
 * detalle completo sigue en GitHub Releases; los `CHANGELOG.md` de Changesets
 * son el registro técnico y no alimentan esto.
 *
 * **Reglas de redacción** (ADR-216 §3):
 *
 * - Se escribe para quien usa la aplicación. Sin ADR, sin nombres de archivos,
 *   paquetes ni herramientas.
 * - Una oración por novedad, de 140 caracteres como máximo.
 * - Dos o tres novedades por versión alcanzan.
 * - Cuando cambia la detección, una novedad lo dice: el mismo documento puede
 *   dar otro resultado (`Roadmap_1.x.md` §2).
 *
 * **Al preparar un release**, la entrada de la versión nueva va primera y se
 * escribe después de `pnpm run version` (`RELEASING.md`). El test
 * `release-notes.test.ts` falla hasta que la primera entrada coincide con la
 * versión de `apps/desktop-shell/package.json`: es lo que impide publicar una
 * versión sin novedades. Solo figuran las versiones estables publicadas: la lista
 * empieza en la 1.0.0.
 */

/** Qué clase de novedad es (ADR-216 §3). */
export type ReleaseNoteKind =
  /** Algo que antes no se podía hacer. */
  | "new"
  /** Algo que ya existía y ahora funciona mejor. */
  | "improvement"
  /** Algo que fallaba. */
  | "fix";

export interface ReleaseNote {
  readonly kind: ReleaseNoteKind;
  /** Una oración, de 140 caracteres como máximo. */
  readonly text: string;
}

export interface ReleaseNotesEntry {
  /** `X.Y.Z`, igual que `package.json`. */
  readonly version: string;
  /** Fecha de publicación, `AAAA-MM-DD`. */
  readonly date: string;
  /** Un resumen de una línea, opcional. */
  readonly summary?: string;
  readonly notes: ReadonlyArray<ReleaseNote>;
}

/** Más nueva primero. */
export const RELEASE_NOTES: ReadonlyArray<ReleaseNotesEntry> = [
  {
    version: "1.0.1",
    date: "2026-10-02",
    notes: [
      {
        kind: "improvement",
        text: "Las actualizaciones muestran el avance de la descarga y se instalan sin asistente.",
      },
      {
        kind: "improvement",
        text: "Con «Instalar automáticamente», la actualización se instala al cerrar Anonly (en macOS, al abrirlo).",
      },
      {
        kind: "fix",
        text: "Si la instalación se corta en Windows, se vuelve a correr sola.",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-02",
    summary: "Primera versión estable.",
    notes: [],
  },
];
