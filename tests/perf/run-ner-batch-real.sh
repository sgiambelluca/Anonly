#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
for key in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
  [[ -n "${!key:-}" && "${!key}" = /* && -r "${!key}" ]] || { echo "$key must point to a readable absolute PDF path" >&2; exit 1; }
done
RUN_DIR="${ANONLY_NER_BATCH_REAL_OUTPUT_DIR:-.measure/ner-batch/real-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ ! -e "$RUN_DIR" ]] || { echo "Output exists; refusing overwrite." >&2; exit 1; }
mkdir -p "$RUN_DIR"
export ANONLY_NER_BATCH_REAL_RUN=1
if [[ "${ANONLY_NER_BATCH_NO_BUILD:-0}" != 1 ]]; then
  echo "Build is disabled for real-data run; use the already validated packaged build or build separately with dist restoration."
  exit 1
fi
if ! node tests/perf/ner-batch-real.mjs >"$RUN_DIR/real.tmp.json" 2>"$RUN_DIR/stderr.private"; then
  node - "$RUN_DIR/stderr.private" <<'NODE'
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/u).filter(Boolean);
const stages = new Set(['import', 'capture', 'idle', 'load', 'batch']);
const substages = new Set(['none', 'init', 'tokenCount', 'eligibility', 'internalSplit', 'select', 'similar2', 'similar4', 'disparate2', 'disparate4', 'dispose']);
const names = new Set(['Error', 'TimeoutError', 'TypeError', 'RangeError', 'Unknown', 'SelectionInsufficient']);
for (const line of lines) {
  try {
    const d = JSON.parse(line);
    if ((d.profile === 'R1' || d.profile === 'R2') && stages.has(d.stage) && substages.has(d.substage) && names.has(d.errorName)) {
      process.stdout.write(`Sanitized failure: ${d.profile}, stage=${d.stage}, substage=${d.substage}, error=${d.errorName}\n`);
      break;
    }
  } catch { /* ignore non-diagnostic runtime output */ }
}
NODE
  rm -f "$RUN_DIR/real.tmp.json" "$RUN_DIR/stderr.private"
  echo "Integrated R1/R2 probe failed; no report retained." >&2
  exit 1
fi
if ! node - "$RUN_DIR/real.tmp.json" "$RUN_DIR/real.json" <<'NODE'
const fs = require('node:fs');
const [input, output] = process.argv.slice(2);
const parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
const permitted = new Set(['R1', 'R2', 'individual', 'batch']);
function check(value) {
  if (typeof value === 'string') return permitted.has(value);
  if (Array.isArray(value)) return value.every(check);
  if (value && typeof value === 'object') return Object.values(value).every(check);
  return value === null || typeof value === 'number' || typeof value === 'boolean';
}
if (!Array.isArray(parsed) || parsed.length !== 2 || !check(parsed)) process.exit(1);
fs.writeFileSync(output, `${JSON.stringify(parsed, null, 2)}\n`);
NODE
then
  rm -f "$RUN_DIR/real.tmp.json" "$RUN_DIR/real.json" "$RUN_DIR/stderr.private"
  echo "Report contained a disallowed string; all report artifacts removed." >&2
  exit 1
fi
rm -f "$RUN_DIR/real.tmp.json" "$RUN_DIR/stderr.private"
echo "Sanitized numeric report: $RUN_DIR/real.json"
