#!/usr/bin/env bash
set -euo pipefail

# Campaña A/B/A de diagnóstico. El patch modifica solo dos archivos de NER y
# el trap repone sus bytes exactos aun si build o Playwright fallan.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
PATCH_PATH="tests/perf/support/ner-internal-instrumentation.patch"
HOST_PATH="packages/anonymization-core/ner-engine/src/ner.engine.ts"
KERNEL_PATH="packages/anonymization-core/ner-engine/src/worker/kernel.ts"
RUN_DIR="${ANONLY_NER_RUN_DIR:-.measure/ner-internal/$(date -u +%Y%m%dT%H%M%SZ)}"
SMOKE=0
SMOKE_PROFILE="${ANONLY_NER_SMOKE_PROFILE:-p1}"
if [[ "${1:-}" == "--smoke" && $# -eq 1 ]]; then
  SMOKE=1
elif [[ $# -ne 0 ]]; then
  echo "Uso: $0 [--smoke]" >&2
  exit 2
fi
if [[ "$SMOKE_PROFILE" != "p1" && "$SMOKE_PROFILE" != "p2" ]]; then
  echo "ANONLY_NER_SMOKE_PROFILE debe ser p1 o p2" >&2
  exit 2
fi
if [[ -e "$RUN_DIR" ]]; then
  echo "La salida ya existe: $RUN_DIR" >&2
  exit 1
fi
if [[ ! -f "$HOST_PATH" || ! -f "$KERNEL_PATH" || ! -f "$PATCH_PATH" ]]; then
  echo "Falta un archivo de fuente o el patch NER" >&2
  exit 1
fi
if pgrep -f '[p]laywright test --config' >/dev/null; then
  echo "Hay otra medición Playwright activa" >&2
  exit 1
fi
git apply --check "$PATCH_PATH"
hash_files() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    LC_ALL=C LANG=C shasum -a 256 "$@"
  fi
}
mkdir -p "$RUN_DIR/snapshot"
cp "$HOST_PATH" "$RUN_DIR/snapshot/ner.engine.ts"
cp "$KERNEL_PATH" "$RUN_DIR/snapshot/kernel.ts"
hash_files "$HOST_PATH" "$KERNEL_PATH" >"$RUN_DIR/source-before.sha256"
hash_files "$PATCH_PATH" >"$RUN_DIR/instrument.sha256"
git rev-parse HEAD >"$RUN_DIR/commit.txt"
hash_files pnpm-lock.yaml assets.lock.json >"$RUN_DIR/locks.sha256"

PATCH_APPLIED=0
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  cp "$RUN_DIR/snapshot/ner.engine.ts" "$HOST_PATH"
  cp "$RUN_DIR/snapshot/kernel.ts" "$KERNEL_PATH"
  if ! cmp -s "$RUN_DIR/snapshot/ner.engine.ts" "$HOST_PATH" ||
     ! cmp -s "$RUN_DIR/snapshot/kernel.ts" "$KERNEL_PATH"; then
    echo "ERROR: no se pudo restaurar el código NER" >&2
    exit 1
  fi
  hash_files "$HOST_PATH" "$KERNEL_PATH" >"$RUN_DIR/source-restored.sha256"
  if ! cmp -s "$RUN_DIR/source-before.sha256" "$RUN_DIR/source-restored.sha256"; then
    echo "ERROR: los hashes restaurados difieren" >&2
    exit 1
  fi
  if [[ "$PATCH_APPLIED" -eq 1 ]]; then
    if ! build_app "$RUN_DIR/build-restored.log"; then
      echo "ERROR: se restauró el fuente, pero falló el build normal; ver build-restored.log" >&2
      exit 1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

build_app() {
  local log_path="$1"
  pnpm --filter @anonly/ner-engine build >"$log_path" 2>&1
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$log_path" 2>&1
  pnpm --filter @anonly/desktop-shell build >>"$log_path" 2>&1
}

write_manifest() {
  local phase="$1"
  local dir="$RUN_DIR/$phase"
  node - "$phase" "$dir" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [phase, dir] = process.argv.slice(2);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const assetsDir = "apps/react-client/dist/assets";
const assets = Object.fromEntries(
  fs.readdirSync(assetsDir).sort().map(name => [name, hash(path.join(assetsDir, name))])
);
const manifest = {
  phase,
  capturedAt: new Date().toISOString(),
  commit: fs.readFileSync(path.join(dir, "../commit.txt"), "utf8").trim(),
  instrumentSha256: hash("tests/perf/support/ner-internal-instrumentation.patch"),
  hostSha256: hash("packages/anonymization-core/ner-engine/src/ner.engine.ts"),
  kernelSha256: hash("packages/anonymization-core/ner-engine/src/worker/kernel.ts"),
  fixtureSha256: Object.fromEntries([
    ["p1", ".measure/fixtures/text-10p-frozen.pdf"],
    ["p2", ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf"],
  ].map(([name, file]) => [name, hash(file)])),
  distAssetsSha256: assets,
  distAssetsDigest: crypto.createHash("sha256").update(JSON.stringify(assets)).digest("hex"),
};
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
JS
}

run_phase() {
  local phase="$1"
  local mode="$2"
  local repeats=3
  local profiles=(p1 p2)
  if [[ "$SMOKE" -eq 1 ]]; then
    repeats=1
    profiles=("$SMOKE_PROFILE")
  fi
  mkdir "$RUN_DIR/$phase"
  build_app "$RUN_DIR/$phase/build.log"
  write_manifest "$phase"
  for profile in "${profiles[@]}"; do
    ANONLY_NER_PROFILE=1 ANONLY_NER_FIXTURE="$profile" ANONLY_NER_MODE="$mode" \
      ANONLY_NER_OUTPUT_DIR="$RUN_DIR/$phase" \
      pnpm exec playwright test --config=playwright.perf.config.ts \
      tests/perf/ner-internal-profile.spec.ts --workers=1 --retries=0 \
      --repeat-each="$repeats" >"$RUN_DIR/$phase/$profile-playwright.log" 2>&1
  done
}

run_phase "a1-baseline" "baseline"
git apply "$PATCH_PATH"
PATCH_APPLIED=1
run_phase "b-probe" "probe"
cp "$RUN_DIR/snapshot/ner.engine.ts" "$HOST_PATH"
cp "$RUN_DIR/snapshot/kernel.ts" "$KERNEL_PATH"
run_phase "a2-baseline" "baseline"
node - "$RUN_DIR" "$SMOKE" "$SMOKE_PROFILE" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const [root, smokeFlag, smokeProfile] = process.argv.slice(2);
const profiles = smokeFlag === "1" ? [smokeProfile] : ["p1", "p2"];
const repeats = smokeFlag === "1" ? 1 : 3;
const phases = [
  ["a1-baseline", "baseline"],
  ["b-probe", "probe"],
  ["a2-baseline", "baseline"],
];
const fields = [
  "qualityFingerprint", "ocrFingerprint", "detectionFingerprint", "entityCount", "groupCount"
];
const summary = {};
for (const profile of profiles) {
  const reference = {};
  summary[profile] = {};
  for (const [phase, mode] of phases) {
    summary[profile][phase] = {};
    for (let index = 0; index < repeats; index++) {
      const file = path.join(root, phase, `${profile}-${mode}-run${index}.json`);
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const temperature of ["cold", "hot"]) {
        const run = report[temperature];
        const signature = Object.fromEntries(fields.map(field => [field, run[field] ?? null]));
        reference[temperature] ??= signature;
        if (JSON.stringify(signature) !== JSON.stringify(reference[temperature])) {
          throw new Error(`Calidad cambió en ${profile} ${phase} run${index} ${temperature}`);
        }
        summary[profile][phase][`run${index}-${temperature}`] = {
          nerMs: run.intervalsMs.nerMs,
          importedToReadyMs: run.intervalsMs.importedToReadyMs,
          batchCount: run.nerProbe?.batches?.length ?? null,
        };
      }
    }
  }
  summary[profile].qualityReference = reference;
}
fs.writeFileSync(path.join(root, "quality-and-timing-summary.json"), JSON.stringify(summary, null, 2) + "\n");
JS
PATCH_APPLIED=0
echo "Campaña NER terminada: $RUN_DIR"
