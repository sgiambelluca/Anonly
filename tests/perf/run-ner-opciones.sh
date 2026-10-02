#!/usr/bin/env bash
set -uo pipefail
# T-12 — configurar el modelo de NER sin cambiarlo
# (docs/roadmap/Ciclos_Y_Documentos_Reales_Plan.md §4bis).
#
# Mismo mecanismo que run-ab-intercalado.sh (T-8): cada brazo es un parche de
# una línea, se construye una vez, y entre corrida y corrida se intercambia el
# `dist` verificando su digest. El árbol del producto queda siempre en A.
#
# CONFIDENCIALIDAD (plan §3.1): las rutas de R1 y R2 llegan por entorno y este
# script no las escribe en ningún log.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

for var in ANONLY_REAL_DOC_R1 ANONLY_REAL_DOC_R2; do
  if [[ -z "${!var:-}" || ! -f "${!var}" ]]; then
    echo "$var no esta definido o no apunta a un archivo." >&2
    exit 1
  fi
done

ARMS="A B C D"
ORDERS=("A B C D" "D C B A" "A B C D")
patch_for_arm() {
  case "$1" in
    A) echo "" ;;
    B) echo "tests/perf/support/ner-arm-b-graph-basic.patch" ;;
    C) echo "tests/perf/support/ner-arm-c-sin-prepacking.patch" ;;
    D) echo "tests/perf/support/ner-arm-d-dos-hilos.patch" ;;
    *) echo "__desconocido__" ;;
  esac
}
DIST_DIR="apps/react-client/dist"

RUN_DIR="${ANONLY_NER_RUN_DIR:-.measure/ner-opciones/$(date -u +%Y%m%dT%H%M%SZ)}"
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
if ! git diff --quiet -- packages/ apps/; then
  FAIL "hay cambios sin commitear en packages/ o apps/ — el brazo A tiene que ser el árbol limpio."
fi

hash_one() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
digest_dist() {
  (
    cd "$1" || exit 1
    find . -type f | LC_ALL=C sort | while IFS= read -r f; do hash_one "$f"; done
  ) | awk '{print $1}' | hash_one | awk '{print $1}'
}

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

LOG "Construyendo el shell..."
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || FAIL "fallo el build del shell."

for arm in $ARMS; do
  ARM_PATCH="$(patch_for_arm "$arm")"
  [[ "$ARM_PATCH" == "__desconocido__" ]] && FAIL "brazo desconocido: $arm"
  if [[ -n "$ARM_PATCH" ]]; then
    git apply --check "$ARM_PATCH" || FAIL "el parche del brazo $arm no aplica."
    git apply "$ARM_PATCH" || FAIL "no se pudo aplicar el parche del brazo $arm."
    cp "$ARM_PATCH" "$RUN_DIR/brazo-$arm.patch"
  fi
  LOG "Construyendo brazo $arm..."
  if VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1; then
    cp -R "$DIST_DIR" "$RUN_DIR/dist-$arm" || FAIL "no se pudo guardar dist-$arm."
    digest_dist "$RUN_DIR/dist-$arm" >"$RUN_DIR/digest-$arm.txt"
  else
    [[ -n "$ARM_PATCH" ]] && git apply -R "$ARM_PATCH"
    FAIL "fallo el build del brazo $arm."
  fi
  if [[ -n "$ARM_PATCH" ]]; then
    git apply -R "$ARM_PATCH" || FAIL "NO SE PUDO REVERTIR $ARM_PATCH — revisar el árbol a mano."
  fi
done
git diff --quiet -- packages/ apps/ || FAIL "el árbol quedó sucio después de construir los brazos."

DIGESTS_SEEN=""
for arm in $ARMS; do
  d="$(cat "$RUN_DIR/digest-$arm.txt")"
  case " $DIGESTS_SEEN " in *" $d "*) FAIL "dos brazos comparten digest — algún parche no llegó al bundle." ;; esac
  DIGESTS_SEEN="$DIGESTS_SEEN $d"
done
LOG "Digests distintos para: $ARMS."

activate_arm() {
  rm -rf "$DIST_DIR"
  cp -R "$RUN_DIR/dist-$1" "$DIST_DIR" || FAIL "no se pudo activar el brazo $1."
  [[ "$(digest_dist "$DIST_DIR")" == "$(cat "$RUN_DIR/digest-$1.txt")" ]] || FAIL "el dist activo no es el brazo $1."
}

run_doc() {
  local doc="$1" label="$2"
  ANONLY_WASM_RUN="$doc" ANONLY_WASM_LABEL="$label" ANONLY_WASM_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/wasm-attribution.spec.ts \
    --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1
}

FAILED=0
for ((round = 0; round < ${#ORDERS[@]}; round++)); do
  for arm in ${ORDERS[$round]}; do
    LOG "Ronda $((round + 1))/${#ORDERS[@]} — R1, brazo $arm..."
    activate_arm "$arm"
    if run_doc r1 "r1-arm$arm-round$round"; then LOG "  OK."; else LOG "  FALLO."; FAILED=$((FAILED + 1)); fi
  done
done

LOG "R2 con el brazo A (techo de Tesseract con texto real)..."
activate_arm A
if run_doc r2 "r2-armA"; then LOG "  OK."; else LOG "  FALLO."; FAILED=$((FAILED + 1)); fi

activate_arm A
LOG "T-12 terminada: $RUN_DIR ($FAILED corridas fallidas). Brazo A restaurado en $DIST_DIR."
exit 0
