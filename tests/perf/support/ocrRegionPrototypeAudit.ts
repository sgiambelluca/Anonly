import { numericCandidates } from "../../e2e/support/exportVerificationOracle.js";

/** Match an identifier after normalizing both the OCR candidate and truth. */
export function containsIdentifierDigits(
  lines: ReadonlyArray<string>,
  identifier: string,
): boolean {
  const digits = identifier.replaceAll(/\D/gu, "");
  if (digits.length === 0) return false;
  return numericCandidates(lines).some((candidate) => candidate.includes(digits));
}
