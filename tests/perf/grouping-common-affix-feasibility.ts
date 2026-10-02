import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  levenshteinNormalized,
  levenshteinNormalizedAtLeast,
} from "../../packages/anonymization-core/grouping-engine/src/levenshtein.js";

type Corpus = "distinct" | "repeated";
type Mode = "current" | "trimmed";

const COUNTS = [250, 500, 1000, 2000] as const;
const SPECIAL_THRESHOLDS = [
  Number.NaN,
  Number.NEGATIVE_INFINITY,
  -1,
  0,
  1,
  2,
  Number.POSITIVE_INFINITY,
];

interface TrimmedPair {
  readonly left: string;
  readonly right: string;
  readonly removedPrefix: number;
  readonly removedSuffix: number;
}

interface DistanceResult {
  readonly distance: number;
}

interface TimedResult {
  readonly corpus: Corpus;
  readonly entityCount: number;
  readonly round: number;
  readonly mode: Mode;
  readonly processMs: number;
  readonly fuzzyLookupCalls: number;
  readonly groupCount: number;
  readonly aliasCount: number;
  readonly memberCount: number;
  readonly groupsFingerprint: string;
  readonly orderFingerprint: string;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

function makeRandomValue(random: () => number, length: number): string {
  const alphabet = ["a", "b", "c", "d", "ñ", "漢", "🙂", "𝄞"];
  let result = "";
  while (result.length < length) result += alphabet[random() % alphabet.length] ?? "a";
  return result.slice(0, length);
}

function trimCommonAffixes(left: string, right: string): TrimmedPair {
  let prefix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left.charAt(prefix) === right.charAt(prefix)
  ) {
    prefix += 1;
  }
  let leftEnd = left.length;
  let rightEnd = right.length;
  let suffix = 0;
  while (
    leftEnd > prefix &&
    rightEnd > prefix &&
    left.charAt(leftEnd - 1) === right.charAt(rightEnd - 1)
  ) {
    leftEnd -= 1;
    rightEnd -= 1;
    suffix += 1;
  }
  return {
    left: left.slice(prefix, leftEnd),
    right: right.slice(prefix, rightEnd),
    removedPrefix: prefix,
    removedSuffix: suffix,
  };
}

function boundedRadius(left: string, right: string, threshold: number): number | null {
  if (
    left.length === 0 ||
    right.length === 0 ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold >= 1
  ) {
    return null;
  }
  const originalLength = Math.max(left.length, right.length);
  const radius = Math.min(originalLength, Math.ceil((1 - threshold) * originalLength) + 1);
  return radius >= originalLength ? null : radius;
}

function bandedDistance(left: string, right: string, radius: number): DistanceResult {
  const sentinel = radius + 1;
  let previousRow = new Array<number>(right.length + 1).fill(sentinel);
  let currentRow = new Array<number>(right.length + 1).fill(sentinel);
  for (let column = 0; column <= Math.min(right.length, radius); column += 1) {
    previousRow[column] = column;
  }
  for (let row = 1; row <= left.length; row += 1) {
    const start = Math.max(1, row - radius);
    const end = Math.min(right.length, row + radius);
    currentRow[0] = row <= radius ? row : sentinel;
    if (start > 1) currentRow[start - 1] = sentinel;
    if (end < right.length) previousRow[end] = sentinel;
    let rowMinimum = currentRow[0] ?? sentinel;
    for (let column = start; column <= end; column += 1) {
      const substitutionCost = left.charAt(row - 1) === right.charAt(column - 1) ? 0 : 1;
      const deletion = (previousRow[column] ?? sentinel) + 1;
      const insertion = (currentRow[column - 1] ?? sentinel) + 1;
      const substitution = (previousRow[column - 1] ?? sentinel) + substitutionCost;
      const distance = Math.min(deletion, insertion, substitution);
      currentRow[column] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > radius) return { distance: sentinel };
    const swap = previousRow;
    previousRow = currentRow;
    currentRow = swap;
  }
  return { distance: previousRow[right.length] ?? sentinel };
}

function trimmedPredicate(left: string, right: string, threshold: number): boolean {
  const radius = boundedRadius(left, right, threshold);
  if (radius === null) return levenshteinNormalized(left, right) >= threshold;
  const originalLength = Math.max(left.length, right.length);
  if (Math.abs(left.length - right.length) > radius) return false;
  const trimmed = trimCommonAffixes(left, right);
  const result = bandedDistance(trimmed.left, trimmed.right, radius);
  return result.distance <= radius && 1 - result.distance / originalLength >= threshold;
}

function assertDifferential(seed: number): {
  readonly pairCount: number;
  readonly firstMatchCount: number;
} {
  const random = seededRandom(seed);
  const values = ["", "a", "aa", "ab", "abc", "🙂", "𝄞x", "漢字", "abcdefghij"];
  for (let index = 0; index < 1500; index += 1) {
    values.push(makeRandomValue(random, random() % 64));
  }
  const thresholds = [...SPECIAL_THRESHOLDS, 0.001, 0.1, 0.25, 0.5, 0.75, 0.88, 0.9, 0.99, 0.999];
  let pairCount = 0;
  for (let index = 0; index < 16000; index += 1) {
    const left = values[random() % values.length] ?? "";
    const right = values[random() % values.length] ?? "";
    const threshold = thresholds[random() % thresholds.length] ?? 0.88;
    const expected = levenshteinNormalized(left, right) >= threshold;
    const actual = trimmedPredicate(left, right, threshold);
    if (actual !== expected) {
      throw new Error(`Predicate mismatch pair=${index} lengths=${left.length},${right.length}`);
    }
    pairCount += 1;
  }

  let firstMatchCount = 0;
  for (let sample = 0; sample < 600; sample += 1) {
    const threshold = [0.5, 0.75, 0.88, 0.9, 0.99][sample % 5] ?? 0.88;
    const groups = Array.from({ length: 20 }, () =>
      Array.from({ length: 1 + (random() % 4) }, () => values[random() % values.length] ?? ""),
    );
    const query = values[random() % values.length] ?? "";
    const findFirst = (predicate: (a: string, b: string, t: number) => boolean): string | null => {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const aliases = groups[groupIndex] ?? [];
        for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
          if (predicate(query, aliases[aliasIndex] ?? "", threshold))
            return `${groupIndex}:${aliasIndex}`;
        }
      }
      return null;
    };
    if (
      findFirst((a, b, t) => levenshteinNormalizedAtLeast(a, b, t)) !== findFirst(trimmedPredicate)
    ) {
      throw new Error(`First-match mismatch sample=${sample}`);
    }
    firstMatchCount += 1;
  }
  return { pairCount, firstMatchCount };
}

function syntheticValue(index: number, corpus: Corpus): string {
  const bucket = corpus === "repeated" ? index % 24 : index;
  const neutralToken = createHash("sha256").update(`entity-${bucket}`).digest("hex").slice(0, 16);
  return `persona adversarial ${neutralToken}`;
}

function runBenchmark(entityCount: number, corpus: Corpus, round: number, mode: Mode): TimedResult {
  const values = Array.from({ length: entityCount }, (_, index) => syntheticValue(index, corpus));
  const groups: string[][] = [];
  let fuzzyLookupCalls = 0;
  const started = performance.now();
  for (const query of values) {
    const exactGroup = groups.find((aliases) => aliases.includes(query));
    if (exactGroup !== undefined) continue;
    let matchingGroup: string[] | undefined;
    for (const aliases of groups) {
      for (const alias of aliases) {
        fuzzyLookupCalls += 1;
        if (mode === "trimmed") {
          if (trimmedPredicate(query, alias, 0.88)) {
            matchingGroup = aliases;
            break;
          }
        } else {
          if (levenshteinNormalizedAtLeast(query, alias, 0.88)) {
            matchingGroup = aliases;
            break;
          }
        }
      }
      if (matchingGroup !== undefined) break;
    }
    if (matchingGroup !== undefined) matchingGroup.push(query);
    else groups.push([query]);
  }
  const processMs = performance.now() - started;
  const digest = (items: ReadonlyArray<string>): string =>
    createHash("sha256").update(items.join("\n")).digest("hex");
  const shape = groups.map((aliases, index) => `${index}:${aliases.length}:${aliases.join("|")}`);
  const orderedValues = groups.map((aliases, index) => `${index}:${aliases[0] ?? ""}`);
  return {
    corpus,
    entityCount,
    round,
    mode,
    processMs,
    fuzzyLookupCalls,
    groupCount: groups.length,
    aliasCount: groups.reduce((sum, aliases) => sum + aliases.length, 0),
    memberCount: entityCount,
    groupsFingerprint: digest(shape),
    orderFingerprint: digest(orderedValues),
  };
}

async function main(): Promise<void> {
  const differential = assertDifferential(0x176a);
  const results: TimedResult[] = [];
  for (const entityCount of COUNTS) {
    for (const corpus of ["distinct", "repeated"] as const) {
      for (let round = 1; round <= 3; round += 1) {
        const firstMode: Mode = round % 2 === 0 ? "trimmed" : "current";
        const secondMode: Mode = firstMode === "current" ? "trimmed" : "current";
        results.push(runBenchmark(entityCount, corpus, round, firstMode));
        results.push(runBenchmark(entityCount, corpus, round, secondMode));
      }
    }
  }
  const output = { differential, results };
  const outputDir = resolve(
    process.env.ANONLY_GROUPING_AFFIX_OUTPUT_DIR ?? ".measure/grouping-common-affix-feasibility",
  );
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `grouping-common-affix-${Date.now()}.json`);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

void main();
