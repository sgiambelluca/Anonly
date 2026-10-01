/** Brazos de la campaña del pool OCR. `4b` y `6b` llevan el presupuesto de imágenes vivas ampliado. */

const MIB = 1024 * 1024;
export const DEFAULT_MAX_LIVE_IMAGE_BYTES = 128 * MIB;
const ULTRA_WIDE_BUDGET_BYTES = 200 * MIB;
/** Cuatro A4 a 300 dpi (33,2 MiB cada una). */
const ULTRA_FOUR_PAGES_BUDGET_BYTES = 136 * MIB;

export const ARM_LABELS = ["1", "2", "3", "4", "4b", "6", "6b"] as const;
export type ArmLabel = (typeof ARM_LABELS)[number];

export interface OcrPoolArm {
  readonly label: ArmLabel;
  readonly poolSize: number;
  readonly maxLiveImageBytes: number;
}

export function parseArmLabel(label: string): OcrPoolArm | undefined {
  const found = ARM_LABELS.find((candidate) => candidate === label);
  if (found === undefined) return undefined;
  return {
    label: found,
    poolSize: Number.parseInt(found, 10),
    maxLiveImageBytes:
      found === "6b"
        ? ULTRA_WIDE_BUDGET_BYTES
        : found === "4b"
          ? ULTRA_FOUR_PAGES_BUDGET_BYTES
          : DEFAULT_MAX_LIVE_IMAGE_BYTES,
  };
}

/**
 * Con 6 reconocedores, o con un presupuesto distinto del de 128 MiB, el presupuesto de imágenes
 * vivas puede frenar a los últimos: ese pico se registra, no se afirma.
 */
export function assertsFullOccupancy(arm: OcrPoolArm): boolean {
  return arm.poolSize <= 4 && arm.maxLiveImageBytes === DEFAULT_MAX_LIVE_IMAGE_BYTES;
}
