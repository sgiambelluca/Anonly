#!/usr/bin/env bash
set -euo pipefail

# Instrumento experimental de I-2. El patch vive en tests/perf/support y sus
# snapshots se conservan en .measure; el trap restituye los archivos exactos.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
PROBE_ROOT="$ROOT_DIR/.measure/margenes-i2/20260917-probe"
SNAPSHOT_DIR="$PROBE_ROOT/snapshot"
INSTRUMENT_PATCH="$ROOT_DIR/tests/perf/support/margin-i2-instrument.patch"
RUN_DIR="${ANONLY_MARGIN_I2_RUN_DIR:-$PROBE_ROOT/$(date -u +%Y%m%dT%H%M%SZ)}"
CASE_NAME="${ANONLY_MARGIN_I2_CASE:-qastamp}"
CONDITION="${ANONLY_MARGIN_I2_CONDITION:-control}"
KERNEL_PATH="packages/anonymization-core/ocr-engine/src/worker/kernel.ts"
ENGINE_PATH="packages/anonymization-core/ocr-engine/src/ocr.engine.ts"

case "$CONDITION" in
  control) PADDING=-1 ;;
  pad0) PADDING=0 ;;
  pad32) PADDING=32 ;;
  pad64) PADDING=64 ;;
  pad128) PADDING=128 ;;
  pad256) PADDING=256 ;;
  *) echo "Condición I-2 inválida: $CONDITION" >&2; exit 1 ;;
esac
case "$CASE_NAME" in
  p2|qastamp|t5rotated|whitemargins) ;;
  *) echo "Fixture I-2 inválido: $CASE_NAME" >&2; exit 1 ;;
esac
if [[ -e "$RUN_DIR" ]]; then
  echo "Salida I-2 ya existe: $RUN_DIR" >&2
  exit 1
fi
if [[ ! -e "$SNAPSHOT_DIR/kernel.ts" && ! -e "$SNAPSHOT_DIR/ocr.engine.ts" ]]; then
  mkdir -p "$SNAPSHOT_DIR"
  cp "$KERNEL_PATH" "$SNAPSHOT_DIR/kernel.ts"
  cp "$ENGINE_PATH" "$SNAPSHOT_DIR/ocr.engine.ts"
fi
if ! cmp -s "$SNAPSHOT_DIR/kernel.ts" "$KERNEL_PATH" ||
   ! cmp -s "$SNAPSHOT_DIR/ocr.engine.ts" "$ENGINE_PATH"; then
  echo "Producto no coincide con snapshot I-2; no se aplica patch" >&2
  exit 1
fi
if pgrep -f '[p]laywright test --config' >/dev/null; then
  echo "Playwright activo: medición I-2 cancelada" >&2
  exit 1
fi
mkdir -p "$RUN_DIR"
restore_product() {
  cp "$SNAPSHOT_DIR/kernel.ts" "$KERNEL_PATH"
  cp "$SNAPSHOT_DIR/ocr.engine.ts" "$ENGINE_PATH"
  if ! cmp -s "$SNAPSHOT_DIR/kernel.ts" "$KERNEL_PATH" ||
     ! cmp -s "$SNAPSHOT_DIR/ocr.engine.ts" "$ENGINE_PATH"; then
    echo "ERROR: la restauración exacta del producto falló" >&2
    exit 1
  fi
}
trap restore_product EXIT INT TERM

git apply "$INSTRUMENT_PATCH"
python3 - "$KERNEL_PATH" "$PADDING" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
padding = int(sys.argv[2])
source = path.read_text()
old = 'const MARGIN_I2_PADDING_PX = -1;'
assert source.count(old) == 1
path.write_text(source.replace(old, f'const MARGIN_I2_PADDING_PX = {padding};'))
PY

VITE_E2E=1 pnpm --filter @anonly/react-client build >"$RUN_DIR/build.log" 2>&1
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1
node - "$CASE_NAME" "$CONDITION" "$PADDING" "$RUN_DIR" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [caseName, condition, padding, runDir] = process.argv.slice(2);
const hash = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const fixture = {
  p2: ".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf",
  qastamp: ".measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf",
  t5rotated: ".measure/fixtures/t5-rotated-0-90-180-270-1df5651d37c2b15d.pdf",
  whitemargins: ".measure/fixtures/white-margins-848789ae0cc9e3d9.pdf",
}[caseName];
const assetsDir = "apps/react-client/dist/assets";
const assets = Object.fromEntries(fs.readdirSync(assetsDir).sort().map(file =>
  [file, hash(path.join(assetsDir, file))]));
const sourceFiles = [
  "packages/anonymization-core/ocr-engine/src/worker/kernel.ts",
  "packages/anonymization-core/ocr-engine/src/ocr.engine.ts",
  "apps/react-client/src/core-adapter/index.ts",
];
const manifest = {
  campaign: "20260917-i2-probe", baseCommit: require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim(),
  case: caseName, condition, padding: Number(padding),
  fixture: {path:fixture, sha256:hash(fixture)},
  sourceSha256: Object.fromEntries(sourceFiles.map(file => [file, hash(file)])),
  instrumentSha256: hash("tests/perf/support/margin-i2-instrument.patch"),
  lockSha256: hash("pnpm-lock.yaml"), assetsLockSha256: hash("assets.lock.json"),
  distAssetsSha256: assets,
  distAssetsDigest: crypto.createHash("sha256").update(JSON.stringify(assets)).digest("hex"),
  capturedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));
JS

ANONLY_MARGIN_I2_ENABLED=1 ANONLY_MARGIN_I2_CASE="$CASE_NAME" \
  ANONLY_MARGIN_I2_CONDITION="$CONDITION" ANONLY_MARGIN_I2_OUTPUT_DIR="$RUN_DIR" \
  pnpm exec playwright test --config=playwright.perf.config.ts \
  tests/perf/margin-i2-probe.spec.ts --workers=1 --retries=0 \
  >"$RUN_DIR/playwright.log" 2>&1

echo "I-2 $CASE_NAME $CONDITION: $RUN_DIR"
