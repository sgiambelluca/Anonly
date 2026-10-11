#!/usr/bin/env bash
# M-V1, 36 runs, cold original/export/cold reimport; outputs contain metadata only.
# Reuse ANONLY_VALIDATE_SAMPLE_OUTPUT_DIR to resume unchanged product/harness/build.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_VALIDATE_SAMPLE_OUTPUT_DIR:-.measure/validate-sample/$(date -u +%Y%m%dT%H%M%SZ)}"
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"
LIMIT="${ANONLY_VALIDATE_SAMPLE_LIMIT:-0}"
ONLY="${ANONLY_VALIDATE_SAMPLE_ONLY:-}"
IDENTITY_FILES=(commit.txt product-tree.diff.sha256 product-tree.identity.sha256 tests-tree.diff.sha256 tests-untracked.sha256)
REQUIRED_IDENTITY_FILES=(commit.txt product-tree.diff.sha256 tests-tree.diff.sha256 tests-untracked.sha256)
FIRST_DIR="$RUN_DIR/first"
RESUMING=0
if [[ -e "$RUN_DIR" ]]; then
  RESUMING=1
  [[ -d "$FIRST_DIR" && -f "$RUN_DIR/commit.txt" && -f "$RUN_DIR/client-dist.digest" ]] || { echo "La salida existe pero no es una campaña M-V1 reanudable." >&2; exit 1; }
  trap campaign_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  rm -f "$RUN_DIR/product-tree.identity.sha256" "$RUN_DIR/product-untracked.sha256" "$RUN_DIR/product-uncommitted-status.txt"
else
  campaign_init
fi
for doc in R1 R4; do export_real_doc_native "ANONLY_REAL_DOC_$doc"; done
campaign_preflight
campaign_snapshot
for name in "${REQUIRED_IDENTITY_FILES[@]}"; do
  [[ -f "$RUN_DIR/$name" ]] || fail "snapshot incompleto: $name."
  if [[ "$RESUMING" == "1" ]]; then [[ -f "$FIRST_DIR/$name" ]] || fail "identidad inicial incompleta: $name."; fi
done
if [[ "$RESUMING" == "1" ]]; then
  for name in "${IDENTITY_FILES[@]}"; do
    first_exists=0; now_exists=0
    [[ -f "$FIRST_DIR/$name" ]] && first_exists=1
    [[ -f "$RUN_DIR/$name" ]] && now_exists=1
    if [[ "$first_exists" != "$now_exists" ]] || { [[ "$now_exists" == "1" ]] && ! cmp -s "$RUN_DIR/$name" "$FIRST_DIR/$name"; }; then
      fail "$name cambió: no se mezclan árboles ni arneses entre tandas."
    fi
  done
else
  mkdir -p "$FIRST_DIR"
  for name in "${IDENTITY_FILES[@]}"; do
    if [[ -f "$RUN_DIR/$name" ]]; then cp "$RUN_DIR/$name" "$FIRST_DIR/$name" || fail "no se pudo preservar $name."; fi
  done
fi
campaign_build
digest_dir "$SHELL_DIST_DIR" >"$RUN_DIR/shell-dist.digest"
for name in client-dist.digest shell-dist.digest assets-lock.sha256 pnpm-lock.sha256; do
  [[ -s "$RUN_DIR/$name" ]] || fail "snapshot de build incompleto: $name."
  if [[ ! -f "$FIRST_DIR/$name" ]]; then
    [[ "$RESUMING" == "0" ]] || fail "snapshot inicial de build incompleto: $name."
    cp "$RUN_DIR/$name" "$FIRST_DIR/$name" || fail "no se pudo preservar $name.";
  elif ! cmp -s "$RUN_DIR/$name" "$FIRST_DIR/$name"; then fail "$name difiere de la primera tanda."; fi
done
ID="tanda-$(date -u +%Y%m%dT%H%M%SZ)-$$"
log "M-V1: tope=$LIMIT; filtro activo=$([[ -n "$ONLY" ]] && echo sí || echo no); tanda=$ID."
capture_pressure "before-$ID"
[[ ! -e "$RUN_DIR/batch-$ID.json" ]] || fail "identidad de tanda repetida."
printf '{"schema":1,"batchId":"%s","state":"started"}\n' "$ID" >"$RUN_DIR/batch-$ID.json" || fail "no se pudo iniciar sello de tanda."
guard_begin "$ID"
mv1_detection_start=false
[[ "${SLEEP_DETECTION_OK:-0}" == "1" ]] && mv1_detection_start=true
if env ANONLY_VALIDATE_SAMPLE_V1=1 ANONLY_VALIDATE_SAMPLE_OUTPUT_DIR="$RUN_DIR" \
  ANONLY_VALIDATE_SAMPLE_BATCH_ID="$ID" ANONLY_VALIDATE_SAMPLE_LIMIT="$LIMIT" ANONLY_VALIDATE_SAMPLE_ONLY="$ONLY" \
  pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/validate-sample-v1.spec.ts \
    --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
  log "OK $ID"
else
  log "FALLO $ID; resultados parciales y fallas quedan registrados sin contenido."
  FAILED=$((FAILED + 1))
fi
capture_pressure "after-$ID"
# The common guard can return success when detection became unavailable. M-V1
# requires positive confirmation at both boundaries, independently of best-effort
# prevention caveats. Persist only booleans and fixed neutral reasons, no digest.
mv1_guard_status=0
if guard_end "$ID"; then :; else mv1_guard_status=$?; fi
mv1_detection_end=false
[[ "${SLEEP_DETECTION_OK:-0}" == "1" ]] && mv1_detection_end=true
mv1_wake_observed=false
[[ "$mv1_guard_status" == "1" ]] && mv1_wake_observed=true
batch_state=finished
mv1_invalid_reason=null
if [[ "$mv1_detection_start" != "true" || "$mv1_detection_end" != "true" ]]; then
  batch_state=invalid; mv1_invalid_reason='"sleep-detection-unconfirmed"'
elif [[ "$mv1_wake_observed" == "true" ]]; then
  batch_state=invalid; mv1_invalid_reason='"sleep-wake-event-during-run"'
elif [[ "$mv1_guard_status" != "0" ]]; then
  batch_state=invalid; mv1_invalid_reason='"batch-guard-not-sealed"'
fi
if [[ "$batch_state" == "invalid" ]]; then FAILED=$((FAILED + 1)); fi
printf '{"schema":1,"batchId":"%s","state":"%s","detectionConfirmedAtStart":%s,"detectionConfirmedAtEnd":%s,"sleepWakeEventObserved":%s,"invalidReason":%s}\n' \
  "$ID" "$batch_state" "$mv1_detection_start" "$mv1_detection_end" "$mv1_wake_observed" "$mv1_invalid_reason" \
  >"$RUN_DIR/batch-$ID.json.tmp" || fail "no se pudo escribir sello terminal de tanda."
mv "$RUN_DIR/batch-$ID.json.tmp" "$RUN_DIR/batch-$ID.json" || fail "no se pudo preservar sello terminal de tanda."
campaign_final_checks
pnpm exec tsx tests/perf/support/summarizeValidateSampleCli.ts "$RUN_DIR"
summary_status=$?
if [[ "$summary_status" -gt 1 ]]; then FAILED=$((FAILED + 1)); fi
if [[ "$summary_status" == "1" && "$LIMIT" == "0" && -z "$ONLY" ]]; then FAILED=$((FAILED + 1)); fi
log "Tanda terminada: $RUN_DIR; fallidas=$FAILED."
exit "$((FAILED > 0))"
