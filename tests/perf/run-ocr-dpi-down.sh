#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

# Fase 1 (calidad) de la campaña de DPI descendente:
# docs/roadmap/OCR_DPI_Descendente_Campana_Plan.md §5.1. Corre en Windows nativo (Git Bash), que es
# el banco que decide; en macOS solo sirve de humo. Una instancia fría de Electron por celda.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=support/ocr-pool-platform.sh
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_OCR_DPI_DOWN_OUTPUT_DIR:-.measure/ocr-dpi-down/$(date -u +%Y%m%dT%H%M%SZ)}"
# shellcheck source=support/ocr-campaign-common.sh
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"

SMOKE="${ANONLY_OCR_DPI_DOWN_SMOKE:-0}"
ALL_CORPORA="S12 S10 S8 S6 SD1 SD2 SD3 SD4 SD5 SE SR R2 R3"
if [[ "$SMOKE" != "0" ]]; then
  # Humo: un corpus y dos brazos. Sirve para comprobar que arranca, aplica el DPI pedido y escribe sus archivos.
  CORPORA_REQUESTED="${ANONLY_OCR_DPI_DOWN_CORPUS:-S10}"
  ARMS="${ANONLY_OCR_DPI_DOWN_ARMS:-300 150}"
else
  CORPORA_REQUESTED="${ANONLY_OCR_DPI_DOWN_CORPUS:-$ALL_CORPORA}"
  ARMS="${ANONLY_OCR_DPI_DOWN_ARMS:-300 250 200 150}"
fi
# Umbral de cobertura (criterio 2): lo fija el humano. Se pasa crudo; un valor inválido no aborta, el
# agregador lo trata como umbral ausente y lo deja como salvedad (el criterio 2 queda indeterminado).
MIN_COVERAGE="${ANONLY_OCR_DPI_DOWN_MIN_COVERAGE:-}"

campaign_init
for corpus in $CORPORA_REQUESTED; do
  case " $ALL_CORPORA " in *" $corpus "*) ;; *) fail "corpus desconocido: $corpus" ;; esac
done
for arm in $ARMS; do
  [[ "$arm" =~ ^[0-9]+$ ]] || fail "brazo de DPI inválido: $arm"
done

# Reales opcionales: sin la variable (o sin una ruta absoluta legible) se saltean y queda dicho. La ruta no se loguea.
INCLUDED=()
SKIPPED_JSON=""
for corpus in $CORPORA_REQUESTED; do
  case "$corpus" in
    R2 | R3)
      var="ANONLY_REAL_DOC_$corpus"
      if readable_abs_file "${!var:-}"; then
        export_real_doc_native "$var"
        INCLUDED+=("$corpus")
      else
        if [[ -z "${!var:-}" ]]; then reason="$var no definido"; else reason="$var definido pero no es una ruta absoluta legible"; fi
        SKIPPED_JSON="${SKIPPED_JSON:+$SKIPPED_JSON,}{\"corpus\":\"$corpus\",\"reason\":\"$reason\"}"
        log "Corpus $corpus saltado: $reason."
      fi
      ;;
    *) INCLUDED+=("$corpus") ;;
  esac
done
[[ "${#INCLUDED[@]}" -gt 0 ]] || fail "no queda ningún corpus para medir."
# R2 es obligatorio para una matriz completa (plan §6.1). Sin él la matriz corre horas para terminar
# `parcial`: se corta al inicio, salvo que se pida explícitamente seguir.
R2_INCLUDED=0
for corpus in "${INCLUDED[@]}"; do [[ "$corpus" == "R2" ]] && R2_INCLUDED=1; done
if [[ "$R2_INCLUDED" -eq 0 && "$SMOKE" == "0" ]]; then
  case " $CORPORA_REQUESTED " in
    *" R2 "*)
      if [[ "${ANONLY_OCR_DPI_DOWN_ALLOW_PARTIAL:-0}" == "1" ]]; then
        log "############################################################"
        log "AVISO: SIN R2. La matriz saldrá PARCIAL: ningún brazo emitirá «pasa»."
        log "############################################################"
        add_caveat "matriz-parcial-permitida" "se corrió sin R2 (ANONLY_OCR_DPI_DOWN_ALLOW_PARTIAL=1): todos los brazos salen parcial"
      else
        fail "falta R2 (ANONLY_REAL_DOC_R2): sin él la matriz sale parcial y ningún brazo puede pasar. Definí la variable o, si querés correr igual, ANONLY_OCR_DPI_DOWN_ALLOW_PARTIAL=1."
      fi
      ;;
    *) log "AVISO: R2 no está entre los corpus pedidos: la matriz saldrá PARCIAL (ningún brazo emitirá «pasa»)." ;;
  esac
fi
# Los valores van por entorno, no por argumentos posicionales (MSYS convierte rutas y descarta vacíos).
ANONLY_RUN_CORPORA="${INCLUDED[*]}" ANONLY_RUN_ARMS="$ARMS" ANONLY_RUN_SKIPPED="$SKIPPED_JSON" \
  ANONLY_RUN_MIN_COVERAGE="$MIN_COVERAGE" ANONLY_RUN_SMOKE="$SMOKE" node -e '
const e = process.env;
process.stdout.write(JSON.stringify({
  smoke: e.ANONLY_RUN_SMOKE !== "0",
  corpora: e.ANONLY_RUN_CORPORA.split(" "),
  arms: e.ANONLY_RUN_ARMS.split(" ").map(Number),
  skippedCorpora: JSON.parse(`[${e.ANONLY_RUN_SKIPPED}]`),
  minCoverageRaw: e.ANONLY_RUN_MIN_COVERAGE === "" ? null : e.ANONLY_RUN_MIN_COVERAGE,
}, null, 2) + "\n");' >"$RUN_DIR/ocr-dpi-down-run.json"
[[ "${ANONLY_OCR_DPI_DOWN_DRY_RUN:-0}" != "1" ]] || { log "Dry run: se escribió ocr-dpi-down-run.json y no se midió."; exit 0; }

campaign_preflight
campaign_snapshot
if [[ "$SMOKE" != "0" ]]; then log "Fase 1 de DPI descendente (HUMO): corpus ${INCLUDED[*]}; brazos $ARMS."; else log "Fase 1 de DPI descendente: corpus ${INCLUDED[*]}; brazos $ARMS."; fi
campaign_build

run_corpus() {
  local corpus="$1" id="corpus-$1"
  log "Corpus $corpus"
  capture_pressure "before-$id"
  guard_begin "$id"
  if ANONLY_OCR_DPI_DOWN=1 ANONLY_OCR_DPI_DOWN_OUTPUT_DIR="$RUN_DIR" ANONLY_OCR_DPI_DOWN_CORPUS="$corpus" ANONLY_OCR_DPI_DOWN_ARMS="$ARMS" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ocr-dpi-down.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
    log "OK $corpus"
  else
    log "FALLO $corpus (las celdas inválidas quedan en sus JSON y en el resumen)"
    FAILED=$((FAILED + 1))
  fi
  capture_pressure "after-$id"
  guard_end "$id" || FAILED=$((FAILED + 1))
}
for corpus in "${INCLUDED[@]}"; do run_corpus "$corpus"; done

campaign_final_checks
summary_out="$(ANONLY_OCR_DPI_DOWN_MIN_COVERAGE="$MIN_COVERAGE" pnpm exec tsx tests/perf/support/summarizeOcrDpiDownCli.ts "$RUN_DIR" "$RUN_DIR")"
summary_status=$?
printf '%s\n' "$summary_out"
RESULT_LINE="$(printf '%s\n' "$summary_out" | tail -n 1)"
if [[ "$summary_status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi

log "Campaña terminada: $RUN_DIR; fallidas=$FAILED; $RESULT_LINE. Sin cambios de producto ni defaults."
exit "$((FAILED > 0))"
