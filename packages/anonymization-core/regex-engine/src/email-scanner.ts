/** Half-open UTF-16 span emitted by the default email scanner. */
export interface EmailMatchSpan {
  readonly startIndex: number;
  readonly endIndexExclusive: number;
}

const DOT = 46;

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isLocalPartCharacter(code: number): boolean {
  return (
    isAsciiLetter(code) ||
    isAsciiDigit(code) ||
    code === 46 ||
    code === 95 ||
    code === 37 ||
    code === 43 ||
    code === 45
  );
}

function isDomainCharacter(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code) || code === DOT || code === 45;
}

function isRegexWordCharacter(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code) || code === 95;
}

function hasWordBoundary(text: string, index: number): boolean {
  const before = index > 0 ? text.charCodeAt(index - 1) : -1;
  const current = index < text.length ? text.charCodeAt(index) : -1;
  return isRegexWordCharacter(before) !== isRegexWordCharacter(current);
}

function findLongestDomainEnd(text: string, atIndex: number): number | undefined {
  let domainEnd = atIndex + 1;
  while (domainEnd < text.length && isDomainCharacter(text.charCodeAt(domainEnd))) domainEnd++;

  let longestEnd: number | undefined;
  for (let dotIndex = atIndex + 2; dotIndex < domainEnd; dotIndex++) {
    if (text.charCodeAt(dotIndex) !== DOT) continue;

    let suffixEnd = dotIndex + 1;
    while (suffixEnd < domainEnd && isAsciiLetter(text.charCodeAt(suffixEnd))) suffixEnd++;
    if (suffixEnd - dotIndex - 1 < 2 || !hasWordBoundary(text, suffixEnd)) continue;
    if (longestEnd === undefined || suffixEnd > longestEnd) longestEnd = suffixEnd;
  }
  return longestEnd;
}

/**
 * Finds matches equivalent to `/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g`.
 * Candidate local and domain runs are disjoint across `@` separators, so all
 * scans together are linear in the UTF-16 input length plus emitted matches.
 */
export function scanEmailDefault(text: string): ReadonlyArray<EmailMatchSpan> {
  const spans: EmailMatchSpan[] = [];
  let lastIndex = 0;
  let searchIndex = 0;

  while (searchIndex < text.length) {
    const atIndex = text.indexOf("@", searchIndex);
    if (atIndex < 0) break;
    searchIndex = atIndex + 1;

    let localStart = atIndex;
    while (localStart > 0 && isLocalPartCharacter(text.charCodeAt(localStart - 1))) localStart--;
    if (localStart === atIndex) continue;

    let matchStart = Math.max(localStart, lastIndex);
    while (matchStart < atIndex && !hasWordBoundary(text, matchStart)) matchStart++;
    if (matchStart >= atIndex) continue;

    const matchEnd = findLongestDomainEnd(text, atIndex);
    if (matchEnd === undefined) continue;

    spans.push({ startIndex: matchStart, endIndexExclusive: matchEnd });
    lastIndex = matchEnd;
  }

  return spans;
}
