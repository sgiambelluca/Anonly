#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
  if [[ -z "${!var:-}" || ! -r "${!var}" ]]; then
    echo "$var no está configurado o no es legible." >&2
    exit 1
  fi
done
if pgrep -f '[p]laywright test --config' >/dev/null; then
  echo "ABORTA: hay otra medición Playwright activa." >&2
  exit 1
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Este arnés valida únicamente macOS; Windows nativo sigue pendiente." >&2
  exit 1
fi

RUN_DIR="${ANONLY_GROUPING_OUTPUT_DIR:-.measure/grouping-worst-case/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then
  echo "La salida ya existe; no se pisan resultados previos." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"
DIST_DIR="apps/react-client/dist"
BACKUP_DIR="$RUN_DIR/dist-original"
HAD_DIST=0
if [[ -d "$DIST_DIR" ]]; then
  cp -R "$DIST_DIR" "$BACKUP_DIR" || exit 1
  HAD_DIST=1
fi
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  rm -rf "$DIST_DIR"
  if [[ "$HAD_DIST" -eq 1 && -d "$BACKUP_DIR" ]]; then
    cp -R "$BACKUP_DIR" "$DIST_DIR"
    rm -rf "$BACKUP_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() { echo "ABORTA: $*" >&2; exit 1; }
run_watchdog() {
  python3 tests/perf/support/timeout-command.py 660 caffeinate -dimsu "$@"
}

if ! command -v caffeinate >/dev/null 2>&1; then fail "caffeinate no está disponible."; fi
if [[ -n "$(pgrep -f '[v]itest' || true)" ]]; then fail "hay otra medición Vitest activa."; fi

VITE_E2E=1 pnpm --filter @anonly/react-client build > /dev/null 2>&1 || fail "falló el build del cliente."
pnpm --filter @anonly/desktop-shell build > /dev/null 2>&1 || fail "falló el build del shell."

ORDERS=("250 500 1000 2000" "2000 1000 500 250" "250 1000 500 2000")
REPEAT_ONLY="${ANONLY_GROUPING_REPEAT_ONLY:-0}"
REAL_ONLY="${ANONLY_GROUPING_REAL_ONLY:-0}"
if [[ "$REAL_ONLY" != "1" ]]; then
  for ((round = 1; round <= 3; round++)); do
    order="${ORDERS[$((round - 1))]}"
    for count in $order; do
      if [[ "$REPEAT_ONLY" == "1" ]]; then
        corpora=(repeated)
      elif (( round == 2 )); then
        corpora=(repeated distinct)
      else
        corpora=(distinct repeated)
      fi
      for corpus in "${corpora[@]}"; do
        ANONLY_GROUPING_OUTPUT_DIR="$RUN_DIR" run_watchdog pnpm exec tsx --tsconfig tests/tsconfig.json \
          tests/perf/grouping-worst-case.ts "$count" "$corpus" "$round" \
          > /dev/null 2>&1 || fail "falló un caso sintético; se conserva la salida parcial."
      done
    done
  done
fi

REAL_ORDERS=("R1 R2" "R2 R1" "R1 R2")
for ((round = 1; round <= 3; round++)); do
  for profile in ${REAL_ORDERS[$((round - 1))]}; do
    ANONLY_GROUPING_PROFILE="$profile" ANONLY_GROUPING_ROUND="$round" \
      ANONLY_GROUPING_OUTPUT_DIR="$RUN_DIR" run_watchdog pnpm exec playwright test \
      --config=playwright.perf.config.ts tests/perf/grouping-real-docs.spec.ts \
      --workers=1 --retries=0 > /dev/null 2>&1 || fail "falló una corrida real; se conserva la salida parcial."
  done
done

printf 'Banco Grouping terminado: IDs R1/R2, tres rondas; reportes agregados y huellas en %s.\n' "$RUN_DIR"
