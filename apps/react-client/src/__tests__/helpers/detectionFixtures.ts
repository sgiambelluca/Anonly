/**
 * Fixtures compartidos de los tests de «Formatos de detección» (F7, tanda 1).
 * Todo inventado: ningún dato de un documento real.
 */

import {
  EntityType,
  type FormatDefinition,
  type UserEntityTypeDefinition,
  type UserEntityTypeId,
} from "@anonly/anonymization-core";

import { DEFAULT_DETECTION_STATE, type DetectionState } from "../../store/detectionState.js";

const UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
] as const;

export function uuid(n: number): string {
  return UUIDS[n] ?? `99999999-9999-4999-8999-${String(n).padStart(12, "0")}`;
}

export function userType(n: number, name: string): UserEntityTypeDefinition {
  const id: UserEntityTypeId = `user:${uuid(n)}`;
  return { id, name };
}

export function userFormat(
  n: number,
  name: string,
  entityType: FormatDefinition["entityType"] = EntityType.Phone,
  overrides: Partial<FormatDefinition> = {},
): FormatDefinition {
  return {
    id: `fmt:${uuid(n)}`,
    name,
    entityType,
    variants: [[{ kind: "chars", charClass: "digit", min: 3, max: 5 }]],
    enabled: true,
    ...overrides,
  };
}

export function stateWith(patch: Partial<DetectionState>): DetectionState {
  return { ...DEFAULT_DETECTION_STATE, ...patch };
}

/** Un id sintético de un generador de ids determinista para `planFormatsImport`. */
export function sequentialIds(start = 0): () => string {
  let next = start;
  return () => {
    const value = uuid(next);
    next += 1;
    return value;
  };
}
