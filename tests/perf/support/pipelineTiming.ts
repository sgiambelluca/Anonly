/**
 * `support/pipelineTiming.ts` — la decisión de `pipeline-timing.spec.ts`
 * (gate de Performance, ADR-149/ADR-153) sobre qué se exige y qué solo se
 * reporta. Vive acá, como función pura, para poder probarla con Vitest sin
 * arrancar Electron.
 *
 * **Dos niveles** (decisión del humano, 2026-09-29; ADR-149 §5,
 * `07_Performance_Strategy.md` §11.4):
 *
 * - **Siempre** (CI incluido): el pipeline llegó a `Ready`, sin
 *   `PIPELINE_FAILED`, y algo corrió de verdad (un tiempo positivo). Sin eso
 *   el gate mediría nada, que es exactamente lo que ADR-149 prohíbe.
 * - **Solo con `ANONLY_PERF_ENFORCE_BUDGET=1`** (local, antes de cada
 *   release): además, el presupuesto de tiempo de `00_Project_Vision.md` §7 y
 *   la primera fila de ADR-151 §3 (la página 1 ya estaba dibujada, sin
 *   `RENDER_REQUESTED`). El runner de CI no es el hardware de referencia del
 *   objetivo de 8 s, que sigue sin decidir (Hito 11), así que ahí se mide y se
 *   reporta pero no se aplica el umbral.
 */

export const ENFORCE_BUDGET_ENV = "ANONLY_PERF_ENFORCE_BUDGET";

/** El umbral se aplica solo con `ANONLY_PERF_ENFORCE_BUDGET=1` (cualquier otro valor, o ausente, no). */
export function isBudgetEnforced(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[ENFORCE_BUDGET_ENV] === "1";
}

export interface PipelineTimingSample {
  readonly startedAt: number;
  readonly readyAt?: number | undefined;
  readonly failedAt?: number | undefined;
}

export interface TimingVerdict {
  /** `readyAt - startedAt`, o `null` si el pipeline no llegó a `Ready`. */
  readonly elapsedMs: number | null;
  /** Vacío = el gate pasa. Cada elemento explica un motivo de rojo. */
  readonly failures: ReadonlyArray<string>;
}

/**
 * Evalúa una corrida de import → `Ready`. Las condiciones de "no llegó / no
 * corrió" fallan siempre; superar `budgetMs` solo si `enforceBudget`.
 */
export function evaluatePipelineTiming(
  sample: PipelineTimingSample,
  budgetMs: number,
  enforceBudget: boolean,
): TimingVerdict {
  const failures: string[] = [];
  if (sample.failedAt !== undefined) {
    failures.push("el pipeline terminó en PIPELINE_FAILED, no en Ready");
  }
  if (sample.readyAt === undefined) {
    failures.push("el pipeline no llegó a Ready");
    return { elapsedMs: null, failures };
  }
  const elapsedMs = sample.readyAt - sample.startedAt;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    failures.push(`no se midió ningún trabajo: tiempo ${elapsedMs} ms (se exige > 0)`);
  } else if (enforceBudget && elapsedMs >= budgetMs) {
    failures.push(
      `import -> Ready tardó ${Math.round(elapsedMs)} ms, no menos de ${budgetMs} ms ` +
        `(${ENFORCE_BUDGET_ENV}=1)`,
    );
  }
  return { elapsedMs, failures };
}

/**
 * Primera fila de ADR-151 §3: al abrir el panel de trabajo la página 1 ya
 * estaba en el store, sin `RENDER_REQUESTED` de por medio. Solo se exige con
 * `enforceBudget`; sin él se reporta el valor observado.
 */
export function evaluateFirstPageWarm(
  renderRequestedForFirstOriginalPage: boolean,
  enforceBudget: boolean,
): ReadonlyArray<string> {
  if (enforceBudget && renderRequestedForFirstOriginalPage) {
    return [
      "la UI tuvo que pedir el render de la página 1 (RENDER_REQUESTED): " +
        `el precalentado de ADR-151 §1 no llegó a tiempo (${ENFORCE_BUDGET_ENV}=1)`,
    ];
  }
  return [];
}
