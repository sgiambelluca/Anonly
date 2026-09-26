#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C
export PLAYWRIGHT_NO_COPY_PROMPT=1
if [[ "${ANONLY_OCR_MEMORY_AWAKE:-0}" != "1" ]]; then
  exec caffeinate -dimsu env ANONLY_OCR_MEMORY_AWAKE=1 bash "$0"
fi

# Serial macOS RSS and quiescent end-stage attribution; same unchanged product build.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

RUN_DIR="${ANONLY_OCR_POOL_OUTPUT_DIR:-.measure/ocr-memory/$(date -u +%Y%m%dT%H%M%SZ)}"
PHASE="profiles-gap"
APPEND="${ANONLY_OCR_POOL_APPEND:-0}"
DIST_DIR="apps/react-client/dist"
SHELL_DIST_DIR="apps/desktop-shell/dist"
FAILED=0
declare -a INVALID_RUN_IDS=()
if [[ "$APPEND" == "1" ]]; then
  [[ -d "$RUN_DIR" ]] || { echo "No existe la carpeta de continuación: $RUN_DIR" >&2; exit 1; }
else
  if [[ -e "$RUN_DIR" ]]; then
    echo "La salida ya existe: $RUN_DIR — no se pisa una tanda previa." >&2
    exit 1
  fi
  mkdir -p "$RUN_DIR"
fi
[[ "$APPEND" == "0" ]] || { echo "Esta campaña no permite append." >&2; exit 1; }

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }
fail() { log "ABORTA: $*"; exit 1; }
sha() { LC_ALL=C shasum -a 256 "$@" 2>/dev/null | awk '{print $1}'; }
digest_dir() {
  (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do printf '%s\n' "$file"; sha "$file"; done) | sha
}
capture_pressure() {
  local label="$1"
  { echo "=== $label $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="; pmset -g batt; pmset -g assertions | rg 'PreventSystemSleep|PreventUserIdleSystemSleep' || true; vm_stat; sysctl vm.swapusage; } >>"$RUN_DIR/system-pressure.txt" 2>&1
}
sleep_wake_digest() {
  pmset -g log 2>/dev/null | rg 'Entering Sleep state|Wake from' | tail -n 10 | shasum -a 256 | awk '{print $1}'
}
record_invalid_run() {
  local run_id="$1" reason="$2"
  INVALID_RUN_IDS+=("$run_id")
  node - "$RUN_DIR/validity.json" "$run_id" "$reason" <<'NODE' || fail "no se pudo persistir validity.json para $run_id"
const fs = require("node:fs");
const file = process.argv[2];
const runId = process.argv[3];
const reason = process.argv[4];
let value = { affectedRunIds: [], reasonsByRunId: {} };
if (fs.existsSync(file)) value = JSON.parse(fs.readFileSync(file, "utf8"));
value.affectedRunIds = [...new Set([...(value.affectedRunIds ?? []), runId])].sort();
value.reasonsByRunId = { ...(value.reasonsByRunId ?? {}), [runId]: [...new Set([...(value.reasonsByRunId?.[runId] ?? []), reason])] };
const temp = `${file}.tmp`;
fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
fs.renameSync(temp, file);
NODE
  log "Run inválido marcado: $run_id ($reason)."
}

RESTORE_CLIENT_DIST=0
RESTORE_SHELL_DIST=0
REMOVE_CLIENT_DIST=0
REMOVE_SHELL_DIST=0
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$RESTORE_CLIENT_DIST" -eq 1 && -d "$RUN_DIR/dist-original" ]]; then
    rm -rf "$DIST_DIR"
    cp -R "$RUN_DIR/dist-original" "$DIST_DIR" || { log "FATAL: no se pudo restaurar el dist del cliente."; status=1; }
    if [[ -f "$RUN_DIR/dist-original.digest" && "$(digest_dir "$DIST_DIR")" != "$(cat "$RUN_DIR/dist-original.digest")" ]]; then
      log "FATAL: el dist del cliente restaurado no coincide."; status=1
    fi
  fi
  if [[ "$RESTORE_SHELL_DIST" -eq 1 && -d "$RUN_DIR/shell-dist-original" ]]; then
    rm -rf "$SHELL_DIST_DIR"
    cp -R "$RUN_DIR/shell-dist-original" "$SHELL_DIST_DIR" || { log "FATAL: no se pudo restaurar el dist del shell."; status=1; }
    [[ "$(digest_dir "$SHELL_DIST_DIR")" == "$(cat "$RUN_DIR/shell-dist-original.digest")" ]] || { log "FATAL: digest shell incorrecto."; status=1; }
  fi
  if [[ "$REMOVE_CLIENT_DIST" -eq 1 ]]; then rm -rf "$DIST_DIR"; fi
  if [[ "$REMOVE_SHELL_DIST" -eq 1 ]]; then rm -rf "$SHELL_DIST_DIR"; fi
  [[ ! -f "$RUN_DIR/product-tree.diff.sha256" || "$(git diff HEAD --binary -- packages/ apps/ | sha)" == "$(cat "$RUN_DIR/product-tree.diff.sha256")" ]] || { log "FATAL: fuentes cambiadas."; status=1; }
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$(uname -s)" != "Darwin" ]]; then fail "esta campaña está habilitada solo para macOS."; fi
if pgrep -f '[p]laywright test --config' >/dev/null; then fail "hay otro Playwright activo."; fi
if pgrep -f '[v]itest (run|watch)|[v]itest.mjs' >/dev/null; then fail "hay otro Vitest activo."; fi
if ! git diff HEAD --quiet -- packages/ apps/; then
  fail "hay cambios sin commitear en packages/ o apps/; la campaña histórica exige producto limpio."
fi
VALIDATION_PROFILES=(P1 P2 R1 R2)
if [[ "$PHASE" == "profiles-gap" ]]; then VALIDATION_PROFILES=(P2 R2); fi
for profile in "${VALIDATION_PROFILES[@]}"; do
  case "$profile" in
    P1|P2) ;;
    R1) [[ "${ANONLY_REAL_DOC_R1:-}" = /* && -r "$ANONLY_REAL_DOC_R1" ]] || fail "R1 requiere ANONLY_REAL_DOC_R1 con ruta absoluta legible." ;;
    R2) [[ "${ANONLY_REAL_DOC_R2:-}" = /* && -r "$ANONLY_REAL_DOC_R2" ]] || fail "R2 requiere ANONLY_REAL_DOC_R2 con ruta absoluta legible." ;;
  esac
done

git rev-parse HEAD >"$RUN_DIR/commit.txt"
git status --short >"$RUN_DIR/git-status.txt"
git diff HEAD --binary -- packages/ apps/ | sha >"$RUN_DIR/product-tree.diff.sha256"
node -e 'const os=require("node:os"); process.stdout.write(JSON.stringify({platform:process.platform,arch:process.arch,cpuCount:os.cpus().length,cpuModel:os.cpus()[0]?.model,totalMemBytes:os.totalmem(),node:process.version},null,2)+"\n")' >"$RUN_DIR/host.json"
if [[ -d "$DIST_DIR" && ! -d "$RUN_DIR/dist-original" ]]; then cp -R "$DIST_DIR" "$RUN_DIR/dist-original" || fail "respaldo cliente fallido"; digest_dir "$RUN_DIR/dist-original" >"$RUN_DIR/dist-original.digest"; fi
if [[ -d "$DIST_DIR" && -d "$RUN_DIR/dist-original" ]]; then RESTORE_CLIENT_DIST=1; fi
if [[ -d "$SHELL_DIST_DIR" && ! -d "$RUN_DIR/shell-dist-original" ]]; then cp -R "$SHELL_DIST_DIR" "$RUN_DIR/shell-dist-original" || fail "respaldo shell fallido"; digest_dir "$RUN_DIR/shell-dist-original" >"$RUN_DIR/shell-dist-original.digest"; fi
if [[ -d "$SHELL_DIST_DIR" && -d "$RUN_DIR/shell-dist-original" ]]; then RESTORE_SHELL_DIST=1; fi
if [[ "$PHASE" == "profiles-gap" ]]; then
  if [[ "$RESTORE_CLIENT_DIST" -eq 0 ]]; then REMOVE_CLIENT_DIST=1; fi
  if [[ "$RESTORE_SHELL_DIST" -eq 0 ]]; then REMOVE_SHELL_DIST=1; fi
fi

log "Build único empaquetado para la campaña OCR..."
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || fail "falló el build del shell."
VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || fail "falló el build del cliente."
digest_dir "$DIST_DIR" >"$RUN_DIR/client-dist.digest"
sha assets.lock.json >"$RUN_DIR/assets-lock.sha256"
sha pnpm-lock.yaml >"$RUN_DIR/pnpm-lock.sha256"
git diff HEAD --binary -- packages/ apps/ | sha >"$RUN_DIR/product-tree.after-build.diff.sha256"
[[ "$(cat "$RUN_DIR/product-tree.diff.sha256")" == "$(cat "$RUN_DIR/product-tree.after-build.diff.sha256")" ]] || fail "el build modificó el árbol de fuentes de producto medido."

export ANONLY_T5_FACTORY_CHUNKS="$(node --input-type=module - <<'NODE'
import fs from "node:fs";
const dir="apps/react-client/dist/assets";
const bindings={};
for(const file of fs.readdirSync(dir).filter(file=>file.endsWith(".js.map"))) {
  const map=JSON.parse(fs.readFileSync(`${dir}/${file}`,"utf8"));
  if(map.sources.some(source=>source.endsWith("ocr-engine/src/worker/entry.ts"))) bindings[file.slice(0,-4)]="ocr-entry";
  if(map.sources.some(source=>source.endsWith("ocr-engine/src/worker/orientation-entry.ts"))) bindings[file.slice(0,-4)]="orientation-entry";
}
if(Object.values(bindings).filter(role=>role==="ocr-entry").length!==1 || Object.values(bindings).filter(role=>role==="orientation-entry").length!==1) throw new Error("Exactly one OCR and one OSD source binding required");
process.stdout.write(JSON.stringify(bindings));
NODE
)"
[[ -n "$ANONLY_T5_FACTORY_CHUNKS" ]] || fail "no se pudieron identificar factories del build"
printf '%s\n' "$ANONLY_T5_FACTORY_CHUNKS" >"$RUN_DIR/factory-chunks.json"

if [[ "$PHASE" == "profiles-gap" ]]; then
  log "Paso 0 de la sonda WASM (T-11), antes de medir..."
  if ANONLY_WASM_RUN="step0" ANONLY_WASM_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/wasm-attribution.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/wasm-step0.log" 2>&1; then
    log "Paso 0 WASM OK."
  else
    fail "Paso 0 WASM falló; ver $RUN_DIR/wasm-step0.log."
  fi
fi

run_one() {
  local kind="$1" arm="$2" profile="$3" round="$4"
  local id="memory-${arm}-${profile}-r${round}"
  local artifact="ocr-pool-${kind}-${arm}-${profile}-r${round}.json"
  local validity_id="${kind}-${arm}-${profile}-r${round}"
  [[ ! -e "$RUN_DIR/$artifact" ]] || fail "el artefacto ya existe; no se sobrescribe: $id"
  [[ "$(digest_dir "$DIST_DIR")" == "$(cat "$RUN_DIR/client-dist.digest")" ]] || fail "build modificado durante la campaña"
  log "Corrida $validity_id"
  capture_pressure "before-$id"
  local before_sleep_wake=""
  if [[ "$PHASE" == "profiles-gap" ]]; then before_sleep_wake="$(sleep_wake_digest)"; fi
  local status=0
  if ANONLY_OCR_POOL_RUN="$id" ANONLY_OCR_POOL_PHASE="$kind" ANONLY_OCR_POOL_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ocr-pool.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
    log "OK $validity_id"
  else
    status=$?
    log "FALLO $validity_id"
    if [[ "$PHASE" == "profiles-gap" ]]; then record_invalid_run "$validity_id" "playwright-failure"; fi
  fi
  capture_pressure "after-$id"
  if [[ "$PHASE" == "profiles-gap" && "$(sleep_wake_digest)" != "$before_sleep_wake" ]]; then
    record_invalid_run "$validity_id" "sleep-wake-event-during-run"
    status=1
  fi
  if [[ "$status" -ne 0 ]]; then fail "corrida inválida $validity_id; no se continúa ni se agrega"; fi
}

ORDERS=("2 3 4" "4 3 2" "2 4 3")
if [[ "${ANONLY_OCR_MEMORY_PILOT:-0}" == "1" ]]; then
  for arm in 2 4; do run_one pool-endstage "$arm" P2 0; done
  log "Piloto completo; no se publica como campaña."
else
  for profile in P2 R2; do
    for round in 0 1 2; do
      for arm in ${ORDERS[$round]}; do
        run_one pool-rss "$arm" "$profile" "$round"
        run_one pool-endstage "$arm" "$profile" "$round"
      done
    done
  done
  node tests/perf/support/summarize-ocr-memory.mjs "$RUN_DIR" || fail "agregación incompleta"
fi
[[ "$(digest_dir "$DIST_DIR")" == "$(cat "$RUN_DIR/client-dist.digest")" ]] || fail "build final distinto"
log "Campaña completa; se restauran builds previos."
