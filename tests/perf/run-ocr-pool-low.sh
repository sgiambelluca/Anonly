#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

# Memoria del perfil Bajo (M-M1, ADR-194 §7): pico de RSS del árbol durante el OCR del corpus P2H
# (20 páginas A4 a 300 dpi nativos) con el perfil `low` tal como lo elige un usuario, es decir por el
# setting `performancePreset: "low"` y no por overrides sueltos. Tres corridas frías, en serie. Es la
# fase `pool-rss` del spec con el brazo `low`; `ANONLY_OCR_POOL_PHASE=low-memory
# ./tests/perf/run-ocr-pool.sh` llega acá. La fase `ultra` y las demás no cambian.
#
# Cada corrida comprueba antes de medir que la configuración efectiva es el perfil Bajo (los cuatro
# pools en 1 y `ocr.maxLiveImageBytes` sin enviar, 128 MiB). Si no coincide, la corrida es inválida:
# no se relaja la comprobación. Corre en Windows nativo (Git Bash), el banco que decide; en macOS solo
# sirve de humo. No usa documentos reales: P2H es sintético.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=support/ocr-pool-platform.sh
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_OCR_POOL_OUTPUT_DIR:-.measure/ocr-pool/$(date -u +%Y%m%dT%H%M%SZ)-low}"
# shellcheck source=support/ocr-campaign-common.sh
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"

PROFILE="P2H"
ARM="low"
# Humo (ANONLY_OCR_POOL_LOW_SMOKE=1): una sola corrida fría, para validar el circuito antes de la tanda.
SMOKE="${ANONLY_OCR_POOL_LOW_SMOKE:-0}"
ROUNDS=(0 1 2)
if [[ "$SMOKE" != "0" ]]; then ROUNDS=(0); fi

campaign_init
node -e 'const [smoke, rounds] = process.argv.slice(1); process.stdout.write(JSON.stringify({smoke: smoke !== "0", arm: "low", profile: "P2H", rounds: rounds.split(" ").map(Number)}, null, 2) + "\n")' "$SMOKE" "${ROUNDS[*]}" >"$RUN_DIR/ocr-pool-low-run.json"
campaign_preflight
campaign_snapshot
if [[ "$SMOKE" != "0" ]]; then log "Memoria del perfil Bajo (HUMO): corpus $PROFILE, una corrida."; else log "Memoria del perfil Bajo: corpus $PROFILE, tres corridas frías."; fi
campaign_build

run_one() {
  local round="$1"
  local id="memory-${ARM}-${PROFILE}-r${round}"
  local artifact="ocr-pool-pool-rss-${ARM}-${PROFILE}-r${round}.json"
  log "Corrida $id"
  capture_pressure "before-$id"
  guard_begin "$id"
  local status=0
  [[ ! -e "$RUN_DIR/$artifact" ]] || fail "el artefacto ya existe; no se sobrescribe: $id"
  if ANONLY_OCR_POOL_RUN="$id" ANONLY_OCR_POOL_PHASE="pool-rss" ANONLY_OCR_POOL_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ocr-pool.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
    log "OK $id"
  else
    status=$?
    log "FALLO $id"
    record_invalid_run "$id" "playwright-failure"
  fi
  capture_pressure "after-$id"
  guard_end "$id" || status=1
  if [[ "$status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi
}

for round in "${ROUNDS[@]}"; do run_one "$round"; done

campaign_final_checks
summary_out="$(pnpm exec tsx tests/perf/support/summarizeOcrPoolLowCli.ts "$RUN_DIR")"
summary_status=$?
printf '%s\n' "$summary_out"
RESULT_LINE="$(printf '%s\n' "$summary_out" | tail -n 1)"
if [[ "$summary_status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi

log "Campaña terminada: $RUN_DIR; fallidas=$FAILED; $RESULT_LINE. Sin cambios de producto ni defaults."
exit "$((FAILED > 0))"
