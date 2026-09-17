#!/usr/bin/env bash
set -uo pipefail
# Deliberadamente SIN `-e`: si Playwright termina con corridas fallidas (una
# de las 12 no da `ok: true`), igual queremos que el agregador corra sobre lo
# que sí se escribió, en vez de perder toda la evidencia por el primer error.
# El código de salida del script sigue reflejando el de Playwright al final.

# Campaña T-7 — de qué está hecha la línea de base caliente
# (docs/roadmap/Perfilado_Base_Caliente_Plan.md). Un solo script para las
# doce corridas (P1/P2 × NER on/off × 3, alternadas): espera a que el banco
# no esté en un pico, construye el producto empaquetado, corre la campaña
# serial y agrega al final — pensado para lanzarse en background
# (Optimizacion_De_Memoria_Plan.md §2bis: nunca dos mediciones a la vez).

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

RUN_DIR="${ANONLY_HOT_BASELINE_RUN_DIR:-.measure/base-caliente/$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ -e "$RUN_DIR" ]]; then
  echo "La salida ya existe: $RUN_DIR — no se pisa una tanda previa (plan §4)." >&2
  exit 1
fi
mkdir -p "$RUN_DIR"

LOG() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$RUN_DIR/campaign.log"; }

if pgrep -f '[p]laywright test --config' >/dev/null; then
  echo "Hay otra medición Playwright activa — no se lanza otra encima (Optimizacion_De_Memoria_Plan.md §2bis punto 1)." >&2
  exit 1
fi

# --- Espera a que el banco no esté en un pico ------------------------------
# La máquina (M1, 8 núcleos/8GB) tiene un piso de load average propio de
# ~2.0 (CLAUDE.md, "Sobre la máquina") que nunca baja — esperar silencio
# absoluto no termina nunca. El umbral de 4.0 (2× el piso conocido) es una
# heurística práctica para "no en medio de otra carga", no un valor con
# respaldo estadístico; documentado acá y en el manifiesto para que quien lea
# el informe sepa qué filtró esta espera y qué no. Tope de 15 min: pasado
# eso, se sigue igual y se deja la condición real registrada (nunca se
# pretende silencio que la máquina no tiene — plan §6).
LOAD_THRESHOLD="4.0"
MAX_WAIT_S=900
WAITED_S=0
read_load_1m() {
  sysctl -n vm.loadavg 2>/dev/null | awk '{gsub(/[{}]/,""); print $1}'
}
LOAD_NOW="$(read_load_1m)"
while [[ -n "$LOAD_NOW" ]] && awk -v l="$LOAD_NOW" -v t="$LOAD_THRESHOLD" 'BEGIN{exit !(l>t)}'; do
  if (( WAITED_S >= MAX_WAIT_S )); then
    LOG "Load average 1m=$LOAD_NOW sigue sobre $LOAD_THRESHOLD tras ${MAX_WAIT_S}s de espera — se sigue igual (no hay garantía de silencio en este banco)."
    break
  fi
  LOG "Load average 1m=$LOAD_NOW > $LOAD_THRESHOLD — esperando 30s (acumulado ${WAITED_S}s/${MAX_WAIT_S}s máx)."
  sleep 30
  WAITED_S=$((WAITED_S + 30))
  LOAD_NOW="$(read_load_1m)"
done
LOG "Arrancando con load average 1m=${LOAD_NOW:-desconocido} (umbral $LOAD_THRESHOLD, espera ${WAITED_S}s)."

# --- Manifiesto de identidad -------------------------------------------------
git rev-parse HEAD >"$RUN_DIR/commit.txt"
git status --porcelain >"$RUN_DIR/git-status.txt"
hash_files() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
hash_files pnpm-lock.yaml assets.lock.json >"$RUN_DIR/locks.sha256"

# --- Build (VITE_E2E=1 para __anonlyCore, requerido por checkFreshBuild.ts) -
LOG "Construyendo react-client + desktop-shell..."
{
  VITE_E2E=1 pnpm --filter @anonly/react-client build
  pnpm --filter @anonly/desktop-shell build
} >"$RUN_DIR/build.log" 2>&1
BUILD_STATUS=$?
if [[ "$BUILD_STATUS" -ne 0 ]]; then
  LOG "El build falló (ver $RUN_DIR/build.log) — no se corre la campaña."
  exit "$BUILD_STATUS"
fi
LOG "Build OK."

node - "$RUN_DIR" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const [dir] = process.argv.slice(2);
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const assetsDir = "apps/react-client/dist/assets";
const assets = Object.fromEntries(
  fs.readdirSync(assetsDir).sort().map((name) => [name, hash(path.join(assetsDir, name))]),
);
const manifest = {
  campaign: "T-7 — base caliente",
  capturedAt: new Date().toISOString(),
  commit: fs.readFileSync(path.join(dir, "commit.txt"), "utf8").trim(),
  loadThreshold: 4.0,
  platform: os.platform(),
  arch: os.arch(),
  cpuModel: os.cpus()[0]?.model,
  cpuCount: os.cpus().length,
  totalMemBytes: os.totalmem(),
  distAssetsSha256: assets,
  distAssetsDigest: crypto.createHash("sha256").update(JSON.stringify(assets)).digest("hex"),
};
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
JS

# --- Campaña ------------------------------------------------------------
LOG "Corriendo tests/perf/hot-baseline-attribution.spec.ts (12 corridas: P1/P2 × NER on/off × 3, alternadas)..."
ANONLY_HOT_BASELINE_OUTPUT_DIR="$RUN_DIR" \
  pnpm exec playwright test --config=playwright.perf.config.ts \
  tests/perf/hot-baseline-attribution.spec.ts --workers=1 --retries=0 \
  >"$RUN_DIR/playwright.log" 2>&1
PLAYWRIGHT_STATUS=$?
LOG "Playwright terminó con status $PLAYWRIGHT_STATUS (ver $RUN_DIR/playwright.log)."

# --- Agregación -----------------------------------------------------------
LOG "Agregando reportes..."
pnpm tsx tests/perf/support/aggregateHotBaselineReports.ts "$RUN_DIR" >"$RUN_DIR/aggregate.log" 2>&1
AGGREGATE_STATUS=$?
if [[ "$AGGREGATE_STATUS" -ne 0 ]]; then
  LOG "El agregador falló (ver $RUN_DIR/aggregate.log)."
fi

LOG "Campaña terminada: $RUN_DIR (playwright status=$PLAYWRIGHT_STATUS, agregador status=$AGGREGATE_STATUS)."
exit "$PLAYWRIGHT_STATUS"
