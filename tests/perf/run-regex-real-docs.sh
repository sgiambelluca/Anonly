#!/usr/bin/env bash
set -uo pipefail
# Regex control sobre R1/R2 en Electron. Las rutas se usan solo para entregar
# bytes a la app; no se escriben en logs ni reportes.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
  if [[ -z "${!var:-}" || ! -f "${!var}" ]]; then
    echo "$var no esta definido o no apunta a un archivo." >&2
    exit 1
  fi
done

if pgrep -f '[p]laywright test --config' >/dev/null; then
  echo "ABORTA: hay otra medicion Playwright activa." >&2
  exit 1
fi

ORDERS=("R1 R2" "R2 R1" "R1 R2")
RUN_DIR="${ANONLY_REAL_REGEX_OUTPUT_DIR:-.measure/regex-real/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then
  echo "La carpeta de salida ya existe; no se pisan corridas previas." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"
FAILED=0

for ((round = 0; round < ${#ORDERS[@]}; round++)); do
  for profile in ${ORDERS[$round]}; do
    echo "Ronda $((round + 1))/3 — $profile"
    if ANONLY_REAL_REGEX_PROFILE="$profile" ANONLY_REAL_REGEX_ROUND="$((round + 1))" \
      ANONLY_REAL_REGEX_OUTPUT_DIR="$RUN_DIR" \
      python3 tests/perf/support/timeout-command.py 660 pnpm exec playwright test \
      --config=playwright.perf.config.ts tests/perf/regex-real-docs.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
      echo "OK"
    else
      echo "FALLO de corrida; se conserva el log numérico y continúa el intercalado."
      FAILED=$((FAILED + 1))
    fi
  done
done

echo "Campaña Regex real finalizada: $FAILED corridas fallidas."
exit 0
