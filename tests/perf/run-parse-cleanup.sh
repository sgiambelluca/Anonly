#!/usr/bin/env bash
# C-1 (docs/roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md): A/B intercalado
# del cleanup de página en el parseo. Los fuentes de packages/ y apps/ no se
# tocan: cada brazo es un renderer construido aparte por
# support/parseCleanupBuildCli.ts y copiado a apps/react-client/dist antes de
# su corrida. El dist original se restaura al salir, pase lo que pase.
#
# Variables:
#   ANONLY_C1_ROUNDS  rondas ABBA (default 3 → 12 corridas)
#   ANONLY_C1_SPEC    spec de Playwright (default tests/perf/memory-attribution.spec.ts)
#   ANONLY_C1_GREP    filtro --grep (default "NER apagado")
#   ANONLY_C1_OUT     directorio de salida (default .measure/c1-parse-cleanup/<UTC>)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

ROUNDS="${ANONLY_C1_ROUNDS:-3}"
SPEC="${ANONLY_C1_SPEC:-tests/perf/memory-attribution.spec.ts}"
GREP="${ANONLY_C1_GREP:-NER apagado}"
RUN_DIR="${ANONLY_C1_OUT:-.measure/c1-parse-cleanup/$(date -u +%Y%m%dT%H%M%SZ)}"
DIST="apps/react-client/dist"

[[ "$ROUNDS" =~ ^[1-9][0-9]*$ ]] || { echo "C-1: ANONLY_C1_ROUNDS inválido" >&2; exit 1; }
[[ ! -e "$RUN_DIR" ]] || { echo "C-1: $RUN_DIR ya existe" >&2; exit 1; }
[[ -d "$DIST" ]] || { echo "C-1: falta $DIST; construir el renderer antes" >&2; exit 1; }
mkdir -p "$RUN_DIR/runs"

mkdir -p "$RUN_DIR/original"
cp -a "$DIST" "$RUN_DIR/original/dist"
restore() {
  rm -rf "$DIST"
  cp -a "$RUN_DIR/original/dist" "$DIST"
}
trap restore EXIT

# Sin array vacío: con `set -u`, el bash 3.2 de macOS trata "${a[@]}" vacío como no definido.
USE_XVFB=0
if [[ "$(uname -s)" == "Linux" && -z "${DISPLAY:-}" ]] && command -v xvfb-run >/dev/null; then
  USE_XVFB=1
fi
run_playwright() {
  if [[ "$USE_XVFB" == "1" ]]; then
    xvfb-run -a -s "-screen 0 1920x1080x24" "$@"
  else
    "$@"
  fi
}
# Mismo criterio que run-ab-intercalado.sh: sha256sum en Linux/Git Bash, shasum en macOS.
if command -v sha256sum >/dev/null; then
  SHA256=(sha256sum)
else
  SHA256=(shasum -a 256)
fi

{
  echo "commit=$(git rev-parse HEAD)"
  echo "dirty_packages_apps=$(git status --porcelain -- packages apps | wc -l)"
  echo "spec=$SPEC grep=$GREP rounds=$ROUNDS"
  echo "uname=$(uname -a)"
  echo "cpus=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo unknown) mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo unknown)"
  echo "started=$(date -u +%FT%TZ)"
} > "$RUN_DIR/manifest.txt"

for arm in A B; do
  pnpm exec tsx tests/perf/support/parseCleanupBuildCli.ts "$arm" "$RUN_DIR/$arm/dist" \
    > "$RUN_DIR/build-$arm.log" 2>&1
  (cd "$RUN_DIR/$arm/dist" && find . -type f -print0 | sort -z | xargs -0 "${SHA256[@]}" | "${SHA256[@]}" | cut -d' ' -f1) \
    > "$RUN_DIR/$arm/dist.sha256"
done

slot=0
for round in $(seq 1 "$ROUNDS"); do
  for arm in A B B A; do
    slot=$((slot + 1))
    tag="$(printf '%02d' "$slot")-r${round}-${arm}"
    rm -rf "$DIST"
    cp -r "$RUN_DIR/$arm/dist" "$DIST"
    # Los reportes que `writeReport` deja en .measure/ se apartan (no se borran)
    # para no mezclarlos con los de esta corrida.
    for stale in .measure/memory-*.json; do
      [[ -e "$stale" ]] || continue
      mkdir -p "$RUN_DIR/preexisting"
      mv "$stale" "$RUN_DIR/preexisting/$tag-$(basename "$stale")"
    done
    echo "$tag start $(date -u +%FT%TZ) load=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo ?)" >> "$RUN_DIR/manifest.txt"
    status=0
    run_playwright pnpm exec playwright test --config=playwright.perf.config.ts "$SPEC" \
      --grep "$GREP" --workers=1 --retries=0 > "$RUN_DIR/runs/$tag.log" 2>&1 || status=$?
    echo "$tag exit=$status end $(date -u +%FT%TZ)" >> "$RUN_DIR/manifest.txt"
    for report in .measure/memory-*.json; do
      [[ -e "$report" ]] || continue
      cp "$report" "$RUN_DIR/runs/$tag-$(basename "$report")"
    done
  done
done
echo "finished=$(date -u +%FT%TZ)" >> "$RUN_DIR/manifest.txt"
echo "C-1: salida en $RUN_DIR"
