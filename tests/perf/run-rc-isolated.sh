#!/usr/bin/env bash
# ADR-218. Explicit source mode; product sources untouched; one serial invocation.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_RC_OUTPUT_DIR:-.measure/rc-isolated/$(date -u +%Y%m%dT%H%M%SZ)}"
MODE="${ANONLY_RC_MODE:-smoke}"
SOURCE_MODE="${ANONLY_RC_SOURCE_MODE:-experimental}"
M3_REFERENCE="${ANONLY_RC_M3_REFERENCE_DIR:-.measure/osd-verdict/campana-m-o3}"
[[ "$MODE" == "smoke" || "$MODE" == "cost" ]] || { echo "RC modo inválido." >&2; exit 1; }
[[ "$SOURCE_MODE" == "experimental" || "$SOURCE_MODE" == "adopted" ]] || { echo "RC source mode inválido." >&2; exit 1; }
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"
# This stage deliberately does not reuse another campaign's dist originals.
# Fixed repository targets are checked before the inherited restoration code.
[[ "$(pwd)" == "$ROOT_DIR" && "$DIST_DIR" == "apps/react-client/dist" && "$SHELL_DIST_DIR" == "apps/desktop-shell/dist" ]] || exit 1
RESUMING=0
if [[ -e "$RUN_DIR" ]]; then
  RESUMING=1
  [[ -f "$RUN_DIR/build-identity.json" && -d "$RUN_DIR/first" ]] || { echo "RC salida no reanudable." >&2; exit 1; }
  trap campaign_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  RESTORE_CLIENT_DIST=1; RESTORE_SHELL_DIST=1
else campaign_init; fi
rc_cleanup() {
  local exit_status=$?
  if [[ -f "$RUN_DIR/build-identity.json" ]]; then
    if pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" restore; then
      RESTORE_CLIENT_DIST=0; RESTORE_SHELL_DIST=0
    else log "RC requiere restauración de artefactos."; exit_status=1; fi
  fi
  (exit "$exit_status")
  campaign_cleanup
}
trap rc_cleanup EXIT
export_real_doc_native ANONLY_REAL_DOC_R1
campaign_preflight
pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" preflight "$SOURCE_MODE" || fail "RC source mode does not match the exact product predicate."
campaign_snapshot
IDENTITY_FILES=(commit.txt product-tree.diff.sha256 tests-tree.diff.sha256 tests-untracked.sha256 product-tree.identity.sha256 source-mode.txt normal-renderer.sha256)
if [[ "$RESUMING" == "1" ]]; then
  [[ -f "$RUN_DIR/source-mode.txt" && -f "$RUN_DIR/first/source-mode.txt" && -f "$RUN_DIR/normal-renderer.sha256" && -f "$RUN_DIR/first/normal-renderer.sha256" && "$(cat "$RUN_DIR/source-mode.txt")" == "$SOURCE_MODE" ]] || fail "RC source mode/renderer de reanudación incompleto o cambiado."
  for name in "${IDENTITY_FILES[@]}"; do
    if [[ -f "$RUN_DIR/$name" || -f "$RUN_DIR/first/$name" ]]; then cmp -s "$RUN_DIR/$name" "$RUN_DIR/first/$name" || fail "RC identidad cambió."; fi
  done
  [[ -d "$RUN_DIR/dist-original" && -d "$RUN_DIR/shell-dist-original" ]] || fail "RC originales incompletos."
  pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" shell || fail "RC shell congelado no disponible."
else
  mkdir -p "$RUN_DIR/first"
  printf '%s\n' "$SOURCE_MODE" >"$RUN_DIR/source-mode.txt"
  for name in "${IDENTITY_FILES[@]}"; do [[ ! -f "$RUN_DIR/$name" ]] || cp "$RUN_DIR/$name" "$RUN_DIR/first/$name" || fail "RC snapshot incompleto."; done
  campaign_build
  pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" normal || fail "RC renderer normal no identificado."
  cp "$RUN_DIR/normal-renderer.sha256" "$RUN_DIR/first/normal-renderer.sha256" || fail "RC renderer normal no quedó en identidad inicial."
  cp -R "$SHELL_DIST_DIR" "$RUN_DIR/frozen-shell" || fail "RC shell freeze falló."
  digest_dir "$SHELL_DIST_DIR" >"$RUN_DIR/shell-dist-original-current.digest"
  digest_dir "$RUN_DIR/shell-dist-original" >"$RUN_DIR/shell-dist-original.digest"
  mkdir -p "$RUN_DIR/arms"
  for arm in A RC; do
    log "RC: construyendo artefacto $arm."
    ANONLY_RC_SOURCE_MODE="$SOURCE_MODE" VITE_E2E=1 pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" arm "$arm" >>"$RUN_DIR/build.log" 2>&1 || fail "RC build aislado falló."
    cp -R "$DIST_DIR" "$RUN_DIR/arms/$arm" || fail "RC freeze de artefacto falló."
  done
  pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" "$SOURCE_MODE" || fail "RC identidad de builds incompleta."
  sha assets.lock.json >"$RUN_DIR/assets-lock.sha256"
  sha pnpm-lock.yaml >"$RUN_DIR/pnpm-lock.sha256"
  for name in assets-lock.sha256 pnpm-lock.sha256; do cp "$RUN_DIR/$name" "$RUN_DIR/first/$name" || fail "RC locks incompletos."; done
fi
[[ "$(git diff HEAD --binary -- packages/ apps/ | sha)" == "$(cat "$RUN_DIR/product-tree.diff.sha256")" ]] || fail "RC fuentes de producto cambiaron."
for name in assets-lock.sha256 pnpm-lock.sha256; do
  file="${name%.sha256}"; file="${file/assets-lock/assets.lock.json}"; file="${file/pnpm-lock/pnpm-lock.yaml}"
  [[ "$(sha "$file")" == "$(cat "$RUN_DIR/first/$name")" ]] || fail "RC lock cambió."
done
ID="tanda-$(date -u +%Y%m%dT%H%M%SZ)-$$"
pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" verify || fail "RC identidad de artefactos no confirmada."
pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" control || fail "RC control congelado no disponible."
printf '{"schema":1,"batchId":"%s","state":"started"}\n' "$ID" >"$RUN_DIR/batch-$ID.json"
capture_pressure "before-$ID"
guard_begin "$ID"
rc_detection_start=false
[[ "${SLEEP_DETECTION_OK:-0}" == "1" ]] && rc_detection_start=true
env ANONLY_RC_ISOLATED=1 ANONLY_RC_MODE="$MODE" ANONLY_RC_SOURCE_MODE="$SOURCE_MODE" ANONLY_RC_OUTPUT_DIR="$RUN_DIR" ANONLY_RC_BUILD_DIR="$RUN_DIR" ANONLY_RC_BATCH_ID="$ID" \
 ANONLY_RC_M3_REFERENCE_DIR="$M3_REFERENCE" \
 pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/rc-isolated.spec.ts --workers=1 --retries=0 --max-failures=1 --pass-with-no-tests >>"$RUN_DIR/playwright.log" 2>&1 || FAILED=$((FAILED+1))
capture_pressure "after-$ID"
rc_guard_status=0
if guard_end "$ID"; then :; else rc_guard_status=$?; fi
rc_detection_end=false; [[ "${SLEEP_DETECTION_OK:-0}" == "1" ]] && rc_detection_end=true
rc_wake=false; [[ "$rc_guard_status" == "1" ]] && rc_wake=true
state=finished; reason=null
if [[ "$rc_detection_start" != "true" || "$rc_detection_end" != "true" ]]; then state=invalid; reason='"sleep-detection-unconfirmed"'
elif [[ "$rc_wake" == "true" ]]; then state=invalid; reason='"sleep-wake-event-during-run"'
elif [[ "$rc_guard_status" != "0" ]]; then state=invalid; reason='"batch-guard-not-sealed"'; fi
[[ "$state" == "finished" ]] || FAILED=$((FAILED+1))
printf '{"schema":1,"batchId":"%s","state":"%s","detectionConfirmedAtStart":%s,"detectionConfirmedAtEnd":%s,"sleepWakeEventObserved":%s,"invalidReason":%s}\n' "$ID" "$state" "$rc_detection_start" "$rc_detection_end" "$rc_wake" "$reason" >"$RUN_DIR/batch-$ID.json"
campaign_final_checks
rc_identity_end=true
pnpm exec tsx tests/perf/support/rcIsolatedBuildCli.ts "$RUN_DIR" verify || rc_identity_end=false
[[ "$(git rev-parse HEAD)" == "$(cat "$RUN_DIR/first/commit.txt")" ]] || rc_identity_end=false
[[ "$(cat "$RUN_DIR/source-mode.txt")" == "$SOURCE_MODE" && "$(cat "$RUN_DIR/first/source-mode.txt")" == "$SOURCE_MODE" ]] || rc_identity_end=false
cmp -s "$RUN_DIR/normal-renderer.sha256" "$RUN_DIR/first/normal-renderer.sha256" || rc_identity_end=false
[[ "$(git diff HEAD --binary -- packages/ apps/ | sha)" == "$(cat "$RUN_DIR/first/product-tree.diff.sha256")" ]] || rc_identity_end=false
[[ "$(git diff HEAD --binary -- tests/ | sha)" == "$(cat "$RUN_DIR/first/tests-tree.diff.sha256")" ]] || rc_identity_end=false
if [[ -f "$RUN_DIR/first/product-tree.identity.sha256" ]]; then [[ "$(product_tree_identity)" == "$(cat "$RUN_DIR/first/product-tree.identity.sha256")" ]] || rc_identity_end=false; fi
git ls-files --others --exclude-standard -- tests/ | LC_ALL=C "$(msys_tool sort)" | while IFS= read -r file; do printf '%s %s\n' "$(sha "$file")" "$file"; done >"$RUN_DIR/tests-untracked-final.sha256"
cmp -s "$RUN_DIR/tests-untracked-final.sha256" "$RUN_DIR/first/tests-untracked.sha256" || rc_identity_end=false
[[ "$(sha assets.lock.json)" == "$(cat "$RUN_DIR/first/assets-lock.sha256")" && "$(sha pnpm-lock.yaml)" == "$(cat "$RUN_DIR/first/pnpm-lock.sha256")" ]] || rc_identity_end=false
printf '{"confirmedAtStart":true,"confirmedAtEnd":%s,"sourceModeAtStart":"%s","sourceModeAtEnd":"%s"}\n' "$rc_identity_end" "$SOURCE_MODE" "$(cat "$RUN_DIR/source-mode.txt")" >"$RUN_DIR/identity-integrity.json"
[[ "$rc_identity_end" == "true" ]] || FAILED=$((FAILED+1))
pnpm exec tsx tests/perf/support/summarizeRcIsolatedCli.ts "$RUN_DIR" "$MODE" "$SOURCE_MODE" || FAILED=$((FAILED+1))
log "RC terminó: modo=$MODE source=$SOURCE_MODE; fallidas=$FAILED."
exit "$((FAILED>0))"
