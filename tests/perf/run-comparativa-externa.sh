#!/usr/bin/env bash
set -uo pipefail
# Comparativa externa: el build del repo contra un binario empaquetado ya
# instalado, con el MISMO instrumento (external-baseline.spec.ts), que no
# necesita __anonlyCore y por eso sirve para un build de produccion
# (docs/roadmap/Banco_Windows_Comparativa_Medicion.md §2).
#
# Tres rondas, orden alternado entre versiones y entre documentos para que
# ninguna quede siempre primera. Las rutas de R1, R2 y del binario instalado
# llegan por entorno y este script no las escribe en ningun log.
#
# ANONLY_EXT_ORDERS pisa el orden (rondas separadas por "|"), como
# ANONLY_WASM_RUNS en run-wasm.sh — p. ej. "installed:R1" para una sola corrida.
#
# En Windows corre desde Git Bash con el pnpm de corepack.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2 ANONLY_EXT_EXE; do
  if [[ -z "${!var:-}" || ! -f "${!var}" ]]; then
    echo "$var no esta definido o no apunta a un archivo." >&2
    exit 1
  fi
done

DEFAULT_ORDERS="repo:R1 installed:R1 repo:R2 installed:R2|installed:R2 repo:R2 installed:R1 repo:R1|repo:R1 installed:R1 repo:R2 installed:R2"
IFS="|" read -r -a ORDERS <<<"${ANONLY_EXT_ORDERS:-$DEFAULT_ORDERS}"
RUN_DIR="${ANONLY_EXT_RUN_DIR:-.measure/comparativa-externa/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then
  echo "La salida ya existe: $RUN_DIR — no se pisa una tanda previa." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"

LOG() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }

if command -v pgrep >/dev/null && pgrep -f '[p]laywright test --config' >/dev/null; then
  LOG "ABORTA: hay otra medicion Playwright activa."
  exit 1
fi

git rev-parse HEAD >"$RUN_DIR/commit.txt"

if [[ "${ANONLY_SKIP_BUILD:-0}" != "1" ]]; then
  LOG "Construyendo el producto empaquetado..."
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || { LOG "ABORTA: fallo el build."; exit 1; }
  pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || { LOG "ABORTA: fallo el build del shell."; exit 1; }
fi

FAILED=0
for ((round = 0; round < ${#ORDERS[@]}; round++)); do
  for item in ${ORDERS[$round]}; do
    target="${item%%:*}"
    doc="${item##*:}"
    LOG "Ronda $((round + 1))/${#ORDERS[@]} — $target / $doc..."
    if ANONLY_EXT_TARGET="$target" ANONLY_EXT_DOC="$doc" ANONLY_EXT_ROUND="$round" \
      ANONLY_EXT_OUTPUT_DIR="$RUN_DIR" \
      pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/external-baseline.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
      LOG "  OK."
    else
      LOG "  FALLO."
      FAILED=$((FAILED + 1))
    fi
    sleep 5
  done
done

LOG "Comparativa externa terminada: $RUN_DIR ($FAILED corridas fallidas)."
exit 0
