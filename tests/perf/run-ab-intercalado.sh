#!/usr/bin/env bash
set -uo pipefail
# T-8 — A/B intercalado (docs/roadmap/AB_Intercalado_Plan.md).
#
# Construye los dos brazos UNA vez y despues intercambia el `dist` ya construido
# entre corrida y corrida (plan §4): reconstruir doce veces meteria al compilador
# en medio de la campania. El arbol de git queda siempre en el brazo A; lo unico
# que se mueve es apps/react-client/dist.
#
# Portable a proposito (plan §8): el load average se lee con os.loadavg() de
# Node y no con `sysctl`, el hash cae a `shasum` si no hay `sha256sum`, y no se
# usa `rsync`. En Windows nativo loadavg no existe: la espera se saltea con un
# mensaje explicito, nunca con un cero silencioso.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

# Brazos: A es el arbol limpio; cada otro brazo es un parche. La expectativa de
# recarga del pre-vuelo va junto al brazo, porque con tres brazos ya no se puede
# deducir del nombre (A recarga; B y C llegan al documento siguiente con el
# modelo todavia cargado).
ARMS="${ANONLY_AB_ARMS:-A B}"
patch_for_arm() {
  case "$1" in
    A) echo "" ;;
    B) echo "tests/perf/support/ab-sin-baja-ner.patch" ;;
    C) echo "tests/perf/support/ab-timer-15s-ner.patch" ;;
    *) echo "__desconocido__" ;;
  esac
}
expect_reload_for_arm() { case "$1" in A) echo 1 ;; B|C) echo 0 ;; *) echo "" ;; esac; }
DIST_DIR="apps/react-client/dist"
PAIRS="${ANONLY_AB_PAIRS:-6}"

RUN_DIR="${ANONLY_AB_RUN_DIR:-.measure/ab-intercalado/$(date -u +%Y%m%dT%H%M%SZ)}"
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
  FAIL "hay cambios sin commitear en packages/ o apps/ — el brazo A tiene que ser el commit limpio."
fi

hash_one() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
# Digest del CONTENIDO de un dist, independiente de donde este montado: se entra
# al directorio para que las rutas sean relativas e identicas entre copias, se
# hashea archivo por archivo en orden estable, y se hashea la lista resultante.
# Sin esto, dist-A y apps/react-client/dist darian digests distintos por la ruta
# y la verificacion de brazo no serviria para nada.
digest_dist() {
  (
    cd "$1" || exit 1
    find . -type f | LC_ALL=C sort | while IFS= read -r f; do hash_one "$f"; done
  ) | awk '{print $1}' | hash_one | awk '{print $1}'
}

# --- Espera de banco (portable) ------------------------------------------
LOAD_THRESHOLD=4.0
read_load_1m() { node -e 'const l=require("os").loadavg()[0]; process.stdout.write(process.platform==="win32"?"":String(l))' 2>/dev/null; }
LOAD_NOW="$(read_load_1m)"
if [[ -z "$LOAD_NOW" ]]; then
  LOG "load average no disponible en esta plataforma — se sigue sin esperar (declarado, no un cero silencioso)."
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

# --- Construccion de los dos brazos --------------------------------------
build_client() { VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1; }

LOG "Construyendo el shell (igual para los dos brazos)..."
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || FAIL "fallo el build del shell."

for arm in $ARMS; do
  ARM_PATCH="$(patch_for_arm "$arm")"
  [[ "$ARM_PATCH" == "__desconocido__" ]] && FAIL "brazo desconocido: $arm"
  if [[ -n "$ARM_PATCH" ]]; then
    LOG "Aplicando el parche del brazo $arm ($ARM_PATCH)..."
    git apply --check "$ARM_PATCH" || FAIL "el parche del brazo $arm no aplica."
    git apply "$ARM_PATCH" || FAIL "no se pudo aplicar el parche del brazo $arm."
    cp "$ARM_PATCH" "$RUN_DIR/brazo-$arm.patch"
  fi
  LOG "Construyendo brazo $arm..."
  if build_client; then
    cp -R "$DIST_DIR" "$RUN_DIR/dist-$arm" || FAIL "no se pudo guardar dist-$arm."
    digest_dist "$RUN_DIR/dist-$arm" >"$RUN_DIR/digest-$arm.txt"
    LOG "  dist-$arm digest $(cat "$RUN_DIR/digest-$arm.txt")"
  else
    [[ -n "$ARM_PATCH" ]] && { git apply -R "$ARM_PATCH" || LOG "ADVERTENCIA: no se pudo revertir $ARM_PATCH."; }
    FAIL "fallo el build del brazo $arm."
  fi
  if [[ -n "$ARM_PATCH" ]]; then
    git apply -R "$ARM_PATCH" || FAIL "NO SE PUDO REVERTIR $ARM_PATCH - revisar el arbol a mano."
    LOG "  parche del brazo $arm revertido."
  fi
done
git diff --quiet -- packages/ apps/ || FAIL "el arbol quedo sucio despues de construir los brazos."

# Dos brazos con el mismo digest serian el mismo binario medido dos veces.
DIGESTS_SEEN=""
for arm in $ARMS; do
  d="$(cat "$RUN_DIR/digest-$arm.txt")"
  case " $DIGESTS_SEEN " in *" $d "*) FAIL "dos brazos comparten digest - algun parche no llego al bundle." ;; esac
  DIGESTS_SEEN="$DIGESTS_SEEN $d"
done
LOG "Digests distintos para: $ARMS. Los brazos son distintos de verdad."

# --- Activar un brazo, verificando ----------------------------------------
activate_arm() {
  local arm="$1"
  rm -rf "$DIST_DIR"
  cp -R "$RUN_DIR/dist-$arm" "$DIST_DIR" || FAIL "no se pudo activar el brazo $arm."
  local got expected
  got="$(digest_dist "$DIST_DIR")"
  expected="$(cat "$RUN_DIR/digest-$arm.txt")"
  [[ "$got" == "$expected" ]] || FAIL "el dist activo no es el brazo $arm (digest $got != $expected)."
}

run_spec() {
  local spec="$1" arm="$2" run="$3" logfile="$4"
  ANONLY_AB_ARM="$arm" ANONLY_AB_RUN="$run" ANONLY_HOT_BASELINE_OUTPUT_DIR="$RUN_DIR" \
    pnpm exec playwright test --config=playwright.perf.config.ts "$spec" \
    --workers=1 --retries=0 >>"$logfile" 2>&1
}

# --- Pre-vuelo discriminante (plan §4.1) ----------------------------------
for arm in $ARMS; do
  LOG "Pre-vuelo del brazo $arm (NER_MODEL_READY en el segundo documento)..."
  activate_arm "$arm"
  ANONLY_AB_EXPECT_RELOAD="$(expect_reload_for_arm "$arm")" \
    run_spec tests/perf/ab-preflight.spec.ts "$arm" 0 "$RUN_DIR/preflight-$arm.log" \
    || FAIL "el pre-vuelo del brazo $arm fallo (ver $RUN_DIR/preflight-$arm.log)."
  LOG "  pre-vuelo $arm OK."
done

# --- Calentamiento, descartado por protocolo (plan §5) --------------------
LOG "Corrida de calentamiento (brazo A, se descarta por protocolo)..."
activate_arm A
ANONLY_AB_ARM=A ANONLY_AB_RUN=warmup ANONLY_HOT_BASELINE_OUTPUT_DIR="$RUN_DIR/descartado-calentamiento" \
  pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/ab-release-curve.spec.ts \
  --workers=1 --retries=0 >>"$RUN_DIR/warmup.log" 2>&1 \
  || LOG "  la corrida de calentamiento no termino bien; se sigue igual (se descarta de todos modos)."

# --- La campania ----------------------------------------------------------
FAILED=0
for ((i = 0; i < PAIRS; i++)); do
  for arm in $ARMS; do
    LOG "Ronda $((i + 1))/$PAIRS — brazo $arm..."
    activate_arm "$arm"
    if run_spec tests/perf/ab-release-curve.spec.ts "$arm" "$i" "$RUN_DIR/playwright.log"; then
      LOG "  OK."
    else
      LOG "  FALLO (ver $RUN_DIR/playwright.log) — se sigue con el resto."
      FAILED=$((FAILED + 1))
    fi
  done
done

activate_arm A
LOG "Brazo A restaurado en $DIST_DIR."

JSONS=$(find "$RUN_DIR" -maxdepth 1 -name 'hot-baseline-*.json' | wc -l | tr -d ' ')
LOG "Campania terminada: $RUN_DIR ($JSONS reportes, $FAILED fallidas)."

if [[ -f tests/perf/support/aggregateAbReports.ts ]]; then
  LOG "Agregando (comparacion pareada)..."
  pnpm tsx tests/perf/support/aggregateAbReports.ts "$RUN_DIR" 2>&1 | tee -a "$RUN_DIR/aggregate.log"
fi
exit 0
