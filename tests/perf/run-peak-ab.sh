#!/usr/bin/env bash
# Campaña de reducción de pico (docs/roadmap/memoria/Reduccion_De_Pico_Nube_2026-11.md):
# A/B intercalado ABBA entre dos brazos de support/peakArmsTransform.ts
# (base, c1, c2, c4, head). Los fuentes de packages/ y apps/ no se tocan: cada
# brazo es un renderer construido aparte por support/peakArmsBuildCli.ts y
# copiado a apps/react-client/dist antes de su corrida. El dist original se
# restaura al salir, pase lo que pase.
#
# Variables:
#   ANONLY_AB_CONTROL    brazo de control (default base)
#   ANONLY_AB_CANDIDATE  brazo candidato (default head)
#   ANONLY_AB_ROUNDS     rondas ABBA (default 3 → 12 corridas)
#   ANONLY_AB_SPEC       spec de Playwright (default tests/perf/memory.spec.ts)
#   ANONLY_AB_GREP       filtro --grep (default "P2 —")
#   ANONLY_AB_OUT        directorio de salida (default .measure/peak-ab/<UTC>-<control>-<candidato>)
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

CONTROL="${ANONLY_AB_CONTROL:-base}"
CANDIDATE="${ANONLY_AB_CANDIDATE:-head}"
ROUNDS="${ANONLY_AB_ROUNDS:-3}"
SPEC="${ANONLY_AB_SPEC:-tests/perf/memory.spec.ts}"
GREP="${ANONLY_AB_GREP:-P2 —}"
RUN_DIR="${ANONLY_AB_OUT:-.measure/peak-ab/$(date -u +%Y%m%dT%H%M%SZ)-$CONTROL-$CANDIDATE}"
DIST="apps/react-client/dist"

valid_arm() { [[ "$1" =~ ^(base|c1|c2|c4|head)$ ]]; }
valid_arm "$CONTROL" || { echo "pico: ANONLY_AB_CONTROL inválido" >&2; exit 1; }
valid_arm "$CANDIDATE" || { echo "pico: ANONLY_AB_CANDIDATE inválido" >&2; exit 1; }
[[ "$CONTROL" != "$CANDIDATE" ]] || { echo "pico: control y candidato son el mismo brazo" >&2; exit 1; }
[[ "$ROUNDS" =~ ^[1-9][0-9]*$ ]] || { echo "pico: ANONLY_AB_ROUNDS inválido" >&2; exit 1; }
[[ ! -e "$RUN_DIR" ]] || { echo "pico: $RUN_DIR ya existe" >&2; exit 1; }
[[ -d "$DIST" ]] || { echo "pico: falta $DIST; construir el renderer antes" >&2; exit 1; }
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
dir_digest() {
  (cd "$1" && find . -type f -print0 | sort -z | xargs -0 "${SHA256[@]}" | "${SHA256[@]}" | cut -d' ' -f1)
}

{
  echo "commit=$(git rev-parse HEAD)"
  echo "dirty_packages_apps=$(git status --porcelain -- packages apps | wc -l)"
  echo "control=$CONTROL candidate=$CANDIDATE"
  echo "spec=$SPEC grep=$GREP rounds=$ROUNDS"
  echo "uname=$(uname -a)"
  echo "cpus=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo unknown) mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo 2>/dev/null || echo unknown)"
  echo "shell_dist=$(dir_digest apps/desktop-shell/dist)"
  echo "started=$(date -u +%FT%TZ)"
} > "$RUN_DIR/manifest.txt"
SHELL_DIGEST="$(dir_digest apps/desktop-shell/dist)"

for arm in "$CONTROL" "$CANDIDATE"; do
  pnpm exec tsx tests/perf/support/peakArmsBuildCli.ts "$arm" "$RUN_DIR/$arm/dist" \
    > "$RUN_DIR/build-$arm.log" 2>&1
  dir_digest "$RUN_DIR/$arm/dist" > "$RUN_DIR/$arm/dist.sha256"
done

slot=0
for round in $(seq 1 "$ROUNDS"); do
  for arm in "$CONTROL" "$CANDIDATE" "$CANDIDATE" "$CONTROL"; do
    slot=$((slot + 1))
    tag="$(printf '%02d' "$slot")-r${round}-${arm}"
    rm -rf "$DIST"
    cp -r "$RUN_DIR/$arm/dist" "$DIST"
    # Identidad por corrida: el renderer copiado es el del brazo y el shell no cambió.
    [[ "$(dir_digest "$DIST")" == "$(cat "$RUN_DIR/$arm/dist.sha256")" ]] \
      || { echo "pico: el dist de $tag no coincide con su brazo" >&2; exit 1; }
    [[ "$(dir_digest apps/desktop-shell/dist)" == "$SHELL_DIGEST" ]] \
      || { echo "pico: apps/desktop-shell/dist cambió durante la campaña" >&2; exit 1; }
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
    reports=0
    for report in .measure/memory-*.json; do
      [[ -e "$report" ]] || continue
      cp "$report" "$RUN_DIR/runs/$tag-$(basename "$report")"
      reports=$((reports + 1))
    done
    echo "$tag exit=$status reports=$reports end $(date -u +%FT%TZ)" >> "$RUN_DIR/manifest.txt"
  done
done
echo "finished=$(date -u +%FT%TZ)" >> "$RUN_DIR/manifest.txt"
echo "pico: salida en $RUN_DIR"
