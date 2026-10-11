/**
 * M-O2: la cadena de ADR-190 y las tres reglas candidatas (RC, CP, SV), simuladas FUERA DE LÍNEA sobre
 * lecturas medidas. Pura. **Es una simulación, no el producto**: la lectura de una página en un ángulo es
 * la primera lectura medida en ese ángulo (mismo ráster, mismo DPI), y la simulación decide qué ángulos habría
 * leído la cadena y cuál habría elegido. Dónde no puede decir nada (el reintento agrandado del paso 4) lo marca
 * en `upscaleNeeded` en vez de inventarlo.
 *
 * La cadena de hoy es la de `ocr.engine.ts` (`processPageInternal`):
 *
 * - sin veredicto (`osdHadVerdict: false`, página entera): si la primera lectura (a 0°) tiene una palabra
 *   confiable o la tinta es ≥ 0,002, se prueban 90°, 180° y 270°, y se elige con `pickBestOsdRecoveryReading`
 *   (entre las lecturas con alguna palabra confiable gana la de mayor confianza de página, y después la de más
 *   palabras confiables). Si no, no se prueba nada;
 * - con veredicto y tinta ≥ 0,002: paso 2 (si el ángulo no es 0°, se lee también 0° y se elige con
 *   `pickBestReading`: más palabras confiables, y después mayor confianza de página), paso 3 (si no hay
 *   lectura fiable, los ángulos que falten, en el orden 0, 90, 180, 270, cortando al encontrar una fiable) y
 *   paso 4 (reintento agrandado si sigue sin haber una fiable y el DPI es menor que 300);
 * - con veredicto y tinta < 0,002: nada.
 *
 * Las reglas:
 *
 * - **RC**: sin veredicto, si la primera lectura no trae ninguna palabra y la tinta es mayor que cero, se
 *   prueban 90°, 180° y 270° aunque la tinta quede debajo de 0,002. El aviso de ilegible conserva el umbral.
 * - **CP**: el comparador del paso 2 y del 3 pasa a ser el de la rama sin veredicto.
 * - **SV**: con veredicto, tinta mayor que cero y una lectura elegida con confianza de página menor que T, se
 *   prueban los ángulos que falten y se elige con CP.
 */

export const ANGLES = [0, 90, 180, 270] as const;
export type Angle = (typeof ANGLES)[number];

/** `INK_PRESENT_RATIO` de ADR-190 §3. */
export const INK_PRESENT_RATIO = 0.002;

export interface SimReading {
  readonly words: number;
  /** Palabras con confianza ≥ 0,6. */
  readonly reliable: number;
  /** Confianza de página (0 a 1). Una lectura sin resultado cuenta 0. */
  readonly conf: number;
  readonly durationMs: number | null;
  /** Datos esperados de la página (tokens y número). `null` si no hay qué esperar. */
  readonly ok: boolean | null;
  /** Datos del cuerpo y del sello (margen). `null` si el PDF no tiene esa parte. */
  readonly body: boolean | null;
  readonly stamp: boolean | null;
}

/** Lo que midió una observación de esa página (producción o veredicto forzado). */
export interface MeasuredRun {
  readonly angles: ReadonlyArray<number | null>;
  readonly upscaled: boolean;
  readonly finalAngle: number | null;
  readonly final: { readonly words: number; readonly reliable: number; readonly conf: number };
  readonly unreadable: boolean;
  readonly ok: boolean | null;
  readonly body: boolean | null;
  readonly stamp: boolean | null;
  /** Tipos de entidad que Regex encontró en la lectura final, y cuántas. */
  readonly entityCount: number;
}

export type SimGroup = "m1-text" | "m1-control" | "noise" | "margin" | "real";

export interface SimPage {
  readonly key: string;
  readonly group: SimGroup;
  readonly label: string;
  readonly sourceDpi: number | null;
  readonly effectiveDpi: number | null;
  readonly ink: number;
  readonly correctAngle: Angle | null;
  readonly natural: { readonly had: boolean; readonly orientation: number };
  readonly readings: Readonly<Partial<Record<Angle, SimReading>>>;
  /** Mediana de los reconocimientos que no fueron el primero de su observación, por ángulo (en caliente). */
  readonly warmMs: Readonly<Partial<Record<Angle, number>>>;
  readonly measured: Readonly<Partial<Record<"natural" | Angle, MeasuredRun>>>;
}

export interface Rules {
  readonly rc: boolean;
  readonly cp: boolean;
  /** Umbral T de SV, o `null` si no se aplica. */
  readonly sv: number | null;
}

export const TODAY: Rules = { rc: false, cp: false, sv: null };
export const CP_ONLY: Rules = { rc: false, cp: true, sv: null };

export interface Verdict {
  readonly had: boolean;
  readonly orientation: number;
}

export interface SimResult {
  /** Ángulos que la cadena habría leído, en orden. */
  readonly angles: ReadonlyArray<Angle>;
  readonly finalAngle: Angle;
  readonly final: SimReading;
  readonly unreadable: boolean;
  /** El paso 4 (agrandado) habría corrido y la simulación no puede decir qué leería. */
  readonly upscaleNeeded: boolean;
}

const isReliable = (reading: SimReading): boolean => reading.reliable > 0;

interface Held {
  readonly angle: Angle;
  readonly reading: SimReading;
}

/** `pickBestReading` de hoy (pasos 2 y 3): más palabras confiables, y después mayor confianza de página. */
export function pickToday(current: Held, candidate: Held): Held {
  if (candidate.reading.reliable !== current.reading.reliable)
    return candidate.reading.reliable > current.reading.reliable ? candidate : current;
  return candidate.reading.conf > current.reading.conf ? candidate : current;
}

/** CP, o `pickBestOsdRecoveryReading` de la rama sin veredicto: confianza de página primero. */
export function pickCp(current: Held, candidate: Held): Held {
  const currentReliable = isReliable(current.reading);
  const candidateReliable = isReliable(candidate.reading);
  if (currentReliable && !candidateReliable) return current;
  if (!currentReliable && candidateReliable) return candidate;
  if (!currentReliable) return current;
  if (candidate.reading.conf !== current.reading.conf)
    return candidate.reading.conf > current.reading.conf ? candidate : current;
  return candidate.reading.reliable > current.reading.reliable ? candidate : current;
}

function readingAt(page: SimPage, angle: Angle): SimReading {
  const reading = page.readings[angle];
  if (reading === undefined) throw new Error(`${page.key}: falta la lectura a ${angle}°`);
  return reading;
}

export function simulate(page: SimPage, verdict: Verdict, rules: Rules): SimResult {
  const orientation = verdict.orientation as Angle;
  const attempted: Angle[] = [orientation];
  let current: Held = { angle: orientation, reading: readingAt(page, orientation) };
  const ink = page.ink;
  const read = (angle: Angle, pick: (a: Held, b: Held) => Held): void => {
    attempted.push(angle);
    current = pick(current, { angle, reading: readingAt(page, angle) });
  };
  let upscaleNeeded = false;

  if (!verdict.had) {
    const probe =
      isReliable(current.reading) ||
      ink >= INK_PRESENT_RATIO ||
      (rules.rc && current.reading.words === 0 && ink > 0);
    if (probe) for (const angle of [90, 180, 270] as const) read(angle, pickCp);
  } else if (ink >= INK_PRESENT_RATIO) {
    const pick = rules.cp ? pickCp : pickToday;
    const tried = new Set<Angle>([orientation]);
    if (orientation !== 0) {
      tried.add(0);
      read(0, pick);
    }
    if (!isReliable(current.reading)) {
      for (const angle of ANGLES) {
        if (tried.has(angle)) continue;
        tried.add(angle);
        if (isReliable(current.reading)) break;
        read(angle, pick);
      }
    }
    if (!isReliable(current.reading) && (page.effectiveDpi ?? 300) < 300) upscaleNeeded = true;
  }

  if (rules.sv !== null && verdict.had && ink > 0 && current.reading.conf < rules.sv)
    for (const angle of ANGLES) if (!attempted.includes(angle)) read(angle, pickCp);

  return {
    angles: attempted,
    finalAngle: current.angle,
    final: current.reading,
    unreadable: ink >= INK_PRESENT_RATIO && !isReliable(current.reading),
    upscaleNeeded,
  };
}

// ------------------------------------------------------------------ resultado

export type SimOutcome = "recovered" | "warned" | "leak";

/** Los datos esperados de una lectura: los del PDF, o los del cuerpo y los del sello juntos. */
export function readingHasData(reading: SimReading): boolean | null {
  if (reading.ok !== null) return reading.ok;
  if (reading.body === null && reading.stamp === null) return null;
  return reading.body !== false && reading.stamp !== false;
}

export function outcomeOf(result: SimResult): SimOutcome {
  if (readingHasData(result.final) === true) return "recovered";
  return result.unreadable ? "warned" : "leak";
}

export function measuredOutcome(run: MeasuredRun): SimOutcome {
  const data =
    run.ok !== null
      ? run.ok
      : run.body === null && run.stamp === null
        ? null
        : run.body !== false && run.stamp !== false;
  if (data === true) return "recovered";
  return run.unreadable ? "warned" : "leak";
}

export function verdictFor(page: SimPage, scenario: "natural" | Angle): Verdict {
  return scenario === "natural" ? page.natural : { had: true, orientation: scenario };
}

/**
 * La simulación de la cadena de hoy contra lo que midió el producto: los mismos ángulos leídos y la misma
 * lectura final (palabras, palabras confiables y confianza de página). Si el paso 4 habría corrido no se
 * compara la lectura final (la simulación no sabe qué leería el agrandado).
 */
export interface Agreement {
  readonly sameAngles: boolean;
  readonly sameFinal: boolean | null;
}

export function compareWithMeasured(page: SimPage, scenario: "natural" | Angle): Agreement | null {
  const measured = page.measured[scenario];
  if (measured === undefined) return null;
  const result = simulate(page, verdictFor(page, scenario), TODAY);
  const measuredAngles = measured.angles.filter(
    (_, index) => !(measured.upscaled && index === measured.angles.length - 1),
  );
  const sameAngles =
    result.angles.length === measuredAngles.length &&
    result.angles.every((angle, index) => angle === measuredAngles[index]);
  if (result.upscaleNeeded || measured.upscaled) return { sameAngles, sameFinal: null };
  return {
    sameAngles,
    sameFinal:
      result.final.words === measured.final.words &&
      result.final.reliable === measured.final.reliable &&
      result.final.conf === measured.final.conf,
  };
}

// ------------------------------------------------------------------ referencia

/** La lectura de referencia de una página real: CP entre sus cuatro primeras lecturas. */
export function referenceAngle(page: SimPage): Angle | null {
  let best: Held | null = null;
  for (const angle of ANGLES) {
    const reading = page.readings[angle];
    if (reading === undefined) continue;
    const held: Held = { angle, reading };
    best = best === null ? held : pickCp(best, held);
  }
  return best !== null && isReliable(best.reading) ? best.angle : null;
}
