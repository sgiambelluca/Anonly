#!/usr/bin/env bash
set -uo pipefail
# T-8 etapa 2 (AB_Intercalado_Plan.md §5): pico y tiempo del SEGUNDO documento,
# A/B intercalado. Reusa los dist-A / dist-B que ya construyo la etapa 1 —
# reconstruirlos daria otro bundle y romperia la comparacion con esa tanda.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT_DIR"
SRC_DIR="${1:?uso: run-ab-etapa2.sh <dir de la etapa 1>}"
PAIRS="${ANONLY_AB_PAIRS:-4}"
ARMS="${ANONLY_AB_ARMS:-A B}"
expect_reload_for_arm() { case "$1" in A) echo 1 ;; B|C) echo 0 ;; *) echo "" ;; esac; }
DIST_DIR="apps/react-client/dist"
OUT_DIR="$SRC_DIR/etapa2"; mkdir -p "$OUT_DIR"
LOG() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$OUT_DIR/campaign.log"; }
FAIL() { LOG "ABORTA: $*"; exit 1; }
pgrep -f '[p]laywright test --config' >/dev/null && FAIL "hay otra medicion activa."
for a in $ARMS; do [[ -d "$SRC_DIR/dist-$a" ]] || FAIL "falta $SRC_DIR/dist-$a"; done

hash_one() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
digest_dist() { ( cd "$1" || exit 1; find . -type f | LC_ALL=C sort | while IFS= read -r f; do hash_one "$f"; done ) | awk '{print $1}' | hash_one | awk '{print $1}'; }
activate_arm() {
  rm -rf "$DIST_DIR"; cp -R "$SRC_DIR/dist-$1" "$DIST_DIR" || FAIL "no se pudo activar $1"
  [[ "$(digest_dist "$DIST_DIR")" == "$(cat "$SRC_DIR/digest-$1.txt")" ]] || FAIL "el dist activo no es el brazo $1."
}

for ((i = 0; i < PAIRS; i++)); do
  for arm in $ARMS; do
    LOG "Ronda $((i + 1))/$PAIRS — brazo $arm..."
    activate_arm "$arm"
    ANONLY_AB_ARM="$arm" ANONLY_AB_RUN="$i" ANONLY_AB_OUTPUT_DIR="$OUT_DIR" \
      ANONLY_AB_EXPECT_RELOAD="$(expect_reload_for_arm "$arm")" \
      pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ab-preflight.spec.ts \
      --workers=1 --retries=0 >>"$OUT_DIR/playwright.log" 2>&1 \
      && LOG "  OK." || LOG "  FALLO (ver $OUT_DIR/playwright.log)."
  done
done
activate_arm A
LOG "Etapa 2 terminada: $OUT_DIR ($(find "$OUT_DIR" -maxdepth 1 -name 'memory-arm*.json' | wc -l | tr -d ' ') reportes)."
