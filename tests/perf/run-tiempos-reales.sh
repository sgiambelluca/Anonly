#!/usr/bin/env bash
set -uo pipefail
# T-13 — tiempo del producto sobre los documentos reales, sin instrumento de memoria
# (docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md §4ter). Tres rondas, orden
# alternado. Las rutas de R1 y R2 llegan por entorno y no se escriben en ningún log.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
  if [[ -z "${!var:-}" || ! -f "${!var}" ]]; then
    echo "$var no esta definido o no apunta a un archivo." >&2
    exit 1
  fi
done

ORDERS=("R1 R2" "R2 R1" "R1 R2")
RUN_DIR="${ANONLY_REAL_TIMING_RUN_DIR:-.measure/tiempos-reales/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then
  echo "La salida ya existe: $RUN_DIR — no se pisa una tanda previa." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"

LOG() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }

if pgrep -f '[p]laywright test --config' >/dev/null; then
  LOG "ABORTA: hay otra medicion Playwright activa."
  exit 1
fi

git rev-parse HEAD >"$RUN_DIR/commit.txt"
LOG "Arrancando con load 1m=$(node -e 'process.stdout.write(require("os").loadavg()[0].toFixed(2))')."

if [[ "${ANONLY_SKIP_BUILD:-0}" != "1" ]]; then
  LOG "Construyendo el producto empaquetado..."
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || { LOG "ABORTA: fallo el build."; exit 1; }
  pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || { LOG "ABORTA: fallo el build del shell."; exit 1; }
fi

FAILED=0
for ((round = 0; round < ${#ORDERS[@]}; round++)); do
  for doc in ${ORDERS[$round]}; do
    LOG "Ronda $((round + 1))/${#ORDERS[@]} — $doc..."
    if ANONLY_REAL_TIMING_DOC="$doc" ANONLY_REAL_TIMING_ROUND="$round" ANONLY_REAL_TIMING_OUTPUT_DIR="$RUN_DIR" \
      pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/real-docs-timing.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
      LOG "  OK."
    else
      LOG "  FALLO."
      FAILED=$((FAILED + 1))
    fi
  done
done

LOG "T-13 terminada: $RUN_DIR ($FAILED corridas fallidas)."
exit 0
