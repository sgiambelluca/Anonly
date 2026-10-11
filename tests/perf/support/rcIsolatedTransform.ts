import { createHash } from "node:crypto";

/** ADR-218: isolated build-only transform; both historical and adopted modes are explicit. */
export type RcArm = "A" | "RC";
export type RcSourceMode = "experimental" | "adopted";
/** Exact pre-adoption source shape retained for historical experimental runs. */
export const RC_PREDICATE = "(isReliableReading(reading.words) || inkRatio >= INK_PRESENT_RATIO)";
export const RC_REPLACEMENT =
  "(isReliableReading(reading.words) || inkRatio >= INK_PRESENT_RATIO || (reading.words.length === 0 && inkRatio > 0))";
/** Exact Prettier output currently shipped by the adopted product source. */
export const RC_ADOPTED_PREDICATE = `(isReliableReading(reading.words) ||
        inkRatio >= INK_PRESENT_RATIO ||
        (reading.words.length === 0 && inkRatio > 0))`;
export const RC_ADOPTED_CONTROL = `(isReliableReading(reading.words) ||
        inkRatio >= INK_PRESENT_RATIO)`;
const CONTEXT = "      !isRegion &&\n      !firstPass.osdHadVerdict &&\n      ";
const condition = (predicate: string): string => `${CONTEXT}${predicate}`;
const hash = (source: string): string => createHash("sha256").update(source).digest("hex");

export interface RcTransformIdentity {
  readonly schema: 1;
  readonly arm: RcArm;
  readonly mode: RcSourceMode;
  readonly matches: 1;
  readonly sourceSha256: string;
  readonly transformedSha256: string;
}

export function parseRcSourceMode(value: string | undefined): RcSourceMode {
  const mode = value ?? "experimental";
  if (mode !== "experimental" && mode !== "adopted") throw new Error("RC source mode unsupported");
  return mode;
}

/** Persisted identities must carry the closed enum explicitly; only env/CLI input defaults. */
export function requirePersistedRcSourceMode(value: unknown): RcSourceMode {
  if (value !== "experimental" && value !== "adopted")
    throw new Error("RC persisted source mode missing or unsupported");
  return value;
}

export function assertRcRendererIdentity(
  mode: RcSourceMode,
  normalRendererSha256: string,
  rcRendererSha256: string,
): void {
  const isHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
  if (
    !isHash(normalRendererSha256) ||
    !isHash(rcRendererSha256) ||
    (mode === "adopted" && normalRendererSha256 !== rcRendererSha256)
  )
    throw new Error("RC renderer identity mismatch");
}

export function transformRcSource(
  source: string,
  arm: RcArm,
  mode: RcSourceMode = "experimental",
): string {
  if (arm !== "A" && arm !== "RC") throw new Error("RC arm unsupported");
  if (mode === "experimental") {
    const expected = condition(RC_PREDICATE);
    if (
      source.split(RC_PREDICATE).length !== 2 ||
      source.split(expected).length !== 2 ||
      source.includes(condition(RC_REPLACEMENT)) ||
      source.includes(condition(RC_ADOPTED_PREDICATE)) ||
      source.includes(condition(RC_ADOPTED_CONTROL))
    )
      throw new Error("RC predicate identity mismatch");
    return arm === "A" ? source : source.replace(RC_PREDICATE, RC_REPLACEMENT);
  }
  if (mode === "adopted") {
    if (
      source.split(RC_ADOPTED_PREDICATE).length !== 2 ||
      source.split(condition(RC_ADOPTED_PREDICATE)).length !== 2 ||
      source.includes(condition(RC_ADOPTED_CONTROL)) ||
      source.includes(condition(RC_PREDICATE)) ||
      source.includes(condition(RC_REPLACEMENT))
    )
      throw new Error("RC predicate identity mismatch");
    return arm === "RC" ? source : source.replace(RC_ADOPTED_PREDICATE, RC_ADOPTED_CONTROL);
  }
  throw new Error("RC source mode unsupported");
}

export function createRcTransformIdentity(
  source: string,
  arm: RcArm,
  mode: RcSourceMode,
): RcTransformIdentity {
  const transformed = transformRcSource(source, arm, mode);
  return {
    schema: 1,
    arm,
    mode,
    matches: 1,
    sourceSha256: hash(source),
    transformedSha256: hash(transformed),
  };
}

export function assertRcTransformIdentity(
  value: unknown,
  source: string,
  arm: RcArm,
  mode: RcSourceMode,
): asserts value is RcTransformIdentity {
  if (typeof value !== "object" || value === null)
    throw new Error("RC transform identity mismatch");
  const record = value as Record<string, unknown>;
  let expected: RcTransformIdentity;
  try {
    expected = createRcTransformIdentity(source, arm, mode);
  } catch {
    throw new Error("RC transform identity mismatch");
  }
  if (
    record.schema !== expected.schema ||
    record.arm !== expected.arm ||
    record.mode !== expected.mode ||
    record.matches !== expected.matches ||
    record.sourceSha256 !== expected.sourceSha256 ||
    record.transformedSha256 !== expected.transformedSha256
  )
    throw new Error("RC transform identity mismatch");
}
