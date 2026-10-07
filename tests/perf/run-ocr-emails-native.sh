#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

# M-E1 (docs/roadmap/hardening/Confianza_1.0.x_Plan.md, Frente 2): emails en escaneos cuya resolución
# NATIVA es baja. Los sintéticos de la campaña de DPI descendente (SR, S12, S10, S8) se rasterizan a 300
# (control), 200 y 150 dpi nativos y se leen con la configuración por defecto: NO se fuerza `ocr.dpi`.
# Dos repeticiones por celda, una instancia fría de Electron por celda, en serie. Corre en Windows nativo
# (Git Bash), el banco que decide; en macOS solo sirve de humo. Solo sintéticos: no usa ANONLY_REAL_DOC_*.
# No cambia producto ni las demás campañas: es un runner propio sobre el preámbulo común.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=support/ocr-pool-platform.sh
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_OCR_EMAILS_NATIVE_OUTPUT_DIR:-.measure/ocr-emails-native/$(date -u +%Y%m%dT%H%M%SZ)}"
# shellcheck source=support/ocr-campaign-common.sh
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"

DEFAULT_CORPORA="SR S12 S10 S8"
# M-E2: los textos con degradación de fotocopia (SD1 a SD5). Opt-in con ANONLY_OCR_EMAILS_NATIVE_SET=sd (o
# nombrándolos en ANONLY_OCR_EMAILS_NATIVE_CORPUS); sin eso el comportamiento es el de M-E1.
SD_CORPORA="SD1 SD2 SD3 SD4 SD5"
ALL_CORPORA="$DEFAULT_CORPORA $SD_CORPORA"
case "${ANONLY_OCR_EMAILS_NATIVE_SET:-}" in
  "") SET_CORPORA="$DEFAULT_CORPORA" ;;
  sd) SET_CORPORA="$SD_CORPORA" ;;
  *) echo "ANONLY_OCR_EMAILS_NATIVE_SET desconocido: ${ANONLY_OCR_EMAILS_NATIVE_SET} (vacío o sd)" >&2; exit 1 ;;
esac
# Humo (ANONLY_OCR_EMAILS_NATIVE_SMOKE=1): un corpus, 300 y 150 dpi, una repetición.
SMOKE="${ANONLY_OCR_EMAILS_NATIVE_SMOKE:-0}"
if [[ "$SMOKE" != "0" ]]; then
  # El humo de M-E1 es S10; el de M-E2, SD1.
  if [[ -n "${ANONLY_OCR_EMAILS_NATIVE_SET:-}" ]]; then SMOKE_CORPUS="${SET_CORPORA%% *}"; else SMOKE_CORPUS="S10"; fi
  CORPORA="${ANONLY_OCR_EMAILS_NATIVE_CORPUS:-$SMOKE_CORPUS}"
  DPIS="${ANONLY_OCR_EMAILS_NATIVE_DPIS:-300 150}"
  REPS=1
else
  CORPORA="${ANONLY_OCR_EMAILS_NATIVE_CORPUS:-$SET_CORPORA}"
  DPIS="${ANONLY_OCR_EMAILS_NATIVE_DPIS:-300 200 150}"
  REPS=2
fi

campaign_init
for corpus in $CORPORA; do
  case " $ALL_CORPORA " in *" $corpus "*) ;; *) fail "corpus desconocido: $corpus (solo sintéticos: $ALL_CORPORA)" ;; esac
done
for dpi in $DPIS; do
  [[ "$dpi" =~ ^[0-9]{2,3}$ ]] || fail "DPI nativo inválido: $dpi"
done
ANONLY_RUN_CORPORA="$CORPORA" ANONLY_RUN_DPIS="$DPIS" ANONLY_RUN_REPS="$REPS" ANONLY_RUN_SMOKE="$SMOKE" node -e '
const e = process.env;
process.stdout.write(JSON.stringify({
  smoke: e.ANONLY_RUN_SMOKE !== "0",
  corpora: e.ANONLY_RUN_CORPORA.split(" "),
  dpis: e.ANONLY_RUN_DPIS.split(" ").map(Number),
  repetitions: Number(e.ANONLY_RUN_REPS),
}, null, 2) + "\n");' >"$RUN_DIR/ocr-emails-native-run.json"

campaign_preflight
campaign_snapshot
if [[ "$SMOKE" != "0" ]]; then log "Emails nativos (HUMO): corpus $CORPORA; DPI nativos $DPIS; $REPS repetición."; else log "Emails nativos: corpus $CORPORA; DPI nativos $DPIS; $REPS repeticiones."; fi
campaign_build

run_corpus() {
  local corpus="$1" id="corpus-$1"
  log "Corpus $corpus"
  capture_pressure "before-$id"
  guard_begin "$id"
  if ANONLY_OCR_EMAILS_NATIVE=1 ANONLY_OCR_EMAILS_NATIVE_OUTPUT_DIR="$RUN_DIR" ANONLY_OCR_EMAILS_NATIVE_CORPUS="$corpus" \
    ANONLY_OCR_EMAILS_NATIVE_DPIS="$DPIS" ANONLY_OCR_EMAILS_NATIVE_REPS="$REPS" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ocr-emails-native.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
    log "OK $corpus"
  else
    log "FALLO $corpus (las celdas inválidas quedan en sus JSON y en el resumen)"
    FAILED=$((FAILED + 1))
  fi
  capture_pressure "after-$id"
  guard_end "$id" || FAILED=$((FAILED + 1))
}
for corpus in $CORPORA; do run_corpus "$corpus"; done

campaign_final_checks
summary_out="$(pnpm exec tsx tests/perf/support/summarizeOcrEmailsNativeCli.ts "$RUN_DIR")"
summary_status=$?
printf '%s\n' "$summary_out"
RESULT_LINE="$(printf '%s\n' "$summary_out" | tail -n 1)"
if [[ "$summary_status" -ne 0 ]]; then FAILED=$((FAILED + 1)); fi

log "Campaña terminada: $RUN_DIR; fallidas=$FAILED; $RESULT_LINE. Sin cambios de producto ni defaults."
exit "$((FAILED > 0))"
