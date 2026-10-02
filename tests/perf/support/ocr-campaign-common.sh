#!/usr/bin/env bash
# Preámbulo común de los runners de la campaña de DPI descendente (run-ocr-dpi-down.sh y
# run-ocr-pool-dpi.sh). Se carga con `source` DESPUÉS de ocr-pool-platform.sh. El runner define
# ROOT_DIR, RUN_DIR y PLATFORM antes de llamar a campaign_init. No cambia opciones de la shell.
#
# Regla heredada de `ultra`: ningún chequeo informa «activo» o «sin novedad» sin una señal positiva.
# Lo que no se puede confirmar queda como salvedad (caveats.json) y el resumen la muestra.

DIST_DIR="apps/react-client/dist"
SHELL_DIST_DIR="apps/desktop-shell/dist"
FAILED=0
declare -a INVALID_RUN_IDS=()
RESTORE_CLIENT_DIST=0
RESTORE_SHELL_DIST=0
REMOVE_CLIENT_DIST=0
REMOVE_SHELL_DIST=0

log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }
fail() { log "ABORTA: $*"; exit 1; }

campaign_init() {
  if [[ -e "$RUN_DIR" ]]; then
    echo "La salida ya existe: $RUN_DIR — no se pisa una tanda previa." >&2
    exit 1
  fi
  mkdir -p "$RUN_DIR"
  trap campaign_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

capture_pressure() {
  local label="$1"
  if [[ "$PLATFORM" == "windows" ]]; then
    { echo "=== $label $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="; capture_pressure_windows || echo "snapshot de memoria no disponible"; } >>"$RUN_DIR/system-pressure.txt" 2>&1
    return 0
  fi
  { echo "=== $label $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="; pmset -g batt; pmset -g assertions | grep -E 'PreventSystemSleep|PreventUserIdleSystemSleep' || true; vm_stat; sysctl vm.swapusage; } >>"$RUN_DIR/system-pressure.txt" 2>&1
}

# validity.json: { affectedRunIds: [...], reasonsByRunId: { id: [motivos] } }; mismo formato que `ultra`.
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
  log "Unidad inválida marcada: $run_id ($reason)."
}

campaign_cleanup() {
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

# Plataforma, guardas de procesos concurrentes, prevención y detección de suspensión, producto limpio.
campaign_preflight() {
  case "$PLATFORM" in
    darwin) ;;
    windows) ps_init || fail "no se pudo crear el directorio temporal de PowerShell." ;;
    *) fail "plataforma no soportada ($(uname -s)): esta campaña corre en Windows nativo (Git Bash) y, de humo, en macOS." ;;
  esac
  if [[ "$PLATFORM" == "windows" ]]; then
    # Mejor esfuerzo: sin pgrep, se consulta la línea de comandos de los procesos con PowerShell.
    # Solo cuentan los procesos que mencionan este repo (corridas de Playwright o Vitest lanzadas desde él).
    local guard count guard_detail
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
  if sleep_wake_digest >/dev/null; then
    write_sleep_detection true ""
  else
    sleep_detection_failed "al inicio"
  fi
  # Lo que está en stage y lo que no está trackeado también cuenta (`git diff` no lo ve).
  if [[ -n "$(git status --porcelain -- packages apps)" ]]; then
    fail "hay cambios (sin commitear, en stage o sin trackear) en packages/ o apps/; la campaña mide el producto sin cambios."
  fi
}

# Identidad del árbol medido: commit, estado, hash de lo que cambió bajo tests/ (el arnés mismo) y el host.
campaign_snapshot() {
  git rev-parse HEAD >"$RUN_DIR/commit.txt"
  git status --short >"$RUN_DIR/git-status.txt"
  git diff HEAD --binary -- packages/ apps/ | sha >"$RUN_DIR/product-tree.diff.sha256"
  git diff HEAD --binary -- tests/ | sha >"$RUN_DIR/tests-tree.diff.sha256"
  git ls-files --others --exclude-standard -- tests/ | LC_ALL=C "$(msys_tool sort)" | while IFS= read -r file; do printf '%s %s\n' "$(sha "$file")" "$file"; done >"$RUN_DIR/tests-untracked.sha256"
  node -e 'const os=require("node:os"); process.stdout.write(JSON.stringify({platform:process.platform,arch:process.arch,cpuCount:os.cpus().length,cpuModel:os.cpus()[0]?.model,totalMemBytes:os.totalmem(),node:process.version},null,2)+"\n")' >"$RUN_DIR/host.json"
}

# Un solo build empaquetado (VITE_E2E=1) para toda la campaña; los dist previos se restauran al salir.
campaign_build() {
  if [[ -d "$DIST_DIR" && ! -d "$RUN_DIR/dist-original" ]]; then
    cp -R "$DIST_DIR" "$RUN_DIR/dist-original"
    digest_dir "$RUN_DIR/dist-original" >"$RUN_DIR/dist-original.digest"
    digest_is_plausible "$(cat "$RUN_DIR/dist-original.digest")" || fail "el digest del dist original salió vacío o igual al de la entrada vacía: find/sort no son los de MSYS."
  fi
  if [[ -d "$DIST_DIR" && -d "$RUN_DIR/dist-original" ]]; then RESTORE_CLIENT_DIST=1; fi
  if [[ -d "$SHELL_DIST_DIR" && ! -d "$RUN_DIR/shell-dist-original" ]]; then cp -R "$SHELL_DIST_DIR" "$RUN_DIR/shell-dist-original"; fi
  if [[ -d "$SHELL_DIST_DIR" && -d "$RUN_DIR/shell-dist-original" ]]; then RESTORE_SHELL_DIST=1; fi
  if [[ "$RESTORE_CLIENT_DIST" -eq 0 ]]; then REMOVE_CLIENT_DIST=1; fi
  if [[ "$RESTORE_SHELL_DIST" -eq 0 ]]; then REMOVE_SHELL_DIST=1; fi
  log "Build único empaquetado para la campaña..."
  pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || fail "falló el build del shell."
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || fail "falló el build del cliente."
  digest_dir "$DIST_DIR" >"$RUN_DIR/client-dist.digest"
  digest_is_plausible "$(cat "$RUN_DIR/client-dist.digest")" || fail "el digest del dist del cliente salió vacío o igual al de la entrada vacía: find/sort no son los de MSYS o el dist está vacío."
  sha assets.lock.json >"$RUN_DIR/assets-lock.sha256"
  sha pnpm-lock.yaml >"$RUN_DIR/pnpm-lock.sha256"
  git diff HEAD --binary -- packages/ apps/ | sha >"$RUN_DIR/product-tree.after-build.diff.sha256"
  [[ "$(cat "$RUN_DIR/product-tree.diff.sha256")" == "$(cat "$RUN_DIR/product-tree.after-build.diff.sha256")" ]] || fail "el build modificó el árbol de fuentes de producto medido."
}

# Antes y después de cada unidad de medición: un evento de suspensión/reanudación la invalida.
SLEEP_BEFORE=""
guard_begin() {
  SLEEP_BEFORE=""
  if [[ "$SLEEP_DETECTION_OK" == "1" ]]; then
    SLEEP_BEFORE="$(sleep_wake_digest)" || sleep_detection_failed "antes de $1"
  fi
}
# Devuelve 1 solo con una suspensión confirmada; si la consulta falla queda la salvedad, no un «sin novedad».
guard_end() {
  local after=""
  if [[ "$SLEEP_DETECTION_OK" == "1" ]]; then
    after="$(sleep_wake_digest)" || { sleep_detection_failed "después de $1"; return 0; }
    if [[ "$SLEEP_DETECTION_OK" == "1" && "$after" != "$SLEEP_BEFORE" ]]; then
      record_invalid_run "$1" "sleep-wake-event-during-run"
      return 1
    fi
  fi
  return 0
}

# Windows: la prevención de suspensión tiene que seguir viva al final; si murió, la salvedad entra al resumen.
campaign_final_checks() {
  if [[ "$PLATFORM" == "windows" ]] && ! keep_awake_alive; then
    add_caveat "sleep-prevention-lost" "el powershell de prevención de suspensión murió durante la campaña: el equipo pudo suspenderse sin que se registre"
  fi
}

# Los reales entran solo por ANONLY_REAL_DOC_*; Node lee C:/..., no /c/...: se exporta la forma nativa.
# La ruta no se loguea. Uso: export_real_doc_native ANONLY_REAL_DOC_R3
export_real_doc_native() {
  local var="$1"
  if [[ "$PLATFORM" == "windows" ]] && readable_abs_file "${!var:-}"; then export "$var=$(to_native_path "${!var}")"; fi
}
