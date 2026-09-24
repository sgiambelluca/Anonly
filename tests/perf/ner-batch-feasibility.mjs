// Test-only Transformers.js batch probe. Synthetic inputs only; no product code.
// Run with ANONLY_NER_BATCH_RUN=1 after a fresh packaged Electron build.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

if (process.env.ANONLY_NER_BATCH_RUN !== "1") throw new Error("Set ANONLY_NER_BATCH_RUN=1");
const root = process.cwd();
const clientRequire = createRequire(resolve(root, "apps/react-client/package.json"));
const shellRequire = createRequire(resolve(root, "apps/desktop-shell/package.json"));
const esbuild = createRequire(clientRequire.resolve("vite"))("esbuild");
const { _electron: electron } = shellRequire("@playwright/test");
const kernelPath = resolve(root, "packages/anonymization-core/ner-engine/src/worker/kernel.ts");
const kernel = readFileSync(kernelPath, "utf8");
const probe = `
export async function runBatchProbe(texts, modelId, wasmPaths, rounds) {
  await ensureClassifierLoaded(modelId, 'q8', wasmPaths, () => {});
  const prepared = texts.map(titleCaseUppercaseRuns);
  const measurements = [];
  const heapBefore = typeof performance.memory?.usedJSHeapSize === 'number' ? performance.memory.usedJSHeapSize : null;
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? ['individual', 'batch'] : ['batch', 'individual'];
    for (const arm of order) {
      const start = performance.now();
      if (arm === 'individual') {
        for (const text of prepared) await classifier(text, { ignore_labels: [] });
      } else await classifier(prepared, { ignore_labels: [] });
      measurements.push({ round, arm, elapsedMs: performance.now() - start });
    }
  }
  const individual = [];
  for (const text of prepared) individual.push(await classifier(text, { ignore_labels: [] }));
  const batch = await classifier(prepared, { ignore_labels: [] });
  const tokenizer = tokenizerOf(classifier);
  const padded = classifier.tokenizer(prepared, { padding: true, truncation: false });
  const lengths = padded.attention_mask.tolist().map(mask => mask.reduce((n, x) => n + Number(x), 0));
  const tokenMetrics = batch.map((tokens, i) => {
    const single = individual[i];
    let structuralMismatches = 0, maxScoreDelta = 0, scoreChanged = 0;
    for (let j = 0; j < Math.max(tokens.length, single.length); j++) {
      const a = tokens[j], b = single[j];
      if (!a || !b || a.entity !== b.entity || a.word !== b.word || a.index !== b.index) structuralMismatches++;
      if (a && b) { const d = Math.abs(a.score - b.score); maxScoreDelta = Math.max(maxScoreDelta, d); if (d > 1e-6) scoreChanged++; }
    }
    return { batchTokens: tokens.length, individualTokens: single.length, structuralMismatches, scoreChanged, maxScoreDelta };
  });
  const spanMetrics = batch.map((tokens, i) => {
    const batchedSpans = aggregateTokensToSpans(tokens, prepared[i], texts[i]);
    const individualSpans = aggregateTokensToSpans(individual[i], prepared[i], texts[i]);
    let geometryMismatches = 0, confidenceFlipsAt07 = 0, maxConfidenceDelta = 0;
    for (let j = 0; j < Math.max(batchedSpans.length, individualSpans.length); j++) {
      const a = batchedSpans[j], b = individualSpans[j];
      if (!a || !b || a.entityType !== b.entityType || a.value !== b.value || a.normalizedValue !== b.normalizedValue || a.startIndex !== b.startIndex || a.endIndexExclusive !== b.endIndexExclusive) geometryMismatches++;
      if (a && b) { maxConfidenceDelta = Math.max(maxConfidenceDelta, Math.abs(a.confidence - b.confidence)); if ((a.confidence < 0.7) !== (b.confidence < 0.7)) confidenceFlipsAt07++; }
    }
    return { batchSpanCount: batchedSpans.length, individualSpanCount: individualSpans.length, geometryMismatches, confidenceFlipsAt07, maxConfidenceDelta };
  });
  const tokenCounts = texts.map(text => tokenLengthOf(tokenizer, titleCaseUppercaseRuns(text)));
  const heapAfter = typeof performance.memory?.usedJSHeapSize === 'number' ? performance.memory.usedJSHeapSize : null;
  return { measurements, tokenCounts, paddedWidth: padded.input_ids.dims[1], paddingTokens: lengths.reduce((n, x) => n + padded.input_ids.dims[1] - x, 0), tokenMetrics, spanMetrics, memory: { jsHeapBeforeBytes: heapBefore, jsHeapAfterBytes: heapAfter, wasmTemporaryBytes: null } };
}
export async function tokenCount(text, modelId, wasmPaths) {
  await ensureClassifierLoaded(modelId, 'q8', wasmPaths, () => {});
  return tokenLengthOf(tokenizerOf(classifier), titleCaseUppercaseRuns(text));
}
export async function tokenCounts(texts, modelId, wasmPaths) {
  await ensureClassifierLoaded(modelId, 'q8', wasmPaths, () => {});
  const tokenizer = tokenizerOf(classifier);
  return texts.map(text => tokenLengthOf(tokenizer, titleCaseUppercaseRuns(text)));
}
export async function runAdversarial(text, modelId, wasmPaths, expectedTail = 'Carlos López compareció al final.') {
  await ensureClassifierLoaded(modelId, 'q8', wasmPaths, () => {});
  const inference = titleCaseUppercaseRuns(text), tokenizer = tokenizerOf(classifier);
  const budget = tokenBudgetOf(tokenizer), starts = wordStartOffsets(inference), parts = [];
  let from = 0;
  while (from < inference.length) {
    const remaining = tokenLengthOf(tokenizer, inference.slice(from));
    const to = remaining <= budget ? inference.length : findSplitOffset(tokenizer, inference, from, starts, budget);
    parts.push({ from, to, text: text.slice(from, to), inference: inference.slice(from, to) }); from = to;
  }
  const singles = [];
  for (const part of parts) singles.push(await classifier(part.inference, { ignore_labels: [] }));
  const batched = await classifier(parts.map(part => part.inference), { ignore_labels: [] });
  const measurements = [];
  for (let round = 0; round < 3; round++) {
    for (const arm of round % 2 === 0 ? ['individual', 'batch'] : ['batch', 'individual']) {
      const start = performance.now();
      if (arm === 'individual') for (const part of parts) await classifier(part.inference, { ignore_labels: [] });
      else await classifier(parts.map(part => part.inference), { ignore_labels: [] });
      measurements.push({ round, arm, elapsedMs: performance.now() - start });
    }
  }
  const uncut = await classifier(inference, { ignore_labels: [] });
  const batchedSpans = batched.flatMap((tokens, i) => aggregateTokensToSpans(tokens, parts[i].inference, parts[i].text).map(span => ({ ...span, startIndex: span.startIndex + parts[i].from, endIndexExclusive: span.endIndexExclusive + parts[i].from })));
  const individualSpans = singles.flatMap((tokens, i) => aggregateTokensToSpans(tokens, parts[i].inference, parts[i].text).map(span => ({ ...span, startIndex: span.startIndex + parts[i].from, endIndexExclusive: span.endIndexExclusive + parts[i].from })));
  const kernelSpans = await kernelClassify({ documentId: 'ner-batch-probe', pageIndex: 0, text, modelId, quantization: 'q8', wasmPaths }, { timeoutMs: 120_000, abortSignal: new AbortController().signal });
  let geometryMismatches = 0, confidenceFlipsAt07 = 0, maxConfidenceDelta = 0;
  for (let i = 0; i < Math.max(batchedSpans.length, individualSpans.length, kernelSpans.length); i++) {
    const batchSpan = batchedSpans[i], singleSpan = individualSpans[i], reference = kernelSpans[i];
    if (!batchSpan || !singleSpan || !reference || batchSpan.entityType !== reference.entityType || batchSpan.value !== reference.value || batchSpan.normalizedValue !== reference.normalizedValue || batchSpan.startIndex !== reference.startIndex || batchSpan.endIndexExclusive !== reference.endIndexExclusive || singleSpan.entityType !== reference.entityType || singleSpan.value !== reference.value || singleSpan.startIndex !== reference.startIndex || singleSpan.endIndexExclusive !== reference.endIndexExclusive) geometryMismatches++;
    if (batchSpan && singleSpan) { maxConfidenceDelta = Math.max(maxConfidenceDelta, Math.abs(batchSpan.confidence - singleSpan.confidence)); if ((batchSpan.confidence < 0.7) !== (singleSpan.confidence < 0.7)) confidenceFlipsAt07++; }
  }
  const containsTail = expectedTail === null ? null : (parts.at(-1)?.text.endsWith(expectedTail) ?? false);
  const structuralMismatches = batched.reduce((n, tokens, i) => n + tokens.reduce((m, a, j) => {
    const b = singles[i][j]; return m + Number(!b || a.entity !== b.entity || a.word !== b.word || a.index !== b.index);
  }, 0), 0);
  return { measurements, fullTokens: tokenLengthOf(tokenizer, inference), budget, parts: parts.map(p => ({ chars: p.text.length, tokens: tokenLengthOf(tokenizer, p.inference) })), uncutTokensReturned: uncut.length, batchedItemCount: batched.length, expectedItemCount: parts.length, structuralMismatches, spanGeometryMismatches: geometryMismatches, confidenceFlipsAt07, maxConfidenceDelta, tailIncluded: containsTail };
}
`;
const build = await esbuild.build({
  stdin: {
    contents: kernel + probe,
    resolveDir: resolve(root, "packages/anonymization-core/ner-engine/src/worker"),
    sourcefile: kernelPath,
    loader: "ts",
  },
  bundle: true,
  alias: { "@anonly/shared": resolve(root, "packages/anonymization-core/shared/src/index.ts") },
  platform: "browser",
  format: "iife",
  globalName: "NerBatchProbe",
  target: "es2022",
  write: false,
  logLevel: "warning",
});
const appDir = resolve(root, "apps/desktop-shell");
const app = await electron.launch({
  args: [appDir, `--user-data-dir=/tmp/anonly-ner-batch-${process.pid}`],
  executablePath: resolve(appDir, "node_modules/.bin/electron"),
});
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("load");
  await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    await new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = ok;
      s.onerror = fail;
      document.head.append(s);
    });
  }, build.outputFiles[0].text);
  const files = readdirSync(resolve(root, "apps/react-client/dist/assets"));
  const wasm = files.find((name) => /^ort-wasm.*\.wasm$/.test(name));
  const mjs = files.find((name) => /^ort-wasm.*\.mjs$/.test(name));
  if (!wasm || !mjs) throw new Error("ONNX WASM assets absent from packaged build");
  const report = await page.evaluate(
    async ({ wasmPaths }) => {
      const modelId = "Xenova/bert-base-multilingual-cased-ner-hrl";
      const similar = [
        "El señor Juan Pérez declaró ante el tribunal y Juan Pérez ratificó su domicilio en Buenos Aires.",
        "La doctora María López recibió a Carlos Gómez y luego María López firmó el acta correspondiente.",
        "La jueza Ana Torres tomó declaración a Pedro Díaz en la ciudad de Córdoba.",
        "El abogado Luis Fernández presentó el escrito ante el juzgado de Santa Fe.",
      ];
      const disparate = [
        similar[0],
        `La organización ${"administración ".repeat(72)}de asuntos judiciales compareció ante el tribunal y Carlos López compareció al final.`,
        similar[2],
        `Durante el procedimiento ${"reglamentación ".repeat(40)}la doctora María López constató los antecedentes.`,
      ];
      const adversarial = `${"En el expediente se verificó el trámite ordinario de acuerdo con las reglas aplicables. ".repeat(78)}Carlos López compareció al final.`;
      const out = {
        isolated: crossOriginIsolated,
        sab: typeof SharedArrayBuffer === "function",
        similar2: await NerBatchProbe.runBatchProbe(similar.slice(0, 2), modelId, wasmPaths, 3),
        disparate2: await NerBatchProbe.runBatchProbe(disparate.slice(0, 2), modelId, wasmPaths, 3),
        similar4: await NerBatchProbe.runBatchProbe(similar, modelId, wasmPaths, 3),
        disparate4: await NerBatchProbe.runBatchProbe(disparate, modelId, wasmPaths, 3),
        adversarial: await NerBatchProbe.runAdversarial(adversarial, modelId, wasmPaths),
      };
      await NerBatchProbe.kernelDispose();
      return out;
    },
    { wasmPaths: { wasm: `/assets/${wasm}`, mjs: `/assets/${mjs}` } },
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await app.close();
}
