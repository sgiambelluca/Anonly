#!/usr/bin/env bash
set -uo pipefail
# T-10 — dos documentos reales contra sus fixtures
# (docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md §3).
#
# Cuatro perfiles (P1, P2, R1, R2), tres rondas, intercalados en una sola
# sesion y con el orden alternado para que ninguno quede siempre primero.
#
# CONFIDENCIALIDAD (plan §3.1): las rutas de R1 y R2 llegan por entorno y este
# script no las escribe en ningun log, ni las copia, ni las imprime. Solo
# verifica que existan.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
  if [[ -z "${!var:-}" || ! -f "${!var}" ]]; then
    echo "$var no esta definido o no apunta a un archivo." >&2
    exit 1
  fi
done

ORDERS=("P1 P2 R1 R2" "R2 R1 P2 P1" "P1 P2 R1 R2")
RUN_DIR="${ANONLY_REAL_DOCS_RUN_DIR:-.measure/documentos-reales/$(date -u +%Y%m%dT%H%M%SZ)}"
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
for ((round = 0; round < ${#ORDERS[@]}; round++)); do
  for profile in ${ORDERS[$round]}; do
    LOG "Ronda $((round + 1))/${#ORDERS[@]} — $profile..."
    if ANONLY_REAL_DOCS_PROFILE="$profile" ANONLY_REAL_DOCS_ROUND="$round" \
      ANONLY_REAL_DOCS_OUTPUT_DIR="$RUN_DIR" \
      pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/real-docs.spec.ts \
      --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
      LOG "  OK."
    else
      LOG "  FALLO (ver $RUN_DIR/playwright.log) — se sigue con el resto."
      FAILED=$((FAILED + 1))
    fi
  done
done

LOG "T-10 terminada: $RUN_DIR ($FAILED corridas fallidas)."
exit 0
