export type OcrPage = {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly lines: ReadonlyArray<string>;
};

export type OcrDocument = {
  readonly pages: ReadonlyArray<OcrPage>;
};

export type ExportVerificationFixture = {
  readonly id: string;
  readonly expectedPageCount: number;
  readonly source: OcrDocument;
  readonly output: OcrDocument;
  readonly neighborsByPage: ReadonlyArray<ReadonlyArray<string>>;
  readonly sourceIdentifiersByPage: ReadonlyArray<ReadonlyArray<string>>;
  readonly forbiddenIdentifiers: ReadonlyArray<string>;
  readonly allowedIdentifiers?: ReadonlyArray<string>;
};

export type VerificationResult =
  | {
      readonly status: "CUMPLE";
      readonly fixtureId: string;
      readonly pageResults: ReadonlyArray<string>;
    }
  | {
      readonly status: "NO CUMPLE";
      readonly fixtureId: string;
      readonly reasons: ReadonlyArray<string>;
    }
  | {
      readonly status: "INCONCLUSO";
      readonly fixtureId: string;
      readonly reasons: ReadonlyArray<string>;
    };

const MARKS = /\p{M}+/gu;
const SPACES = /\s+/gu;
const CANDIDATE_RE = /[0-9IL|OSB](?:[0-9IL|OSB .\-/]*[0-9IL|OSB])?/giu;
const CONFUSABLES: Readonly<Record<string, string>> = {
  I: "1",
  L: "1",
  "|": "1",
  O: "0",
  S: "5",
  B: "8",
};

export function normalizePhrase(value: string): string {
  return value.normalize("NFKD").replace(MARKS, "").toUpperCase().replace(SPACES, " ").trim();
}

function normalizeNumericCandidate(value: string): string {
  return [...value.toUpperCase()]
    .filter((char) => !/[ .\-/]/u.test(char))
    .map((char) => CONFUSABLES[char] ?? char)
    .join("");
}

export function numericCandidates(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  const candidates: string[] = [];
  for (const line of lines) {
    for (const match of normalizePhrase(line).matchAll(CANDIDATE_RE)) {
      const rawCandidate = match[0];
      const value = normalizeNumericCandidate(rawCandidate);
      if (/[0-9]/u.test(rawCandidate) && value.length >= 4) candidates.push(value);
    }
  }
  return candidates;
}

export function findForbiddenNumericFragments(
  lines: ReadonlyArray<string>,
  forbiddenIdentifiers: ReadonlyArray<string>,
  allowedIdentifiers: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  const allowed = new Set(allowedIdentifiers.map(normalizeNumericCandidate));
  const candidates = numericCandidates(lines);
  const fragments = forbiddenIdentifiers.flatMap((identifier) => {
    const normalized = normalizeNumericCandidate(identifier);
    return normalized.length >= 8
      ? [normalized, normalized.slice(0, 4), normalized.slice(-4)]
      : [normalized];
  });
  const matches = new Set<string>();
  for (const candidate of candidates) {
    if (allowed.has(candidate)) continue;
    for (const fragment of fragments) {
      if (fragment.length > 0 && candidate.includes(fragment)) matches.add(fragment);
    }
  }
  return [...matches];
}

function pageHasPhrase(page: OcrPage, phrase: string): boolean {
  const expected = normalizePhrase(phrase);
  return page.lines.some((line) => ` ${normalizePhrase(line)} `.includes(` ${expected} `));
}

export function verifyExport(fixture: ExportVerificationFixture): VerificationResult {
  const inconclusive: string[] = [];
  const failures: string[] = [];
  if (fixture.source.pages.length !== fixture.expectedPageCount) {
    inconclusive.push(
      `fuente: se esperaban ${fixture.expectedPageCount} páginas y hay ${fixture.source.pages.length}`,
    );
  }
  if (fixture.output.pages.length !== fixture.expectedPageCount) {
    failures.push(
      `salida: se esperaban ${fixture.expectedPageCount} páginas y hay ${fixture.output.pages.length}`,
    );
  }
  fixture.source.pages.forEach((page, pageIndex) => {
    const expectedNeighbors = fixture.neighborsByPage[pageIndex] ?? [];
    for (const neighbor of expectedNeighbors) {
      if (!pageHasPhrase(page, neighbor))
        inconclusive.push(`fuente página ${pageIndex + 1}: OCR no leyó vecino "${neighbor}"`);
    }
    for (const identifier of fixture.sourceIdentifiersByPage[pageIndex] ?? []) {
      if (
        !numericCandidates(page.lines).some((candidate) =>
          candidate.includes(normalizeNumericCandidate(identifier)),
        )
      ) {
        inconclusive.push(
          `fuente página ${pageIndex + 1}: OCR no leyó objetivo completo "${identifier}"`,
        );
      }
    }
  });
  if (inconclusive.length > 0)
    return { status: "INCONCLUSO", fixtureId: fixture.id, reasons: inconclusive };

  fixture.output.pages.forEach((page, pageIndex) => {
    const sourcePage = fixture.source.pages[pageIndex];
    if (sourcePage !== undefined) {
      if (
        Math.abs(page.widthPt - sourcePage.widthPt) > 0.01 ||
        Math.abs(page.heightPt - sourcePage.heightPt) > 0.01
      ) {
        failures.push(
          `salida página ${pageIndex + 1}: dimensiones presentadas no coinciden con la fuente`,
        );
      }
    }
    for (const neighbor of fixture.neighborsByPage[pageIndex] ?? []) {
      if (!pageHasPhrase(page, neighbor))
        failures.push(`salida página ${pageIndex + 1}: falta vecino "${neighbor}"`);
    }
    const leaked = findForbiddenNumericFragments(
      page.lines,
      fixture.forbiddenIdentifiers,
      fixture.allowedIdentifiers,
    );
    for (const fragment of leaked)
      failures.push(`salida página ${pageIndex + 1}: fragmento numérico prohibido "${fragment}"`);
  });
  if (failures.length > 0) return { status: "NO CUMPLE", fixtureId: fixture.id, reasons: failures };
  return {
    status: "CUMPLE",
    fixtureId: fixture.id,
    pageResults: fixture.output.pages.map(
      (_page, index) => `página ${index + 1}: vecinos presentes y sin fragmentos prohibidos`,
    ),
  };
}
