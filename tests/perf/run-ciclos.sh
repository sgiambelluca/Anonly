#!/usr/bin/env bash
set -uo pipefail
# T-9 — el ciclo de 10 open/close (docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md §2).
#
# Tres corridas en serie, cada una en su propia instancia de Electron: L1 (P1
# encadenado), L2 (P2 encadenado) y L3 (P1 con 90 s de reposo). Nunca dos a la
# vez (Optimizacion_De_Memoria_Plan.md §2bis punto 1). Sin `-e` a proposito: si
# una corrida falla, las otras igual se hacen.
#
# Portable como run-ab-intercalado.sh: load average por os.loadavg() de Node, y
# en Windows nativo la espera se saltea diciendolo.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

RUNS="${ANONLY_LEAK_RUNS:-L1 L2 L3}"
RUN_DIR="${ANONLY_LEAK_RUN_DIR:-.measure/ciclos/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then
  echo "La salida ya existe: $RUN_DIR — no se pisa una tanda previa." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"

LOG() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }
FAIL() { LOG "ABORTA: $*"; exit 1; }

if pgrep -f '[p]laywright test --config' >/dev/null; then
  FAIL "hay otra medicion Playwright activa (plan de memoria §2bis punto 1)."
fi

LOAD_THRESHOLD=4.0
read_load_1m() { node -e 'const l=require("os").loadavg()[0]; process.stdout.write(process.platform==="win32"?"":String(l))' 2>/dev/null; }
LOAD_NOW="$(read_load_1m)"
if [[ -z "$LOAD_NOW" ]]; then
  LOG "load average no disponible en esta plataforma — se sigue sin esperar."
else
  WAITED=0
  while awk -v l="$LOAD_NOW" -v t="$LOAD_THRESHOLD" 'BEGIN{exit !(l>t)}'; do
    if (( WAITED >= 900 )); then LOG "load 1m=$LOAD_NOW sigue sobre $LOAD_THRESHOLD tras ${WAITED}s — se sigue igual."; break; fi
    LOG "load 1m=$LOAD_NOW > $LOAD_THRESHOLD — esperando 30s (${WAITED}s/900s)."
    sleep 30; WAITED=$((WAITED+30)); LOAD_NOW="$(read_load_1m)"
  done
  LOG "Arrancando con load 1m=${LOAD_NOW}."
fi

git rev-parse HEAD >"$RUN_DIR/commit.txt"
git status --short >"$RUN_DIR/git-status.txt"

if [[ "${ANONLY_SKIP_BUILD:-0}" != "1" ]]; then
  LOG "Construyendo el producto empaquetado..."
  VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || FAIL "fallo el build del cliente."
  pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || FAIL "fallo el build del shell."
else
  LOG "ANONLY_SKIP_BUILD=1: se usa el build existente (checkFreshBuild igual lo verifica)."
fi

FAILED=0
for run in $RUNS; do
  LOG "Corrida $run..."
  if ANONLY_LEAK_RUN="$run" ANONLY_LEAK_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/leak-cycles.spec.ts \
    --workers=1 --retries=0 >>"$RUN_DIR/playwright-$run.log" 2>&1; then
    LOG "  $run OK."
  else
    LOG "  $run FALLO (ver $RUN_DIR/playwright-$run.log) — se sigue con el resto."
    FAILED=$((FAILED + 1))
  fi
done

LOG "T-9 terminada: $RUN_DIR ($FAILED corridas fallidas)."
exit 0
