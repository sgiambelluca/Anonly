#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C
# Opt-in campaign: NER ONNX automatic control vs numThreads 4/6/8.
# Each source patch is temporary and the application tree is restored to A.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

RUN_DIR="${ANONLY_NER_THREADS_OUTPUT_DIR:-.measure/ner-threads/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then
  echo "La salida ya existe: $RUN_DIR — no se pisa una tanda previa." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"
DIST_DIR="apps/react-client/dist"
ARMS="A 4 6 8"
PROFILES="${ANONLY_NER_THREADS_PROFILES:-P1 P2}"
ORDERS=("A 4 6 8" "8 6 4 A" "A 6 8 4")
ACTIVE_PATCH=""

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }
fail() { log "ABORTA: $*"; exit 1; }
sha() { LC_ALL=C shasum -a 256 "$@" 2>/dev/null | awk '{print $1}'; }
digest_dist() {
  (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do sha "$f"; done) | sha
}
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$ACTIVE_PATCH" ]]; then
    git apply -R "$ACTIVE_PATCH" >/dev/null 2>&1 || log "LIMPIEZA REQUERIDA: no se pudo revertir $ACTIVE_PATCH."
    ACTIVE_PATCH=""
  fi
  if [[ -d "$RUN_DIR/dist-A" && -f "$RUN_DIR/digest-A.txt" ]]; then
    rm -rf "$DIST_DIR"
    cp -R "$RUN_DIR/dist-A" "$DIST_DIR" || log "LIMPIEZA REQUERIDA: no se pudo restaurar dist A."
    if [[ -d "$DIST_DIR" && "$(digest_dist "$DIST_DIR")" != "$(cat "$RUN_DIR/digest-A.txt")" ]]; then
      log "LIMPIEZA REQUERIDA: el digest de dist A no coincide tras la restauración."
    fi
  fi
  if ! git diff --quiet -- packages/ apps/; then
    log "LIMPIEZA REQUERIDA: quedan cambios en el árbol de producto."
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
capture_pressure() {
  local label="$1"
  {
    echo "=== $label $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    vm_stat
    sysctl vm.swapusage
  } >>"$RUN_DIR/system-pressure.txt" 2>&1
}

if pgrep -f '[p]laywright test --config' >/dev/null; then
  fail "hay otra medición Playwright activa."
fi
if ! git diff --quiet -- packages/ apps/; then
  fail "hay cambios sin commitear en packages/ o apps/; se requiere producto limpio para aplicar y revertir los parches."
fi
if [[ "$(uname -s)" != "Darwin" ]]; then fail "esta campaña de medición solo está habilitada para macOS."; fi
for profile in $PROFILES; do
  case "$profile" in
    P1|P2) ;;
    R1) [[ "${ANONLY_REAL_DOC_R1:-}" = /* && -r "$ANONLY_REAL_DOC_R1" ]] || fail "R1 requiere ANONLY_REAL_DOC_R1 con una ruta absoluta legible." ;;
    R2) [[ "${ANONLY_REAL_DOC_R2:-}" = /* && -r "$ANONLY_REAL_DOC_R2" ]] || fail "R2 requiere ANONLY_REAL_DOC_R2 con una ruta absoluta legible." ;;
    *) fail "perfil desconocido: $profile (válidos: P1 P2 R1 R2)." ;;
  esac
done

git rev-parse HEAD >"$RUN_DIR/commit.txt"
git status --short >"$RUN_DIR/git-status.txt"
node -e 'const os=require("node:os"); const v={platform:process.platform,arch:process.arch,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,totalMemBytes:os.totalmem(),node:process.version}; process.stdout.write(JSON.stringify(v,null,2)+"\n")' >"$RUN_DIR/host.json"
if [[ "$(node -e 'process.stdout.write(String(require("node:os").cpus().length))')" -lt 8 ]]; then
  fail "la máquina tiene menos de 8 CPUs visibles; 8 hilos no aplicable por el criterio del plan."
fi

log "Construyendo shell empaquetado y brazos NER..."
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || fail "falló el build del shell."
for arm in $ARMS; do
  patch=""
  case "$arm" in
    4) patch=tests/perf/support/ner-arm-b-cuatro-hilos.patch ;;
    6) patch=tests/perf/support/ner-arm-c-seis-hilos.patch ;;
    8) patch=tests/perf/support/ner-arm-d-ocho-hilos.patch ;;
  esac
  if [[ -n "$patch" ]]; then
    git apply --check "$patch" || fail "el parche del brazo $arm no aplica sobre la revisión medida."
    ACTIVE_PATCH="$patch"
    git apply "$patch" || fail "no se pudo aplicar el parche $arm."
    cp "$patch" "$RUN_DIR/arm-$arm.patch"
  fi
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || {
    fail "falló el build del brazo $arm."
  }
  cp -R "$DIST_DIR" "$RUN_DIR/dist-$arm" || fail "no se pudo guardar dist-$arm."
  digest_dist "$RUN_DIR/dist-$arm" >"$RUN_DIR/digest-$arm.txt"
  if [[ -n "$patch" ]]; then
    git apply -R "$patch" || fail "no se pudo revertir el parche $arm."
    ACTIVE_PATCH=""
  fi
done
git diff --quiet -- packages/ apps/ || fail "el árbol de producto quedó modificado al construir los brazos."

activate() {
  rm -rf "$DIST_DIR"
  cp -R "$RUN_DIR/dist-$1" "$DIST_DIR" || fail "no se pudo activar brazo $1."
  [[ "$(digest_dist "$DIST_DIR")" == "$(cat "$RUN_DIR/digest-$1.txt")" ]] || fail "digest incorrecto al activar $1."
}
run_one() {
  local arm="$1" profile="$2" round="$3"
  activate "$arm"
  local id="$arm-$profile-r$round"
  log "Corrida $id"
  capture_pressure "before-$id"
  ANONLY_NER_THREADS_RUN="$id" ANONLY_NER_THREADS_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ner-threads.spec.ts \
    --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1
  local status=$?
  capture_pressure "after-$id"
  return "$status"
}

# Compatibility and quality preflight is completed before the memory/time pairs.
for profile in $PROFILES; do
for arm in $ARMS; do
  activate "$arm"
  id="quality-$arm-$profile"
  log "Preflight de calidad $id"
  capture_pressure "before-$id"
  ANONLY_NER_THREADS_RUN="$id" ANONLY_NER_THREADS_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ner-threads.spec.ts \
    --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1 || fail "falló el preflight de calidad $id."
  capture_pressure "after-$id"
done
node - "$RUN_DIR" "$profile" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const profile = process.argv[3];
const read = (arm) => JSON.parse(fs.readFileSync(path.join(dir, `ner-threads-quality-${arm}-${profile}.json`), "utf8"));
const baseline = read("A").probe;
for (const arm of ["4", "6", "8"]) {
  const candidate = read(arm).probe;
  for (const key of ["occurrenceCount", "occurrenceSha256", "groupEventCount", "groupEventSha256"]) {
    if (candidate[key] !== baseline[key]) {
      throw new Error(`La calidad de ${arm} difiere del control A en ${key}; no se inicia la medición.`);
    }
  }
}
process.stdout.write(`Preflight ${profile}: NER y Grouping exacto: A = 4 = 6 = 8.\n`);
NODE
[[ "$?" -eq 0 ]] || fail "salida distinta en el preflight de calidad."
done

FAILED=0
for profile in $PROFILES; do
  for ((round=0; round<${#ORDERS[@]}; round++)); do
    for arm in ${ORDERS[$round]}; do
      if run_one "$arm" "$profile" "$round"; then log "OK memory $arm/$profile ronda $round"; else log "FALLO memory $arm/$profile ronda $round"; FAILED=$((FAILED+1)); fi
      activate "$arm"
      id="time-$arm-$profile-r$round"
      log "Corroboración sin sonda de memoria: $id"
      capture_pressure "before-$id"
      if ANONLY_NER_THREADS_RUN="$id" ANONLY_NER_THREADS_OUTPUT_DIR="$RUN_DIR" \
        pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ner-threads.spec.ts \
        --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then log "OK $id"; else log "FALLO $id"; FAILED=$((FAILED+1)); fi
      capture_pressure "after-$id"
    done
  done
done

# Cancellation is a separate, untimed run after each corpus' paired timing data.
for profile in $PROFILES; do
for arm in $ARMS; do
  activate "$arm"
  id="cancel-$arm-$profile"
  log "Cancelación con inferencia activa: $id"
  capture_pressure "before-$id"
  if ANONLY_NER_THREADS_RUN="$id" ANONLY_NER_THREADS_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ner-threads.spec.ts \
    --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then log "OK $id"; else log "FALLO $id"; FAILED=$((FAILED+1)); fi
  capture_pressure "after-$id"
done
done

activate A
log "Campaña terminada: $RUN_DIR; fallidas=$FAILED. Brazo A restaurado en dist."
exit "$((FAILED > 0))"
