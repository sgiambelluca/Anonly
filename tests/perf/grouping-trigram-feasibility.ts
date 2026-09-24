import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  levenshteinNormalized,
  levenshteinNormalizedAtLeast,
} from "../../packages/anonymization-core/grouping-engine/src/levenshtein.js";

type Corpus = "distinct" | "repeated";
type TrigramSignature = ReadonlyArray<string>;

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
  while (result.length < length) {
    result += alphabet[random() % alphabet.length] ?? "a";
  }
  return result.slice(0, length);
}

function makeSignature(value: string): TrigramSignature {
  const tokens: string[] = [];
  for (let offset = 0; offset + 3 <= value.length; offset += 1) {
    tokens.push(value.slice(offset, offset + 3));
  }
  return tokens.sort();
}

function multisetIntersection(left: TrigramSignature, right: TrigramSignature): number {
  let leftIndex = 0;
  let rightIndex = 0;
  let overlap = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const a = left[leftIndex] ?? "";
    const b = right[rightIndex] ?? "";
    if (a === b) {
      overlap += 1;
      leftIndex += 1;
      rightIndex += 1;
    } else if (a < b) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return overlap;
}

function boundedRadius(a: string, b: string, threshold: number): number | null {
  if (
    a.length === 0 ||
    b.length === 0 ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold >= 1
  ) {
    return null;
  }
  const maxLength = Math.max(a.length, b.length);
  const radius = Math.min(maxLength, Math.ceil((1 - threshold) * maxLength) + 1);
  return radius >= maxLength ? null : radius;
}

function mayPassTrigramFilter(
  a: string,
  aSignature: TrigramSignature,
  b: string,
  bSignature: TrigramSignature,
  threshold: number,
): boolean {
  const radius = boundedRadius(a, b, threshold);
  if (radius === null) return true;
  const floor = Math.max(0, Math.max(a.length - 2, b.length - 2) - 3 * radius);
  return multisetIntersection(aSignature, bSignature) >= floor;
}

function assertDifferential(seed: number): {
  readonly pairCount: number;
  readonly firstMatchCount: number;
} {
  const random = seededRandom(seed);
  const values = ["", "a", "aa", "ab", "abc", "🙂", "𝄞x", "漢字", "abcdefghij"];
  for (let index = 0; index < 1400; index += 1) {
    values.push(makeRandomValue(random, random() % 50));
  }

  let pairCount = 0;
  const thresholds = [...SPECIAL_THRESHOLDS, 0.01, 0.25, 0.5, 0.75, 0.88, 0.9, 0.99];
  for (let index = 0; index < 12000; index += 1) {
    const leftIndex = random() % values.length;
    const rightIndex = random() % values.length;
    const left = values[leftIndex] ?? "";
    const right = values[rightIndex] ?? "";
    const threshold = thresholds[random() % thresholds.length] ?? 0.88;
    const expected = levenshteinNormalized(left, right) >= threshold;
    const permitted = mayPassTrigramFilter(
      left,
      makeSignature(left),
      right,
      makeSignature(right),
      threshold,
    );
    const actual = permitted && levenshteinNormalizedAtLeast(left, right, threshold);
    if (actual !== expected || (expected && !permitted)) {
      throw new Error(`Differential mismatch pair=${index} lengths=${left.length},${right.length}`);
    }
    pairCount += 1;
  }

  let firstMatchCount = 0;
  for (let sample = 0; sample < 500; sample += 1) {
    const threshold = [0.5, 0.75, 0.88, 0.9, 0.99][sample % 5] ?? 0.88;
    const aliases: string[][] = [];
    for (let groupIndex = 0; groupIndex < 20; groupIndex += 1) {
      aliases.push(
        Array.from({ length: 1 + (random() % 4) }, () => {
          const source = values[random() % values.length] ?? "";
          return source;
        }),
      );
    }
    const query = values[random() % values.length] ?? "";
    let expected: string | null = null;
    let actual: string | null = null;
    for (let groupIndex = 0; groupIndex < aliases.length; groupIndex += 1) {
      const groupAliases = aliases[groupIndex] ?? [];
      for (let aliasIndex = 0; aliasIndex < groupAliases.length; aliasIndex += 1) {
        const alias = groupAliases[aliasIndex] ?? "";
        if (levenshteinNormalizedAtLeast(query, alias, threshold)) {
          expected = `${groupIndex}:${aliasIndex}`;
          break;
        }
      }
      if (expected !== null) break;
    }
    for (let groupIndex = 0; groupIndex < aliases.length; groupIndex += 1) {
      const groupAliases = aliases[groupIndex] ?? [];
      for (let aliasIndex = 0; aliasIndex < groupAliases.length; aliasIndex += 1) {
        const alias = groupAliases[aliasIndex] ?? "";
        if (
          mayPassTrigramFilter(
            query,
            makeSignature(query),
            alias,
            makeSignature(alias),
            threshold,
          ) &&
          levenshteinNormalizedAtLeast(query, alias, threshold)
        ) {
          actual = `${groupIndex}:${aliasIndex}`;
          break;
        }
      }
      if (actual !== null) break;
    }
    if (actual !== expected) throw new Error(`First-match mismatch sample=${sample}`);
    firstMatchCount += 1;
  }
  return { pairCount, firstMatchCount };
}

function syntheticValue(index: number, corpus: Corpus): string {
  const bucket = corpus === "repeated" ? index % 24 : index;
  const neutralToken = createHash("sha256").update(`entity-${bucket}`).digest("hex").slice(0, 16);
  return `persona adversarial ${neutralToken}`;
}

interface BenchmarkResult {
  readonly corpus: Corpus;
  readonly entityCount: number;
  readonly directProcessMs: number;
  readonly filteredProcessMs: number;
  readonly directLookupCount: number;
  readonly filteredLookupCount: number;
  readonly filteredPairChecks: number;
  readonly filteredPairSkips: number;
  readonly directFingerprint: string;
  readonly filteredFingerprint: string;
  readonly estimatedCacheBytesLowerBound: number;
}

function runBenchmark(entityCount: number, corpus: Corpus): BenchmarkResult {
  const values = Array.from({ length: entityCount }, (_, index) => syntheticValue(index, corpus));
  const cache = new Map<string, TrigramSignature>();
  const signatureFor = (value: string): TrigramSignature => {
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    const created = makeSignature(value);
    cache.set(value, created);
    return created;
  };
  const directGroups: string[][] = [];
  const filteredGroups: string[][] = [];
  let directLookups = 0;
  let filteredLookups = 0;
  let pairChecks = 0;
  let pairSkips = 0;
  const directStarted = performance.now();
  for (const query of values) {
    const exactIndex = directGroups.findIndex((group) => group.includes(query));
    if (exactIndex >= 0) {
      directGroups[exactIndex]?.push(query);
      continue;
    }
    let match = -1;
    for (let groupIndex = 0; groupIndex < directGroups.length && match < 0; groupIndex += 1) {
      const aliases = directGroups[groupIndex] ?? [];
      for (const alias of aliases) {
        directLookups += 1;
        if (levenshteinNormalizedAtLeast(query, alias, 0.88)) {
          match = groupIndex;
          break;
        }
      }
    }
    if (match >= 0) directGroups[match]?.push(query);
    else directGroups.push([query]);
  }
  const directProcessMs = performance.now() - directStarted;

  const filteredStarted = performance.now();
  for (const query of values) {
    const exactIndex = filteredGroups.findIndex((group) => group.includes(query));
    if (exactIndex >= 0) {
      filteredGroups[exactIndex]?.push(query);
      continue;
    }
    let match = -1;
    const querySignature = signatureFor(query);
    for (let groupIndex = 0; groupIndex < filteredGroups.length && match < 0; groupIndex += 1) {
      const aliases = filteredGroups[groupIndex] ?? [];
      for (const alias of aliases) {
        filteredLookups += 1;
        pairChecks += 1;
        const aliasSignature = signatureFor(alias);
        if (!mayPassTrigramFilter(query, querySignature, alias, aliasSignature, 0.88)) {
          pairSkips += 1;
          continue;
        }
        if (levenshteinNormalizedAtLeast(query, alias, 0.88)) {
          match = groupIndex;
          break;
        }
      }
    }
    if (match >= 0) filteredGroups[match]?.push(query);
    else filteredGroups.push([query]);
  }
  const filteredProcessMs = performance.now() - filteredStarted;
  const summarize = (groups: ReadonlyArray<ReadonlyArray<string>>): string =>
    createHash("sha256")
      .update(groups.map((group, index) => `${index}:${group.length}`).join("\n"))
      .digest("hex");
  const uniqueSignatureCount = cache.size;
  const trigramCount = [...cache.values()].reduce((sum, signature) => sum + signature.length, 0);
  const keyUnits = [...cache.keys()].reduce((sum, value) => sum + value.length, 0);
  const estimatedCacheBytesLowerBound = trigramCount * 14 + keyUnits * 2;
  return {
    corpus,
    entityCount,
    directProcessMs,
    filteredProcessMs,
    directLookupCount: directLookups,
    filteredLookupCount: filteredLookups,
    filteredPairChecks: pairChecks,
    filteredPairSkips: pairSkips,
    directFingerprint: summarize(directGroups),
    filteredFingerprint: summarize(filteredGroups),
    estimatedCacheBytesLowerBound: uniqueSignatureCount === 0 ? 0 : estimatedCacheBytesLowerBound,
  };
}

async function main(): Promise<void> {
  const differential = assertDifferential(0x176);
  const results: BenchmarkResult[] = [];
  for (const entityCount of COUNTS) {
    for (const corpus of ["distinct", "repeated"] as const) {
      results.push(runBenchmark(entityCount, corpus));
    }
  }
  const report = { differential, results };
  const outputDir = resolve(
    process.env.ANONLY_GROUPING_TRIGRAM_OUTPUT_DIR ?? ".measure/grouping-trigram-feasibility",
  );
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "grouping-trigram-feasibility.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main();
