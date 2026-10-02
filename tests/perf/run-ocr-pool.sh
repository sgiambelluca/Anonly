#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

# Sequential OCR LSTM pool campaign plus opt-in profile-gap and ultra (6 recognizers) phases.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
# Fase 2 de la campaña de DPI descendente: tiene su propio runner, para no tocar el comportamiento de `ultra`.
if [[ "${ANONLY_OCR_POOL_PHASE:-}" == "ultra-dpi" ]]; then exec "${BASH:-bash}" "$ROOT_DIR/tests/perf/run-ocr-pool-dpi.sh" "$@"; fi
# shellcheck source=support/ocr-pool-platform.sh
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"

RUN_DIR="${ANONLY_OCR_POOL_OUTPUT_DIR:-.measure/ocr-pool/$(date -u +%Y%m%dT%H%M%SZ)}"
PHASE="${ANONLY_OCR_POOL_PHASE:-all}"
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
case "$PHASE" in all|r2-time|memory-cancel|profiles-gap|ultra) ;; *) echo "Fase desconocida: $PHASE" >&2; exit 1 ;; esac

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }
fail() { log "ABORTA: $*"; exit 1; }
capture_pressure() {
  local label="$1"
  if [[ "$PLATFORM" == "windows" ]]; then
    { echo "=== $label $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="; capture_pressure_windows || echo "snapshot de memoria no disponible"; } >>"$RUN_DIR/system-pressure.txt" 2>&1
    return 0
  fi
  { echo "=== $label $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="; pmset -g batt; pmset -g assertions | grep -E 'PreventSystemSleep|PreventUserIdleSystemSleep' || true; vm_stat; sysctl vm.swapusage; } >>"$RUN_DIR/system-pressure.txt" 2>&1
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
    cp -R "$RUN_DIR/dist-original" "$DIST_DIR" || log "LIMPIEZA REQUERIDA: no se pudo restaurar el dist del cliente."
    if [[ -f "$RUN_DIR/dist-original.digest" && "$(digest_dir "$DIST_DIR")" != "$(cat "$RUN_DIR/dist-original.digest")" ]]; then
      log "LIMPIEZA REQUERIDA: el dist del cliente restaurado no coincide."
    fi
  fi
  if [[ "$RESTORE_SHELL_DIST" -eq 1 && -d "$RUN_DIR/shell-dist-original" ]]; then
    rm -rf "$SHELL_DIST_DIR"
    cp -R "$RUN_DIR/shell-dist-original" "$SHELL_DIST_DIR" || log "LIMPIEZA REQUERIDA: no se pudo restaurar el dist del shell."
  fi
  if [[ "$REMOVE_CLIENT_DIST" -eq 1 ]]; then rm -rf "$DIST_DIR"; fi
  if [[ "$REMOVE_SHELL_DIST" -eq 1 ]]; then rm -rf "$SHELL_DIST_DIR"; fi
  stop_keep_awake
  ps_cleanup
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "$PLATFORM" in
  darwin) ;;
  windows)
    [[ "$PHASE" == "ultra" ]] || fail "en Windows nativo solo está soportada la fase ultra; las demás corren en macOS."
    ps_init || fail "no se pudo crear el directorio temporal de PowerShell."
    ;;
  *) fail "plataforma no soportada ($(uname -s)): esta campaña corre en macOS y, la fase ultra, en Windows nativo (Git Bash)." ;;
esac
if [[ "$PLATFORM" == "windows" ]]; then
  # Mejor esfuerzo: sin pgrep, se consulta la línea de comandos de los procesos con PowerShell.
  # Solo cuentan los procesos que mencionan este repo (corridas de Playwright o Vitest lanzadas desde él).
  for guard in 'playwright test --config|cli\.js test --config:Playwright' 'vitest(\.mjs)? (run|watch):Vitest'; do
    if count="$(windows_process_count "${guard%%:*}" "$ROOT_DIR")"; then
      [[ "$count" == "0" ]] || fail "hay otro ${guard##*:} activo."
    else
      guard_detail="$(ps_last_error 'sin detalle (salida no numérica o vacía)')"
      add_caveat "concurrent-process-guard-unavailable-${guard##*:}" "no se pudo consultar procesos (${guard##*:}): $guard_detail; la tanda corrió sin esa guarda"
    fi
  done
  if start_keep_awake_windows; then
    log "Prevención de suspensión activa (confirmada por el marcador de SetThreadExecutionState); no cubre el cierre de tapa."
  else
    add_caveat "sleep-prevention-unavailable" "no se confirmó SetThreadExecutionState: configurá el plan de energía (ver README)"
  fi
else
  if pgrep -f '[p]laywright test --config' >/dev/null; then fail "hay otro Playwright activo."; fi
  if pgrep -f '[v]itest run' >/dev/null; then fail "hay otro Vitest activo."; fi
fi
if [[ "$PHASE" == "profiles-gap" || "$PHASE" == "ultra" ]]; then
  if sleep_wake_digest >/dev/null; then
    write_sleep_detection true ""
  else
    sleep_detection_failed "al inicio"
  fi
fi
if [[ "$PHASE" != "profiles-gap" ]] && ! git diff --quiet -- packages/ apps/; then
  fail "hay cambios sin commitear en packages/ o apps/; la campaña histórica exige producto limpio."
fi
VALIDATION_PROFILES=(P1 P2 R1 R2)
if [[ "$PHASE" == "profiles-gap" ]]; then VALIDATION_PROFILES=(P2 R2); fi
# ultra: P2 siempre; R2 solo si la variable apunta a un archivo legible (nunca se loguea la ruta).
ULTRA_PROFILES=(P2)
ULTRA_R2_NOTE="null"
if [[ "$PHASE" == "ultra" ]]; then
  VALIDATION_PROFILES=(P2)
  if readable_abs_file "${ANONLY_REAL_DOC_R2:-}"; then
    ULTRA_PROFILES=(P2 R2)
  elif [[ -z "${ANONLY_REAL_DOC_R2:-}" ]]; then
    ULTRA_R2_NOTE='"ANONLY_REAL_DOC_R2 no definido: la fase corrió solo P2"'
  else
    ULTRA_R2_NOTE='"ANONLY_REAL_DOC_R2 definido pero no es una ruta absoluta legible: la fase corrió solo P2"'
  fi
fi
# Opt-in: P2H (P2 a 300 dpi nativos, 20 páginas) es el escaneo A4 típico; alarga la tanda.
if [[ "$PHASE" == "ultra" && "${ANONLY_OCR_POOL_ULTRA_HIDPI:-0}" == "1" ]]; then ULTRA_PROFILES+=(P2H); fi
for profile in "${VALIDATION_PROFILES[@]}"; do
  case "$profile" in
    P1|P2) ;;
    R1) readable_abs_file "${ANONLY_REAL_DOC_R1:-}" || fail "R1 requiere ANONLY_REAL_DOC_R1 con ruta absoluta legible." ;;
    R2) readable_abs_file "${ANONLY_REAL_DOC_R2:-}" || fail "R2 requiere ANONLY_REAL_DOC_R2 con ruta absoluta legible." ;;
  esac
done

# Node (el spec) lee C:/..., no /c/...: se exporta la forma nativa. La ruta no se loguea.
if [[ "$PLATFORM" == "windows" ]]; then
  for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
    if readable_abs_file "${!var:-}"; then export "$var=$(to_native_path "${!var}")"; fi
  done
fi
if [[ "$PHASE" == "ultra" ]]; then
  node -e 'const [profiles, note] = process.argv.slice(1); process.stdout.write(JSON.stringify({profiles: profiles.split(" "), r2Present: profiles.includes("R2"), r2Note: JSON.parse(note)}, null, 2) + "\n")' "${ULTRA_PROFILES[*]}" "$ULTRA_R2_NOTE" >"$RUN_DIR/ultra-corpus.json"
fi
git rev-parse HEAD >"$RUN_DIR/commit.txt"
git status --short >"$RUN_DIR/git-status.txt"
git diff HEAD --binary -- packages/ apps/ | sha >"$RUN_DIR/product-tree.diff.sha256"
node -e 'const os=require("node:os"); process.stdout.write(JSON.stringify({platform:process.platform,arch:process.arch,cpuCount:os.cpus().length,cpuModel:os.cpus()[0]?.model,totalMemBytes:os.totalmem(),node:process.version},null,2)+"\n")' >"$RUN_DIR/host.json"
if [[ -d "$DIST_DIR" && ! -d "$RUN_DIR/dist-original" ]]; then cp -R "$DIST_DIR" "$RUN_DIR/dist-original"; digest_dir "$RUN_DIR/dist-original" >"$RUN_DIR/dist-original.digest"; digest_is_plausible "$(cat "$RUN_DIR/dist-original.digest")" || fail "el digest del dist original salió vacío o igual al de la entrada vacía: find/sort no son los de MSYS."; fi
if [[ -d "$DIST_DIR" && -d "$RUN_DIR/dist-original" ]]; then RESTORE_CLIENT_DIST=1; fi
if [[ -d "$SHELL_DIST_DIR" && ! -d "$RUN_DIR/shell-dist-original" ]]; then cp -R "$SHELL_DIST_DIR" "$RUN_DIR/shell-dist-original"; fi
if [[ -d "$SHELL_DIST_DIR" && -d "$RUN_DIR/shell-dist-original" ]]; then RESTORE_SHELL_DIST=1; fi
if [[ "$PHASE" == "profiles-gap" || "$PHASE" == "ultra" ]]; then
  if [[ "$RESTORE_CLIENT_DIST" -eq 0 ]]; then REMOVE_CLIENT_DIST=1; fi
  if [[ "$RESTORE_SHELL_DIST" -eq 0 ]]; then REMOVE_SHELL_DIST=1; fi
fi

if [[ "$PHASE" == "ultra" ]]; then
  log "Fase ultra: corpus ${ULTRA_PROFILES[*]}."
  [[ "${ULTRA_PROFILES[*]}" == *R2* ]] || log "R2 ausente: la fase corre solo P2 y el resumen lo hace constar."
fi
log "Build único empaquetado para la campaña OCR..."
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || fail "falló el build del shell."
VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || fail "falló el build del cliente."
digest_dir "$DIST_DIR" >"$RUN_DIR/client-dist.digest"
digest_is_plausible "$(cat "$RUN_DIR/client-dist.digest")" || fail "el digest del dist del cliente salió vacío o igual al de la entrada vacía: find/sort no son los de MSYS o el dist está vacío."
sha assets.lock.json >"$RUN_DIR/assets-lock.sha256"
sha pnpm-lock.yaml >"$RUN_DIR/pnpm-lock.sha256"
git diff HEAD --binary -- packages/ apps/ | sha >"$RUN_DIR/product-tree.after-build.diff.sha256"
[[ "$(cat "$RUN_DIR/product-tree.diff.sha256")" == "$(cat "$RUN_DIR/product-tree.after-build.diff.sha256")" ]] || fail "el build modificó el árbol de fuentes de producto medido."

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

# El spec escribe el JSON antes de sus expect: con trabajo activo y latencia medida por encima
# del SLA, el único assert que pudo fallar es el de la latencia. Sin JSON o sin esas marcas, fue otra causa.
cancel_failed_only_on_sla() {
  node - "$1" <<'NODE'
const fs = require("node:fs");
if (!fs.existsSync(process.argv[2])) process.exit(1);
const probe = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).probe;
const ok = probe?.failed === false && probe.cancelActiveOcrJobs > 0 && Number.isFinite(probe.cancelLatencyMs) && probe.cancelLatencyMs > 200;
process.exit(ok ? 0 : 1);
NODE
}

run_one() {
  local kind="$1" arm="$2" profile="$3" round="$4"
  local id="${kind}-${arm}-${profile}-r${round}"
  log "Corrida $id"
  capture_pressure "before-$id"
  local before_sleep_wake="" after_sleep_wake=""
  if [[ ( "$PHASE" == "profiles-gap" || "$PHASE" == "ultra" ) && "$SLEEP_DETECTION_OK" == "1" ]]; then
    before_sleep_wake="$(sleep_wake_digest)" || sleep_detection_failed "antes de $id"
  fi
  local status=0
  local spec_phase="$PHASE" artifact="ocr-pool-${id}.json"
  # ultra: la memoria usa el RSS natural del árbol (fase pool-rss del spec), sin CDP ni barrera.
  if [[ "$PHASE" == "ultra" && "$kind" == "memory" ]]; then
    spec_phase="pool-rss"
    artifact="ocr-pool-pool-rss-${arm}-${profile}-r${round}.json"
  fi
  [[ ! -e "$RUN_DIR/$artifact" ]] || fail "el artefacto ya existe; no se sobrescribe: $id"
  if ANONLY_OCR_POOL_RUN="$id" ANONLY_OCR_POOL_PHASE="$spec_phase" ANONLY_OCR_POOL_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ocr-pool.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
    log "OK $id"
  else
    status=$?
    log "FALLO $id"
    if [[ "$PHASE" == "profiles-gap" ]]; then
      record_invalid_run "$id" "playwright-failure"
    elif [[ "$PHASE" == "ultra" ]]; then
      # Una cancelación que solo excede el SLA se conserva y el resumen la marca; cualquier otro fallo invalida.
      if [[ "$kind" == "cancel" ]] && cancel_failed_only_on_sla "$RUN_DIR/$artifact"; then
        log "Cancelación $id fuera de SLA: se conserva, el resumen la marca."
      else
        record_invalid_run "$id" "playwright-failure"
      fi
    fi
  fi
  capture_pressure "after-$id"
  if [[ ( "$PHASE" == "profiles-gap" || "$PHASE" == "ultra" ) && "$SLEEP_DETECTION_OK" == "1" ]]; then
    after_sleep_wake="$(sleep_wake_digest)" || { after_sleep_wake=""; sleep_detection_failed "después de $id"; }
    if [[ "$SLEEP_DETECTION_OK" == "1" && "$after_sleep_wake" != "$before_sleep_wake" ]]; then
      record_invalid_run "$id" "sleep-wake-event-during-run"
      status=1
    fi
  fi
  if [[ "$status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi
}

# Three interleaved time rounds; profiles-gap is isolated from the historical campaign.
TIME_ORDERS=("2 3 4" "4 3 2" "2 4 3")
TIME_PROFILES=(P1 P2 R1 R2)
if [[ "$PHASE" == "r2-time" ]]; then TIME_PROFILES=(R2); fi
if [[ "$PHASE" == "memory-cancel" ]]; then TIME_PROFILES=(); fi
if [[ "$PHASE" == "profiles-gap" ]]; then
  TIME_ORDERS=("1 2 3 4" "4 3 2 1" "2 4 1 3")
  TIME_PROFILES=(P2 R2)
fi
ROUNDS=(0 1 2)
SMOKE="${ANONLY_OCR_POOL_ULTRA_SMOKE:-0}"
if [[ "$PHASE" == "ultra" ]]; then
  TIME_ORDERS=("2 4 4b 6 6b" "6b 6 4b 4 2" "4b 6b 2 6 4")
  TIME_PROFILES=("${ULTRA_PROFILES[@]}")
  # Humo (SMOKE=1 o 2): una sola corrida de tiempo por brazo en P2; sin resumen agregado.
  if [[ "$SMOKE" != "0" ]]; then
    TIME_PROFILES=(P2)
    if [[ "${ANONLY_OCR_POOL_ULTRA_HIDPI:-0}" == "1" ]]; then TIME_PROFILES=(P2 P2H); fi
    ROUNDS=(0)
  fi
fi
if [[ "$PHASE" == "all" || "$PHASE" == "r2-time" || "$PHASE" == "profiles-gap" || "$PHASE" == "ultra" ]]; then
for profile in "${TIME_PROFILES[@]}"; do
  for round in "${ROUNDS[@]}"; do
    for arm in ${TIME_ORDERS[$round]}; do run_one time "$arm" "$profile" "$round"; done
  done
done
fi

# Three memory repetitions per arm, only where OCR actually runs.
MEMORY_ORDERS=("2 3 4" "4 3 2" "2 4 3")
MEMORY_PROFILES=(P2 R2)
if [[ "$PHASE" == "r2-time" ]]; then MEMORY_PROFILES=(); fi
if [[ "$PHASE" == "memory-cancel" ]]; then MEMORY_PROFILES=(P2 R2); fi
if [[ "$PHASE" == "profiles-gap" ]]; then MEMORY_ORDERS=("1 2 3 4" "4 3 2 1" "2 4 1 3"); fi
if [[ "$PHASE" == "ultra" ]]; then
  MEMORY_ORDERS=("2 4 4b 6 6b" "6b 6 4b 4 2" "4b 6b 2 6 4")
  MEMORY_PROFILES=("${ULTRA_PROFILES[@]}")
  if [[ "$SMOKE" != "0" ]]; then MEMORY_PROFILES=(); fi
fi
if [[ "$PHASE" == "all" || "$PHASE" == "memory-cancel" || "$PHASE" == "profiles-gap" || "$PHASE" == "ultra" ]]; then
for profile in ${MEMORY_PROFILES[@]+"${MEMORY_PROFILES[@]}"}; do
  for round in 0 1 2; do
    for arm in ${MEMORY_ORDERS[$round]}; do run_one memory "$arm" "$profile" "$round"; done
  done
done
fi

# Active OCR cancellation: both scanned corpora, once per requested pool size.
CANCEL_PROFILES=(P2 R2)
if [[ "$PHASE" == "ultra" ]]; then CANCEL_PROFILES=("${ULTRA_PROFILES[@]}"); if [[ "$SMOKE" != "0" ]]; then CANCEL_PROFILES=(); fi; fi
if [[ "$PHASE" == "all" || "$PHASE" == "memory-cancel" || "$PHASE" == "profiles-gap" || "$PHASE" == "ultra" ]]; then
for profile in ${CANCEL_PROFILES[@]+"${CANCEL_PROFILES[@]}"}; do
  if [[ "$PHASE" == "profiles-gap" ]]; then CANCEL_ARMS=(1 2 3 4); elif [[ "$PHASE" == "ultra" ]]; then CANCEL_ARMS=(2 4 4b 6 6b); else CANCEL_ARMS=(2 3 4); fi
  for arm in "${CANCEL_ARMS[@]}"; do run_one cancel "$arm" "$profile" 0; done
done
fi

# Humo ampliado (SMOKE=2): además, una corrida de memoria (RSS natural) y una de cancelación del brazo 6b.
if [[ "$PHASE" == "ultra" && "$SMOKE" == "2" ]]; then
  run_one memory 6b P2 0
  run_one cancel 6b P2 0
fi

# Windows: la prevención de suspensión tiene que seguir viva al final; si murió, la salvedad entra al resumen.
if [[ "$PLATFORM" == "windows" ]] && ! keep_awake_alive; then
  add_caveat "sleep-prevention-lost" "el powershell de prevención de suspensión murió durante la campaña: el equipo pudo suspenderse sin que se registre"
fi
if [[ "$PHASE" != "ultra" ]]; then
node - "$RUN_DIR" "$PHASE" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const phase = process.argv[3];
const isProfileGap = phase === "profiles-gap";
const profiles = isProfileGap ? ["P2", "R2"] : ["P1", "P2", "R1", "R2"];
const arms = isProfileGap ? ["1", "2", "3", "4"] : ["2", "3", "4"];
const read = (kind, arm, profile, round) => {
  const file = path.join(dir, `ocr-pool-${kind}-${arm}-${profile}-r${round}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const median = (xs) => { const s=[...xs].sort((a,b)=>a-b); return s.length ? s[Math.floor(s.length/2)] : null; };
const summary = { phase, time: {}, memory: {}, cancellation: {}, missingRuns: [] };
let exact = true;
const includedProfiles = phase === "r2-time" ? ["R2"] : phase === "memory-cancel" ? [] : profiles;
for (const profile of includedProfiles) {
  for (const arm of (isProfileGap ? ["1","3","4"] : ["3","4"])) for (let round=0;round<3;round++) {
    const base=read("time","2",profile,round)?.probe;
    const candidate=read("time",arm,profile,round)?.probe;
    if (!base || !candidate) { summary.missingRuns.push(`time-${arm}-${profile}-r${round}`); exact=false; continue; }
    for (const key of ["ocrQualitySha256","occurrenceSha256","groupSha256"]) if(candidate[key]!==base[key]) exact=false;
  }
  for (const arm of arms) {
    const runs=[0,1,2].map((round)=>read("time",arm,profile,round));
    for(let round=0;round<3;round++) if(!runs[round]) summary.missingRuns.push(`time-${arm}-${profile}-r${round}`);
    const present=runs.filter(Boolean);
    const durations=present.map((run)=>run.timed?.totalMs).filter(Number.isFinite);
    const ocr=present.map((run)=>run.timed?.intervalsMs?.ocrMs).filter(Number.isFinite);
    summary.time[`${profile}-${arm}`]={runs:present.map((run)=>({runId:run.runId,startedAtUtc:run.startedAtUtc,totalMs:run.timed?.totalMs,ocrMs:run.timed?.intervalsMs?.ocrMs,ocrBusyPeak:run.probe.effectiveBusyRecognizersPeak,osdBusyPeak:run.probe.effectiveBusyOsdPeak,requestWindow:run.probe.requestedConcurrentRequestsByContract,ocrPages:run.probe.ocrPageCount,ocrWordCountByPage:run.probe.ocrWordCountByPage,ocrCharacterCountByPage:run.probe.ocrCharacterCountByPage,totalOcrCharacters:run.probe.totalOcrCharacters,rgbaWindowPeakBytes:run.probe.estimatedReservationWindowPeakBytes,reservationBudgetBytes:run.probe.reservationBudgetBytes,budgetWaitObserved:run.probe.reservationWaitObserved,workerQueueSaturationCount:run.probe.workerPoolSaturationEvents?.length})),medianTotalMs:median(durations),rangeTotalMs:durations.length?[Math.min(...durations),Math.max(...durations)]:null,medianOcrMs:median(ocr)};
  }
}
if (phase === "all" || phase === "memory-cancel" || isProfileGap) for (const profile of ["P2","R2"]) {
  for (const arm of (isProfileGap ? ["1","3","4"] : ["3","4"])) for(let round=0;round<3;round++) {
    const candidate=read("memory",arm,profile,round);
    if(!candidate) { summary.missingRuns.push(`memory-${arm}-${profile}-r${round}`); exact=false; continue; }
    for(const temp of (isProfileGap ? ["cold"] : ["cold","hot"])) {
      const base=read("memory","2",profile,round)?.memoryRuns.find((item)=>item.temperature===temp)?.probe;
      const compared=candidate.memoryRuns.find((item)=>item.temperature===temp)?.probe;
      if (!base || !compared) { exact=false; continue; }
      for(const key of ["ocrQualitySha256","occurrenceSha256","groupSha256"]) if(base?.[key]!==compared?.[key]) exact=false;
    }
  }
  for(const arm of arms) {
    const runs=[0,1,2].map((round)=>read("memory",arm,profile,round));
    for(let round=0;round<3;round++) if(!runs[round]) summary.missingRuns.push(`memory-${arm}-${profile}-r${round}`);
    summary.memory[`${profile}-${arm}`]=runs.filter(Boolean).map((run)=>({runId:run.runId,startedAtUtc:run.startedAtUtc,coldTotalMs:run.report?.cold?.totalMs,hotTotalMs:run.report?.hot?.totalMs,coldOcrMs:run.report?.cold?.ocrDurationMs,hotOcrMs:run.report?.hot?.ocrDurationMs,coldRssPeakDuringOcrBytes:run.report?.cold?.rssPeakDuringOcrBytes,hotRssPeakDuringOcrBytes:run.report?.hot?.rssPeakDuringOcrBytes,coldWorkerPeaks:run.report?.cold?.workerPeakByType,hotWorkerPeaks:run.report?.hot?.workerPeakByType,coldBusyPeak:run.memoryRuns.find((item)=>item.temperature==="cold")?.probe.effectiveBusyRecognizersPeak,hotBusyPeak:run.memoryRuns.find((item)=>item.temperature==="hot")?.probe.effectiveBusyRecognizersPeak,coldOcrCharacterCountByPage:run.memoryRuns.find((item)=>item.temperature==="cold")?.probe.ocrCharacterCountByPage,hotOcrCharacterCountByPage:run.memoryRuns.find((item)=>item.temperature==="hot")?.probe.ocrCharacterCountByPage,wasmSampler:run.wasmSampler}));
  }
}
if (phase === "all" || phase === "memory-cancel" || isProfileGap) for(const profile of ["P2","R2"]) for(const arm of arms) {
  const run=read("cancel",arm,profile,0);
  if(!run) { summary.missingRuns.push(`cancel-${arm}-${profile}-r0`); exact=false; continue; }
  summary.cancellation[`${profile}-${arm}`]={activeJobs:run.probe.cancelActiveOcrJobs,cancelLatencyMs:run.probe.cancelLatencyMs};
}
summary.qualityExactAcrossArms=exact;
fs.writeFileSync(path.join(dir,"summary.json"),JSON.stringify(summary,null,2)+"\n");
process.stdout.write(JSON.stringify({summaryPath:path.join(dir,"summary.json"),qualityExactAcrossArms:exact},null,2)+"\n");
if(!exact) process.exitCode=1;
NODE
[[ "$?" -eq 0 ]] || FAILED=$((FAILED + 1))
fi

# When a campaign is continued, merge valid artifacts from prior folders and
# honor each source's validity.json; never let a later phase replace earlier
# phase measurements in the combined report.
RESULT_LINE=""
if [[ "$PHASE" == "ultra" && "$SMOKE" != "0" ]]; then
  log "Humo ultra: sin resumen agregado; los JSON por corrida quedan en $RUN_DIR."
  RESULT_LINE="$(ANONLY_OCR_POOL_PHASE=ultra ANONLY_OCR_POOL_ULTRA_LINE_ONLY=1 pnpm exec tsx tests/perf/support/summarize-ocr-pool.mjs "$RUN_DIR" "$RUN_DIR" | tail -n 1)"
elif [[ "$PHASE" == "ultra" ]]; then
  summary_out="$(ANONLY_OCR_POOL_PHASE=ultra pnpm exec tsx tests/perf/support/summarize-ocr-pool.mjs "$RUN_DIR" "$RUN_DIR")" || FAILED=$((FAILED + 1))
  printf '%s\n' "$summary_out"
  RESULT_LINE="$(printf '%s\n' "$summary_out" | tail -n 1)"
elif [[ "$PHASE" == "all" || "$PHASE" == "profiles-gap" || -n "${ANONLY_OCR_POOL_PRIOR_DIR:-}" ]]; then
  SUMMARY_SOURCES=("$RUN_DIR")
  if [[ -n "${ANONLY_OCR_POOL_PRIOR_DIR:-}" ]]; then
    [[ -d "$ANONLY_OCR_POOL_PRIOR_DIR" ]] || fail "la carpeta previa del agregador no existe."
    SUMMARY_SOURCES+=("$ANONLY_OCR_POOL_PRIOR_DIR")
  fi
  if [[ "$PHASE" == "profiles-gap" ]]; then
    ANONLY_OCR_POOL_PHASE="$PHASE" node tests/perf/support/summarize-ocr-pool.mjs "$RUN_DIR" "${SUMMARY_SOURCES[@]}" || FAILED=$((FAILED + 1))
  else
    node tests/perf/support/summarize-ocr-pool.mjs "$RUN_DIR" "${SUMMARY_SOURCES[@]}" || FAILED=$((FAILED + 1))
  fi
fi

log "Campaña terminada: $RUN_DIR; fallidas=$FAILED${RESULT_LINE:+; $RESULT_LINE}. Sin cambios de producto ni defaults."
exit "$((FAILED > 0))"
