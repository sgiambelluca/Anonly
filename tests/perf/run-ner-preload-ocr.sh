#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
PATCH_PATH="tests/perf/support/ner-preload-ocr.patch"
ORCH_PATH="packages/anonymization-core/src/orchestrator.ts"
NER_PATH="packages/anonymization-core/ner-engine/src/ner.engine.ts"
RUN_DIR="${ANONLY_NER_PRELOAD_OCR_RUN_DIR:-.measure/ner-preload-ocr/$(date -u +%Y%m%dT%H%M%SZ)}"
SMOKE=0
if [[ "${1:-}" == "--smoke" && $# -eq 1 ]]; then SMOKE=1
elif [[ $# -ne 0 ]]; then echo "Uso: $0 [--smoke]" >&2; exit 2; fi
if [[ -e "$RUN_DIR" ]]; then echo "La salida ya existe: $RUN_DIR" >&2; exit 1; fi
git apply --check "$PATCH_PATH"
mkdir -p "$RUN_DIR/snapshot"
cp "$ORCH_PATH" "$RUN_DIR/snapshot/orchestrator.ts"
cp "$NER_PATH" "$RUN_DIR/snapshot/ner.engine.ts"
hash_files() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
hash_files "$ORCH_PATH" "$NER_PATH" > "$RUN_DIR/source-before.sha256"
hash_files "$PATCH_PATH" > "$RUN_DIR/instrument.sha256"
git rev-parse HEAD > "$RUN_DIR/commit.txt"
hash_files pnpm-lock.yaml assets.lock.json > "$RUN_DIR/locks.sha256"

build_app() {
  local log="$1"
  pnpm --filter @anonly/ner-engine build >"$log" 2>&1
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$log" 2>&1
  pnpm --filter @anonly/desktop-shell build >>"$log" 2>&1
}
restore_sources() {
  cp "$RUN_DIR/snapshot/orchestrator.ts" "$ORCH_PATH"
  cp "$RUN_DIR/snapshot/ner.engine.ts" "$NER_PATH"
  cmp -s "$RUN_DIR/snapshot/orchestrator.ts" "$ORCH_PATH"
  cmp -s "$RUN_DIR/snapshot/ner.engine.ts" "$NER_PATH"
  hash_files "$ORCH_PATH" "$NER_PATH" > "$RUN_DIR/source-restored.sha256"
  cmp -s "$RUN_DIR/source-before.sha256" "$RUN_DIR/source-restored.sha256"
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  restore_sources
  if [[ "${PATCH_APPLIED:-0}" == "1" ]]; then build_app "$RUN_DIR/build-restored.log"; fi
  exit "$status"
}
trap cleanup EXIT INT TERM

run_phase() {
  local phase="$1" mode="$2" repeats=1
  local profiles=(p1 p2)
  if [[ "$SMOKE" == "1" ]]; then profiles=("${ANONLY_NER_PRELOAD_OCR_SMOKE_PROFILE:-p2}"); fi
  mkdir "$RUN_DIR/$phase"
  for profile in "${profiles[@]}"; do
    ANONLY_NER_PRELOAD_OCR=1 ANONLY_NER_PRELOAD_PROFILE="$profile" \
      ANONLY_NER_PRELOAD_MODE="$mode" ANONLY_NER_PRELOAD_OUTPUT_DIR="$RUN_DIR/$phase" \
      pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ner-preload-ocr.spec.ts \
      --workers=1 --retries=0 --repeat-each="$repeats" >"$RUN_DIR/$phase/$profile-playwright.log" 2>&1
  done
}

git apply "$PATCH_PATH"
PATCH_APPLIED=1
build_app "$RUN_DIR/instrumented-build.log"
for round in 0 1 2; do
  if [[ "$SMOKE" == "1" && "$round" != "0" ]]; then break; fi
  run_phase "r${round}-a1-baseline" baseline
  run_phase "r${round}-b1-early" b1
  run_phase "r${round}-b2-late" b2
  run_phase "r${round}-a2-baseline" baseline
done

node - "$RUN_DIR" "$SMOKE" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const [root, smoke] = process.argv.slice(2);
const profiles = smoke === "1" ? [process.env.ANONLY_NER_PRELOAD_OCR_SMOKE_PROFILE || "p2"] : ["p1", "p2"];
const phases = [];
for (let round = 0; round < (smoke === "1" ? 1 : 3); round++) {
  phases.push([`r${round}-a1-baseline`, "baseline"], [`r${round}-b1-early`, "b1"], [`r${round}-b2-late`, "b2"], [`r${round}-a2-baseline`, "baseline"]);
}
const repeats = 1;
const summary = {};
for (const profile of profiles) {
  summary[profile] = {};
  for (const [phase, mode] of phases) {
    summary[profile][phase] = [];
    for (let i = 0; i < repeats; i++) {
      const file = path.join(root, phase, `${profile}-${mode}-run${i}.json`);
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      summary[profile][phase].push({
        run: i,
        coldMs: report.cold.totalMs,
        hotMs: report.hot.totalMs,
        coldPeakRssBytes: report.cold.peakSumBytes,
        hotPeakRssBytes: report.hot.peakSumBytes,
        ocrColdMs: report.cold.ocrDurationMs,
        ocrHotMs: report.hot.ocrDurationMs,
        qualityCold: report.cold.qualityFingerprint,
        qualityHot: report.hot.qualityFingerprint,
        workersCold: report.cold.workerPeakByType,
        workersHot: report.hot.workerPeakByType,
        coldProbe: JSON.parse(fs.readFileSync(path.join(root, phase, `${profile}-${mode}-run${i}-cold-preload.json`), "utf8")),
        hotProbe: JSON.parse(fs.readFileSync(path.join(root, phase, `${profile}-${mode}-run${i}-hot-preload.json`), "utf8")),
      });
    }
  }
}
fs.writeFileSync(path.join(root, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
JS
echo "Evidencia: $RUN_DIR"
