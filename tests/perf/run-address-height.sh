#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

# M-D1 (docs/roadmap/hardening/Confianza_1.0.x_Plan.md, Frente 4; ADR-212): cuánto tapa la regla de la
# altura de una dirección y cuánto deja a la vista. Un PDF digital sintético (una oración de prueba por
# página) se importa en la aplicación Electron empaquetada con el modelo real y la configuración por
# defecto. Dos repeticiones completas, una instancia fría de Electron por repetición, en serie. Corre en
# Windows nativo (Git Bash) y en macOS. Solo sintéticos: no usa ANONLY_REAL_DOC_*. No cambia producto: es un
# runner propio sobre el preámbulo común de las campañas (build único, producto limpio, suspensión).
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=support/ocr-pool-platform.sh
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_ADDRESS_HEIGHT_OUTPUT_DIR:-.measure/address-height/$(date -u +%Y%m%dT%H%M%SZ)}"
# shellcheck source=support/ocr-campaign-common.sh
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"

# ANONLY_ADDRESS_HEIGHT_SMOKE=1: una sola repetición.
SMOKE="${ANONLY_ADDRESS_HEIGHT_SMOKE:-0}"
if [[ "$SMOKE" != "0" ]]; then REPS=1; else REPS=2; fi

campaign_init
ANONLY_RUN_REPS="$REPS" ANONLY_RUN_SMOKE="$SMOKE" node -e '
const e = process.env;
process.stdout.write(JSON.stringify({
  smoke: e.ANONLY_RUN_SMOKE !== "0",
  repetitions: Number(e.ANONLY_RUN_REPS),
}, null, 2) + "\n");' >"$RUN_DIR/address-height-run.json"

campaign_preflight
campaign_snapshot
if [[ "$SMOKE" != "0" ]]; then log "Altura de dirección (HUMO): $REPS repetición."; else log "Altura de dirección: $REPS repeticiones."; fi
campaign_build

COMMIT="$(cat "$RUN_DIR/commit.txt")"
run_repetition() {
  local repetition="$1" id="rep-$1"
  log "Repetición $repetition"
  capture_pressure "before-$id"
  guard_begin "$id"
  if ANONLY_ADDRESS_HEIGHT=1 ANONLY_ADDRESS_HEIGHT_OUTPUT_DIR="$RUN_DIR" ANONLY_ADDRESS_HEIGHT_COMMIT="$COMMIT" \
    ANONLY_ADDRESS_HEIGHT_REPS="$REPS" ANONLY_ADDRESS_HEIGHT_REP="$repetition" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/address-height.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
    log "OK repetición $repetition"
  else
    log "FALLO repetición $repetition (queda en su JSON y en el resumen)"
    FAILED=$((FAILED + 1))
  fi
  capture_pressure "after-$id"
  guard_end "$id" || FAILED=$((FAILED + 1))
}
for ((repetition = 1; repetition <= REPS; repetition++)); do run_repetition "$repetition"; done

campaign_final_checks
summary_out="$(pnpm exec tsx tests/perf/support/summarizeAddressHeightCli.ts "$RUN_DIR")"
summary_status=$?
printf '%s\n' "$summary_out"
RESULT_LINE="$(printf '%s\n' "$summary_out" | tail -n 1)"
if [[ "$summary_status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi

log "Campaña terminada: $RUN_DIR; fallidas=$FAILED; $RESULT_LINE. Sin cambios de producto ni defaults."
exit "$((FAILED > 0))"
