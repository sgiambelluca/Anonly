#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

PYTHON312="${PYTHON312:-python3.12}"
PYTHON_ENV=".measure/ner-packaging-adr173/venv"
CONVERTER="tests/perf/support/convert-ner-external-data.py"
REQUIREMENTS="tests/perf/support/ner-external-data-requirements.txt"
PATCH="tests/perf/support/ner-external-data.patch"
SOURCE_MODEL="apps/react-client/public/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx"
RELATIVE_MODEL="models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx"
RELATIVE_DATA="models/ner/Xenova/bert-base-multilingual-cased-ner-hrl/onnx/model_quantized.onnx_data"
DIST_DIR="apps/react-client/dist"
RUN_DIR="${ANONLY_NER_PACKAGING_RUN_DIR:-.measure/ner-packaging-adr173/runs/$(date -u +%Y%m%dT%H%M%SZ)}"
PATCH_APPLIED=0

LOG() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$RUN_DIR/campaign.log"; }
FAIL() { LOG "ABORTA: $*"; exit 1; }
hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
digest_dir() {
  (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r path; do shasum -a 256 "$path"; done) |
    awk '{print $1}' | shasum -a 256 | awk '{print $1}'
}
restore_patch() {
  if [[ "$PATCH_APPLIED" == "1" ]]; then
    git apply -R "$PATCH" || printf 'FATAL: No se pudo revertir %s.\n' "$PATCH" >&2
    PATCH_APPLIED=0
  fi
}
restore_dist() {
  if [[ -d "$RUN_DIR/dist-A" ]]; then
    rm -rf "$DIST_DIR"
    cp -R "$RUN_DIR/dist-A" "$DIST_DIR" || printf 'FATAL: No se pudo restaurar dist-A.\n' >&2
  fi
}
cleanup() { restore_patch; restore_dist; }
trap cleanup EXIT INT TERM

[[ ! -e "$RUN_DIR" ]] || FAIL "La salida ya existe: $RUN_DIR."
mkdir -p "$RUN_DIR"
if pgrep -f '[p]laywright test --config=playwright.perf.config.ts' >/dev/null; then
  FAIL "hay otra medición Playwright activa."
fi
if ! git diff --quiet -- packages/ apps/; then
  FAIL "hay cambios sin commit en paquetes o apps; no se puede aislar el parche experimental."
fi
command -v "$PYTHON312" >/dev/null 2>&1 || FAIL "Python 3.12 no está disponible (PYTHON312=$PYTHON312)."

mkdir -p "$(dirname "$PYTHON_ENV")"
if [[ ! -x "$PYTHON_ENV/bin/python" ]]; then "$PYTHON312" -m venv "$PYTHON_ENV" || FAIL "no se pudo crear el entorno Python aislado."; fi
PYTHONDONTWRITEBYTECODE=1 "$PYTHON_ENV/bin/python" -m pip install --disable-pip-version-check -r "$REQUIREMENTS" >>"$RUN_DIR/python.log" 2>&1 || FAIL "no se pudo instalar la herramienta fijada."
PYTHONDONTWRITEBYTECODE=1 "$PYTHON_ENV/bin/python" -m unittest tests/perf/support/test_convert_ner_external_data.py >>"$RUN_DIR/python.log" 2>&1 || FAIL "fallaron las pruebas del conversor."
PYTHONDONTWRITEBYTECODE=1 "$PYTHON_ENV/bin/python" "$CONVERTER" "$SOURCE_MODEL" "$RUN_DIR/converted" >>"$RUN_DIR/conversion.log" 2>&1 || FAIL "la conversión o la validación de los tres hashes falló."

git rev-parse HEAD >"$RUN_DIR/commit.txt"
shasum -a 256 "$SOURCE_MODEL" "$RUN_DIR/converted/model_quantized.onnx" "$RUN_DIR/converted/model_quantized.onnx_data" >"$RUN_DIR/assets.sha256"
pnpm --filter @anonly/desktop-shell build >>"$RUN_DIR/build.log" 2>&1 || FAIL "falló el build del shell Electron."

VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || FAIL "falló el build del brazo A."
cp -R "$DIST_DIR" "$RUN_DIR/dist-A" || FAIL "no se pudo guardar dist-A."
digest_dir "$RUN_DIR/dist-A" >"$RUN_DIR/digest-A.txt"
(
  cd "$RUN_DIR/dist-A/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl" || exit 1
  find . -type f | LC_ALL=C sort | while IFS= read -r path; do shasum -a 256 "$path"; done
) >"$RUN_DIR/assets-served-A.sha256" || FAIL "no se pudo registrar la identidad servida de A."

git apply --check "$PATCH" || FAIL "el parche B no aplica sobre la revisión actual."
git apply "$PATCH" || FAIL "no se pudo aplicar el parche B."
PATCH_APPLIED=1
[[ "$(git diff --numstat -- packages/anonymization-core/ner-engine/src/worker/kernel.ts)" == $'1\t0\tpackages/anonymization-core/ner-engine/src/worker/kernel.ts' ]] || FAIL "B no contiene exactamente una opción de carga en el kernel."
VITE_E2E=1 pnpm --filter @anonly/react-client build >>"$RUN_DIR/build.log" 2>&1 || FAIL "falló el build del brazo B."
cp -R "$DIST_DIR" "$RUN_DIR/dist-B" || FAIL "no se pudo guardar dist-B."
restore_patch
git diff --quiet -- packages/ apps/ || FAIL "el árbol del producto no volvió al estado previo."

mkdir -p "$(dirname "$RUN_DIR/dist-B/$RELATIVE_MODEL")"
cp "$RUN_DIR/converted/model_quantized.onnx" "$RUN_DIR/dist-B/$RELATIVE_MODEL" || FAIL "no se pudo instalar el candidato en dist-B."
cp "$RUN_DIR/converted/model_quantized.onnx_data" "$RUN_DIR/dist-B/$RELATIVE_DATA" || FAIL "no se pudo instalar el sidecar en dist-B."
[[ "$(hash_file "$RUN_DIR/dist-B/$RELATIVE_MODEL")" == "212d5c76983e8e0a97a60d4e6733975980ccdc0792f335a590c503f92ee24d49" ]] || FAIL "el ONNX de B no tiene el hash esperado."
[[ "$(hash_file "$RUN_DIR/dist-B/$RELATIVE_DATA")" == "abe8b9215a0dcbf20cd1e48758d927ce974f6dc373b3171360848ee5890e8e52" ]] || FAIL "el sidecar de B no tiene el hash esperado."
digest_dir "$RUN_DIR/dist-B" >"$RUN_DIR/digest-B.txt"
(
  cd "$RUN_DIR/dist-B/models/ner/Xenova/bert-base-multilingual-cased-ner-hrl" || exit 1
  find . -type f | LC_ALL=C sort | while IFS= read -r path; do shasum -a 256 "$path"; done
) >"$RUN_DIR/assets-served-B.sha256" || FAIL "no se pudo registrar la identidad servida de B."
[[ "$(cat "$RUN_DIR/digest-A.txt")" != "$(cat "$RUN_DIR/digest-B.txt")" ]] || FAIL "los builds A y B tienen el mismo digest."

activate_arm() {
  local arm="$1"
  rm -rf "$DIST_DIR"
  cp -R "$RUN_DIR/dist-$arm" "$DIST_DIR" || FAIL "no se pudo activar el brazo $arm."
  [[ "$(digest_dir "$DIST_DIR")" == "$(cat "$RUN_DIR/digest-$arm.txt")" ]] || FAIL "el dist activo no es el brazo $arm."
}
run_gate() {
  local arm="$1"
  ANONLY_NER_PACKAGING_ARM="$arm" ANONLY_NER_PACKAGING_OUTPUT_DIR="$RUN_DIR" \
    PYTHONDONTWRITEBYTECODE=1 pnpm exec playwright test --config=playwright.perf.config.ts \
      tests/perf/ner-packaging.spec.ts --workers=1 --retries=0 >>"$RUN_DIR/playwright-gate.log" 2>&1
}
run_memory() {
  local arm="$1" run_id="$2"
  ANONLY_NER_PACKAGING_ARM="$arm" ANONLY_NER_PACKAGING_MEASURE_RUN="$run_id" \
    ANONLY_NER_PACKAGING_OUTPUT_DIR="$RUN_DIR" PYTHONDONTWRITEBYTECODE=1 \
    pnpm exec playwright test --config=playwright.perf.config.ts \
      tests/perf/ner-packaging-memory.spec.ts --workers=1 --retries=0 \
      >>"$RUN_DIR/playwright-memory.log" 2>&1
}

LOG "Gate app:// Chromium/WASM A (corpus completo y control ADR-147)."
activate_arm A
run_gate A || FAIL "el gate de compatibilidad/calidad A está rojo; no comienza la medición."
LOG "Gate app:// Chromium/WASM B (corpus completo, ADR-147 y salida exacta)."
activate_arm B
run_gate B || FAIL "el gate de compatibilidad/calidad B está rojo; no comienza la medición."
activate_arm A
LOG "Gate verde para A y B. Revisión de hashes y salidas en $RUN_DIR."

if [[ "${ANONLY_NER_PACKAGING_GATE_ONLY:-0}" == "1" ]]; then
  LOG "Modo gate-only: no se inicia medición de memoria. Brazo A restaurado."
  exit 0
fi

LOG "Gate A/B verde. Se inicia medición P2 intercalada; R1 disponible: $(if [[ -n "${ANONLY_REAL_DOC_R1:-}" && -f "$ANONLY_REAL_DOC_R1" ]]; then echo sí; else echo no; fi)."
printf '{"profile":"P2 scanned 50 pages","r1Available":%s,"orders":[["A","B"],["B","A"],["A","B"]],"pairs":3,"nerIdleDisposeMs":15000}\n' \
  "$(if [[ -n "${ANONLY_REAL_DOC_R1:-}" && -f "$ANONLY_REAL_DOC_R1" ]]; then echo true; else echo false; fi)" \
  >"$RUN_DIR/measurement-plan.json"
for pair in 1 2 3; do
  if [[ "$pair" == "2" ]]; then arms=(B A); else arms=(A B); fi
  for arm in "${arms[@]}"; do
    run_id="p2-pair${pair}-${arm}"
    LOG "Pareja $pair/3, brazo $arm ($run_id)."
    activate_arm "$arm"
    run_memory "$arm" "$run_id" || FAIL "falló medición $run_id; revisar $RUN_DIR/playwright-memory.log."
  done
done
activate_arm A
LOG "Tanda P2 completa: $RUN_DIR. Brazo A restaurado en $DIST_DIR."
