#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C
export PLAYWRIGHT_NO_COPY_PROMPT=1

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

RUN_DIR="${ANONLY_NER_GAPS_OUTPUT_DIR:-.measure/ner-gaps/$(date -u +%Y%m%dT%H%M%SZ)}"
case "$RUN_DIR" in /*) ;; *) RUN_DIR="$ROOT_DIR/$RUN_DIR" ;; esac
[[ ! -e "$RUN_DIR" && ! -L "$RUN_DIR" ]] || { printf 'ABORTA: La carpeta de salida ya existe; no se sobrescribe.\n' >&2; exit 1; }
mkdir -p "$(dirname "$RUN_DIR")" || { printf 'ABORTA: No se pudo crear el directorio padre de salida.\n' >&2; exit 1; }
mkdir "$RUN_DIR" || { printf 'ABORTA: No se pudo reclamar la carpeta de salida sin sobrescribir.\n' >&2; exit 1; }
DIST_DIR="apps/react-client/dist"
KERNEL="packages/anonymization-core/ner-engine/src/worker/kernel.ts"
MODEL="apps/react-client/public/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx"
ARMS=(A 4 6 8)
PATCH_4="tests/perf/support/ner-arm-b-cuatro-hilos.patch"
PATCH_6="tests/perf/support/ner-arm-c-seis-hilos.patch"
PATCH_8="tests/perf/support/ner-arm-d-ocho-hilos.patch"
ACTIVE_PATCH=""
PRODUCT_TREE_DIGEST=""
BASE_KERNEL_SHA=""
RUN_FAILED=0
DIST_WAS_ABSENT=0
PRODUCT_BUILD_STARTED=0
[[ -d "$DIST_DIR" ]] || DIST_WAS_ABSENT=1

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$RUN_DIR/campaign.log"; }
fail() { log "ABORTA: $*"; exit 1; }
hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
digest_dir() {
  (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r file; do hash_file "$file"; done) | shasum -a 256 | awk '{print $1}'
}
digest_product_tree() { git diff HEAD --binary -- packages/ apps/ | shasum -a 256 | awk '{print $1}'; }
sleep_wake_digest() {
  pmset -g log 2>/dev/null | rg 'Entering Sleep state|Wake from' | tail -n 10 | shasum -a 256 | awk '{print $1}'
}
capture_pressure() {
  local label="$1"
  {
    printf '=== %s %s ===\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    pmset -g batt
    pmset -g assertions | rg 'PreventSystemSleep|PreventUserIdleSystemSleep' || true
    vm_stat
    sysctl vm.swapusage
    memory_pressure -Q
  } >>"$RUN_DIR/system-pressure.txt" 2>&1
}
restore_dist() {
  if [[ -d "$RUN_DIR/dist-A" ]]; then
    rm -rf "$DIST_DIR"
    cp -R "$RUN_DIR/dist-A" "$DIST_DIR" || { log "FATAL: no se pudo restaurar dist A."; RUN_FAILED=1; }
    [[ -d "$DIST_DIR" && "$(digest_dir "$DIST_DIR")" == "$(cat "$RUN_DIR/digest-A.txt")" ]] || { log "FATAL: digest dist A incorrecto después de restaurar."; RUN_FAILED=1; }
  elif [[ -d "$RUN_DIR/dist-before" ]]; then
    rm -rf "$DIST_DIR"
    cp -R "$RUN_DIR/dist-before" "$DIST_DIR" || { log "FATAL: no se pudo restaurar dist previo."; RUN_FAILED=1; }
    [[ -d "$DIST_DIR" && "$(digest_dir "$DIST_DIR")" == "$(cat "$RUN_DIR/digest-before.txt")" ]] || { log "FATAL: digest dist previo incorrecto después de restaurar."; RUN_FAILED=1; }
  elif [[ "$DIST_WAS_ABSENT" -eq 1 && "$PRODUCT_BUILD_STARTED" -eq 1 ]]; then
    rm -rf "$DIST_DIR" || { log "FATAL: no se pudo quitar el dist creado por la campaña."; RUN_FAILED=1; }
    [[ ! -e "$DIST_DIR" ]] || { log "FATAL: sigue presente el dist generado por la campaña."; RUN_FAILED=1; }
  elif [[ "$PRODUCT_BUILD_STARTED" -eq 1 ]]; then
    log "FATAL: no existe respaldo del dist previo ni del dist A para restaurar."
    RUN_FAILED=1
  fi
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$ACTIVE_PATCH" ]]; then
    git apply -R "$ACTIVE_PATCH" || { log "FATAL: no se pudo revertir el parche activo $ACTIVE_PATCH."; RUN_FAILED=1; }
    ACTIVE_PATCH=""
  fi
  restore_dist
  if [[ -n "$BASE_KERNEL_SHA" && "$(hash_file "$KERNEL")" != "$BASE_KERNEL_SHA" ]]; then
    log "FATAL: el kernel fuente no coincide con el SHA anterior a la campaña."
    RUN_FAILED=1
  fi
  if [[ -n "$PRODUCT_TREE_DIGEST" && "$(digest_product_tree)" != "$PRODUCT_TREE_DIGEST" ]]; then
    log "FATAL: el árbol de producto no volvió a su SHA inicial."
    RUN_FAILED=1
  fi
  [[ "$RUN_FAILED" -eq 0 ]] || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ "$(uname -s)" == "Darwin" ]] || fail "Este runner solo se ejecuta en macOS."
command -v pnpm >/dev/null 2>&1 || fail "pnpm no está disponible."
command -v node >/dev/null 2>&1 || fail "Node no está disponible."
for profile in R1 R2; do
  env_name="ANONLY_REAL_DOC_${profile}"
  file_path="${!env_name:-}"
  [[ "$file_path" = /* && -r "$file_path" ]] || fail "$env_name debe ser una ruta absoluta legible."
done
if pgrep -f '[p]laywright test --config' >/dev/null || pgrep -f '[v]itest (run|watch)' >/dev/null || pgrep -f '[v]itest.mjs' >/dev/null; then
  fail "Hay otra campaña Playwright o Vitest activa."
fi
if [[ -n "$(git status --short -- packages/ apps/)" ]]; then
  fail "packages/ o apps/ tienen cambios; se requiere el código de producto limpio para parches reversibles."
fi
[[ -r "$MODEL" ]] || fail "No está disponible el modelo NER local de producto."
if [[ -d "$DIST_DIR" ]]; then
  cp -R "$DIST_DIR" "$RUN_DIR/dist-before"
  digest_dir "$RUN_DIR/dist-before" >"$RUN_DIR/digest-before.txt"
fi

git rev-parse HEAD >"$RUN_DIR/commit.txt"
git status --short >"$RUN_DIR/git-status.txt"
PRODUCT_TREE_DIGEST="$(digest_product_tree)"
BASE_KERNEL_SHA="$(hash_file "$KERNEL")"
printf '%s\n' "$PRODUCT_TREE_DIGEST" >"$RUN_DIR/product-tree.sha256"
printf '%s\n' "$BASE_KERNEL_SHA" >"$RUN_DIR/source-base.sha256"
hash_file "$MODEL" >"$RUN_DIR/model-source.sha256"
node -e 'const os=require("node:os");const v={platform:process.platform,arch:process.arch,cpuCount:os.cpus().length,cpuModel:os.cpus()[0]?.model,totalMemBytes:os.totalmem(),nodeVersion:process.version};process.stdout.write(JSON.stringify(v,null,2)+"\n")' >"$RUN_DIR/host.json"
[[ "$(node -e 'process.stdout.write(String(require("node:os").cpus().length))')" -ge 8 ]] || fail "La máquina expone menos de 8 CPU; brazo 8 no aplicable."

log "Construyendo shell Electron y los cuatro brazos NER desde la misma revisión."
PRODUCT_BUILD_STARTED=1
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || fail "Falló el build de desktop-shell."
for arm in "${ARMS[@]}"; do
  patch=""
  case "$arm" in
    4) patch="$PATCH_4" ;;
    6) patch="$PATCH_6" ;;
    8) patch="$PATCH_8" ;;
  esac
  if [[ -n "$patch" ]]; then
    git apply --check "$patch" || fail "El parche de $arm hilos no aplica."
    ACTIVE_PATCH="$patch"
    git apply "$patch" || fail "No se pudo aplicar el parche de $arm hilos."
    [[ "$(git diff --numstat -- "$KERNEL")" == $'1\t0\t'"$KERNEL" ]] || fail "El brazo $arm no cambia exactamente una línea del kernel."
  fi
  hash_file "$KERNEL" >"$RUN_DIR/source-arm-$arm.sha256"
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || fail "Falló el build del brazo $arm."
  cp -R "$DIST_DIR" "$RUN_DIR/dist-$arm" || fail "No se pudo guardar dist-$arm."
  digest_dir "$RUN_DIR/dist-$arm" >"$RUN_DIR/digest-$arm.txt"
  served_model="$RUN_DIR/dist-$arm/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx"
  [[ -r "$served_model" && "$(hash_file "$served_model")" == "$(cat "$RUN_DIR/model-source.sha256")" ]] || fail "El build $arm no conserva el asset NER fijado."
  if [[ -n "$patch" ]]; then
    git apply -R "$patch" || fail "No se pudo revertir el parche $arm."
    ACTIVE_PATCH=""
  fi
  [[ "$(hash_file "$KERNEL")" == "$BASE_KERNEL_SHA" ]] || fail "El kernel no se restauró después de construir $arm."
done
[[ "$(digest_product_tree)" == "$PRODUCT_TREE_DIGEST" ]] || fail "El código de producto difiere después de construir brazos."

activate_arm() {
  local arm="$1"
  rm -rf "$DIST_DIR"
  cp -R "$RUN_DIR/dist-$arm" "$DIST_DIR" || fail "No se pudo activar el brazo $arm."
  [[ "$(digest_dir "$DIST_DIR")" == "$(cat "$RUN_DIR/digest-$arm.txt")" ]] || fail "El digest del brazo $arm no coincide al activar."
}

run_gap_test() {
  local run_id="$1" arm="$2"
  ANONLY_NER_GAPS_RUN_ID="$run_id" \
  ANONLY_NER_GAPS_ARM="$arm" \
  ANONLY_NER_GAPS_OUTPUT_DIR="$RUN_DIR" \
  ANONLY_NER_GAPS_COMMIT="$(cat "$RUN_DIR/commit.txt")" \
  ANONLY_NER_GAPS_DIRTY="$( [[ -n "$(cat "$RUN_DIR/git-status.txt")" ]] && echo 1 || echo 0 )" \
  ANONLY_NER_GAPS_SOURCE_SHA="$(cat "$RUN_DIR/source-arm-$arm.sha256")" \
  ANONLY_NER_GAPS_SOURCE_SHA_A="$(cat "$RUN_DIR/source-arm-A.sha256")" \
  ANONLY_NER_GAPS_SOURCE_SHA_4="$(cat "$RUN_DIR/source-arm-4.sha256")" \
  ANONLY_NER_GAPS_SOURCE_SHA_6="$(cat "$RUN_DIR/source-arm-6.sha256")" \
  ANONLY_NER_GAPS_SOURCE_SHA_8="$(cat "$RUN_DIR/source-arm-8.sha256")" \
  pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ner-gaps.spec.ts --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1
}
run_thread_probe() {
  local arm="$1"
  ANONLY_NER_THREADS_PHASE=threads \
  ANONLY_NER_THREADS_RUN="$arm-P1-r0" \
  ANONLY_NER_THREADS_OUTPUT_DIR="$RUN_DIR" \
  pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ner-threads.spec.ts --workers=1 --retries=0 >>"$RUN_DIR/thread-probe.log" 2>&1
}
record_sleep_invalid() {
  local run_id="$1"
  local report="$RUN_DIR/ner-gaps-$run_id.json"
  printf '%s\n' 'sleep-wake-event-during-run' >"$RUN_DIR/invalid-$run_id.txt"
  if [[ -f "$report" ]]; then
    node - "$report" <<'NODE' || fail "No se pudo marcar como inválido el reporte del bloque suspendido."
const fs = require("node:fs");
const file = process.argv[2];
const report = JSON.parse(fs.readFileSync(file, "utf8"));
report.imports = report.imports.map((item) => ({ ...item, ok: false, errors: [...(item.errors ?? []), "sleep-wake-event-during-run"] }));
const temp = `${file}.tmp`;
fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
fs.renameSync(temp, file);
NODE
  fi
}

for arm in "${ARMS[@]}"; do
  activate_arm "$arm"
  for corpus in P1 P2; do
    id="preflight-$arm-$corpus"
    log "Preflight frío y huella exacta: $id"
    capture_pressure "before-$id"
    run_gap_test "$id" "$arm" || RUN_FAILED=$((RUN_FAILED + 1))
    capture_pressure "after-$id"
  done
done
ANONLY_NER_GAPS_OUTPUT_DIR="$RUN_DIR" ANONLY_NER_GAPS_AGGREGATE_MODE=preflight \
  pnpm exec tsx tests/perf/support/nerGapsAggregate.ts >>"$RUN_DIR/aggregate.log" 2>&1 || fail "Preflight sintético incompleto o con huella distinta; no comienza R1/R2."

for arm in "${ARMS[@]}"; do
  activate_arm "$arm"
  log "Pasada separada de observación pthreads con P1: $arm-P1-r0"
  capture_pressure "before-thread-probe-$arm"
  run_thread_probe "$arm" || fail "No se pudo observar el backend de hilos del brazo $arm; no inicia la curva real."
  capture_pressure "after-thread-probe-$arm"
done

ORDERS=("A 4 6 8" "8 6 4 A" "A 6 8 4")
for block in 1 2 3; do
  order="${ORDERS[$((block - 1))]}"
  for arm in $order; do
    activate_arm "$arm"
    id="time-$arm-b$block"
    before_sleep="$(sleep_wake_digest)"
    log "Importaciones reales seriales R1→R1→R2→R2: $id"
    capture_pressure "before-$id"
    if run_gap_test "$id" "$arm"; then
      log "OK $id"
    else
      RUN_FAILED=$((RUN_FAILED + 1))
      log "FALLO $id; se conserva su reporte parcial."
    fi
    capture_pressure "after-$id"
    if [[ "$(sleep_wake_digest)" != "$before_sleep" ]]; then
      record_sleep_invalid "$id"
      RUN_FAILED=$((RUN_FAILED + 1))
      log "BLOQUE INVALIDADO por suspensión: $id"
    fi
  done
done

activate_arm A
ANONLY_NER_GAPS_OUTPUT_DIR="$RUN_DIR" pnpm exec tsx tests/perf/support/nerGapsAggregate.ts >>"$RUN_DIR/aggregate.log" 2>&1 || RUN_FAILED=$((RUN_FAILED + 1))
log "Campaña terminada con $RUN_FAILED ejecuciones inválidas; la salida quedó en $RUN_DIR. El trap restaurará dist A y el source."
exit "$((RUN_FAILED > 0))"
