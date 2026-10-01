#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

# Fase 2 (tiempo y memoria) de la campaña de DPI descendente:
# docs/roadmap/OCR_DPI_Descendente_Campana_Plan.md §5.2. Es la fase `ultra` de run-ocr-pool.sh con una
# dimensión de DPI (`ANONLY_OCR_POOL_PHASE=ultra-dpi ./tests/perf/run-ocr-pool.sh` llega acá). La fase
# `ultra` y las demás no cambian. Corre en Windows nativo (Git Bash), el banco que decide; en macOS
# solo sirve de humo. Una instancia fría por corrida, serial.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=support/ocr-pool-platform.sh
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_OCR_POOL_OUTPUT_DIR:-.measure/ocr-pool/$(date -u +%Y%m%dT%H%M%SZ)-dpi}"
# shellcheck source=support/ocr-campaign-common.sh
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"

SMOKE="${ANONLY_OCR_POOL_DPI_SMOKE:-0}"
if [[ "$SMOKE" != "0" ]]; then
  # Humo: una corrida de tiempo por combinación chica (2 reconocedores a 300 y a 200 dpi sobre P2H).
  # =2 agrega una de memoria (RSS natural) y una de cancelación de la primera combinación.
  POOLS="${ANONLY_OCR_POOL_DPI_POOLS:-2}"
  DPIS="${ANONLY_OCR_POOL_DPI_ARMS:-300 200}"
  PROFILES_REQUESTED="${ANONLY_OCR_POOL_DPI_PROFILES:-P2H}"
else
  POOLS="${ANONLY_OCR_POOL_DPI_POOLS:-2 4 6}"
  DPIS="${ANONLY_OCR_POOL_DPI_ARMS:-300 250 200}"
  PROFILES_REQUESTED="${ANONLY_OCR_POOL_DPI_PROFILES:-P2H SR R3}"
fi

campaign_init
for pool in $POOLS; do
  case "$pool" in 1 | 2 | 3 | 4 | 6) ;; *) fail "reconocedores no soportados: $pool (con 128 MiB: 1, 2, 3, 4 o 6)." ;; esac
done
for dpi in $DPIS; do
  [[ "$dpi" =~ ^[0-9]{2,3}$ ]] || fail "DPI inválido: $dpi"
done
case " $DPIS " in *" 300 "*) ;; *) fail "la lista de DPI tiene que incluir 300: es el control y la referencia de las huellas." ;; esac
case " $POOLS " in *" 2 "*) ;; *) fail "la lista de reconocedores tiene que incluir 2: las huellas se comparan contra dpi 300 con dos reconocedores." ;; esac
for profile in $PROFILES_REQUESTED; do
  case "$profile" in P2H | SR | R3) ;; *) fail "corpus desconocido: $profile" ;; esac
done

# R3 (real a 300 dpi) es opcional: sin la variable, o sin una ruta absoluta legible, se saltea y queda dicho.
INCLUDED=()
NOTES_JSON=""
for profile in $PROFILES_REQUESTED; do
  if [[ "$profile" == "R3" ]]; then
    if readable_abs_file "${ANONLY_REAL_DOC_R3:-}"; then
      export_real_doc_native ANONLY_REAL_DOC_R3
      INCLUDED+=("R3")
    else
      if [[ -z "${ANONLY_REAL_DOC_R3:-}" ]]; then note="ANONLY_REAL_DOC_R3 no definido: la fase corrió sin R3 (SR ocupa su lugar)"; else note="ANONLY_REAL_DOC_R3 definido pero no es una ruta absoluta legible: la fase corrió sin R3"; fi
      NOTES_JSON="${NOTES_JSON:+$NOTES_JSON,}{\"profile\":\"R3\",\"note\":\"$note\"}"
      log "$note."
    fi
  else
    INCLUDED+=("$profile")
  fi
done
[[ "${#INCLUDED[@]}" -gt 0 ]] || fail "no queda ningún corpus para medir."
ANONLY_RUN_PROFILES="${INCLUDED[*]}" ANONLY_RUN_ARMS="$POOLS" ANONLY_RUN_DPIS="$DPIS" ANONLY_RUN_NOTES="$NOTES_JSON" ANONLY_RUN_SMOKE="$SMOKE" node -e '
const e = process.env;
process.stdout.write(JSON.stringify({
  smoke: e.ANONLY_RUN_SMOKE !== "0",
  profiles: e.ANONLY_RUN_PROFILES.split(" "),
  arms: e.ANONLY_RUN_ARMS.split(" "),
  dpis: e.ANONLY_RUN_DPIS.split(" ").map(Number),
  profileNotes: JSON.parse(`[${e.ANONLY_RUN_NOTES}]`),
}, null, 2) + "\n");' >"$RUN_DIR/ocr-pool-dpi-run.json"
[[ "${ANONLY_OCR_POOL_DPI_DRY_RUN:-0}" != "1" ]] || { log "Dry run: se escribió ocr-pool-dpi-run.json y no se midió."; exit 0; }

campaign_preflight
campaign_snapshot
if [[ "$SMOKE" != "0" ]]; then log "Fase 2 de DPI descendente (HUMO=$SMOKE): corpus ${INCLUDED[*]}; reconocedores $POOLS; DPI $DPIS."; else log "Fase 2 de DPI descendente: corpus ${INCLUDED[*]}; reconocedores $POOLS; DPI $DPIS."; fi
campaign_build

# Una cancelación que solo excede el SLA se conserva y el resumen la marca; cualquier otro fallo invalida.
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
  local kind="$1" pool="$2" dpi="$3" profile="$4" round="$5"
  local id="${kind}-${pool}-${profile}-d${dpi}-r${round}"
  log "Corrida $id"
  capture_pressure "before-$id"
  guard_begin "$id"
  local status=0 spec_phase="ultra-dpi" artifact="ocr-pool-${id}.json"
  # La memoria usa el RSS natural del árbol (fase pool-rss del spec), sin CDP ni barrera.
  if [[ "$kind" == "memory" ]]; then
    spec_phase="pool-rss"
    artifact="ocr-pool-pool-rss-${pool}-${profile}-d${dpi}-r${round}.json"
  fi
  [[ ! -e "$RUN_DIR/$artifact" ]] || fail "el artefacto ya existe; no se sobrescribe: $id"
  if ANONLY_OCR_POOL_RUN="$id" ANONLY_OCR_POOL_PHASE="$spec_phase" ANONLY_OCR_POOL_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ocr-pool.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
    log "OK $id"
  else
    status=$?
    log "FALLO $id"
    if [[ "$kind" == "cancel" ]] && cancel_failed_only_on_sla "$RUN_DIR/$artifact"; then
      log "Cancelación $id fuera de SLA: se conserva, el resumen la marca."
    else
      record_invalid_run "$id" "playwright-failure"
    fi
  fi
  capture_pressure "after-$id"
  guard_end "$id" || status=1
  if [[ "$status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi
}

# Combinaciones reconocedores x DPI, intercaladas entre rondas: adelante, al revés y rotadas.
COMBOS=()
for pool in $POOLS; do for dpi in $DPIS; do COMBOS+=("$pool:$dpi"); done; done
combo_at() {
  local round="$1" i="$2" n="${#COMBOS[@]}" index
  case "$round" in
    0) index="$i" ;;
    1) index=$((n - 1 - i)) ;;
    *) index=$(((i + n / 2) % n)) ;;
  esac
  printf '%s' "${COMBOS[$index]}"
}

ROUNDS=(0 1 2)
if [[ "$SMOKE" != "0" ]]; then ROUNDS=(0); fi
for profile in "${INCLUDED[@]}"; do
  for round in "${ROUNDS[@]}"; do
    for ((i = 0; i < ${#COMBOS[@]}; i++)); do
      combo="$(combo_at "$round" "$i")"
      run_one time "${combo%%:*}" "${combo##*:}" "$profile" "$round"
    done
  done
done
if [[ "$SMOKE" == "0" ]]; then
  for profile in "${INCLUDED[@]}"; do
    for round in 0 1 2; do
      for ((i = 0; i < ${#COMBOS[@]}; i++)); do
        combo="$(combo_at "$round" "$i")"
        run_one memory "${combo%%:*}" "${combo##*:}" "$profile" "$round"
      done
    done
  done
  for profile in "${INCLUDED[@]}"; do
    for combo in "${COMBOS[@]}"; do run_one cancel "${combo%%:*}" "${combo##*:}" "$profile" 0; done
  done
elif [[ "$SMOKE" == "2" ]]; then
  first="${COMBOS[0]}"
  run_one memory "${first%%:*}" "${first##*:}" "${INCLUDED[0]}" 0
  run_one cancel "${first%%:*}" "${first##*:}" "${INCLUDED[0]}" 0
fi

campaign_final_checks
summary_out="$(pnpm exec tsx tests/perf/support/summarizeOcrPoolDpiCli.ts "$RUN_DIR" "$RUN_DIR")"
summary_status=$?
printf '%s\n' "$summary_out"
RESULT_LINE="$(printf '%s\n' "$summary_out" | tail -n 1)"
# Humo: el resumen marca incompleta la tanda a propósito (faltan rondas); el humo se juzga por sus corridas.
if [[ "$SMOKE" == "0" && "$summary_status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi
if [[ "$summary_status" -ge 2 ]]; then FAILED=$((FAILED + 1)); fi

log "Campaña terminada: $RUN_DIR; fallidas=$FAILED; $RESULT_LINE. Sin cambios de producto ni defaults."
exit "$((FAILED > 0))"
