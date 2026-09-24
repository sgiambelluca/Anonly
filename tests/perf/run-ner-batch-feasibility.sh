#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
RUN_DIR="${ANONLY_NER_BATCH_OUTPUT_DIR:-.measure/ner-batch/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then echo "Salida existente: $RUN_DIR" >&2; exit 1; fi
mkdir -p "$RUN_DIR"
BACKUP_DIR="$(mktemp -d)"
CLIENT_DIST="apps/react-client/dist"
SHELL_DIST="apps/desktop-shell/dist"
CLIENT_HAD_DIST=0
SHELL_HAD_DIST=0
BUILT=0
[[ ! -d "$CLIENT_DIST" ]] || { cp -a "$CLIENT_DIST" "$BACKUP_DIR/client-dist"; CLIENT_HAD_DIST=1; }
[[ ! -d "$SHELL_DIST" ]] || { cp -a "$SHELL_DIST" "$BACKUP_DIR/shell-dist"; SHELL_HAD_DIST=1; }
restore_dist() {
  local status=$?
  if [[ "$BUILT" == 1 ]]; then
    python3 - "$CLIENT_DIST" "$SHELL_DIST" "$BACKUP_DIR" "$CLIENT_HAD_DIST" "$SHELL_HAD_DIST" <<'PY'
import os, shutil, sys
client, shell, backup, had_client, had_shell = sys.argv[1:]
for target, saved, existed in ((client, 'client-dist', had_client == '1'), (shell, 'shell-dist', had_shell == '1')):
    if os.path.exists(target): shutil.rmtree(target)
    if existed: shutil.copytree(os.path.join(backup, saved), target, symlinks=True)
PY
  fi
  rm -rf "$BACKUP_DIR"
  exit "$status"
}
trap restore_dist EXIT INT TERM
export ANONLY_NER_BATCH_RUN=1
if [[ "${ANONLY_NER_BATCH_NO_BUILD:-0}" != 1 ]]; then
  BUILT=1
  VITE_E2E=1 pnpm --filter @anonly/react-client build >"$RUN_DIR/build-client.log" 2>&1
  pnpm --filter @anonly/desktop-shell build >"$RUN_DIR/build-shell.log" 2>&1
fi
node tests/perf/ner-batch-feasibility.mjs >"$RUN_DIR/synthetic.json"
node -e 'const fs=require("node:fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!r.isolated||!r.sab) throw Error("Chromium must be cross-origin isolated with SharedArrayBuffer"); for(const c of [r.similar2,r.disparate2,r.similar4,r.disparate4]) { if(c.measurements.length!==6) throw Error("missing interleaved timing pairs"); } if(r.adversarial.measurements.length!==6||r.adversarial.batchedItemCount!==r.adversarial.expectedItemCount||!r.adversarial.tailIncluded||r.adversarial.spanGeometryMismatches!==0) throw Error("ADR-098 split/batch correspondence failed");' "$RUN_DIR/synthetic.json"
echo "Synthetic feasibility report: $RUN_DIR/synthetic.json"
