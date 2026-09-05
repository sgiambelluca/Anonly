#!/usr/bin/env bash
set -euo pipefail

# Compila el bridge N-API en las dos arquitecturas que soporta macOS y las
# combina en un único Mach-O universal. Electron Builder puede construir el
# bundle universal, pero no transforma addons nativos que ya existen en el
# árbol de recursos: si se compila una sola vez, el bridge queda atado a la
# arquitectura del runner.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="$NATIVE_DIR/build/Release/sparkle_bridge.node"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

build_arch() {
  local arch="$1"
  node-gyp rebuild \
    --directory="$NATIVE_DIR" \
    --target=44.2.0 \
    --dist-url=https://electronjs.org/headers \
    --arch="$arch"
  cp "$OUTPUT" "$TMP_DIR/sparkle_bridge-$arch.node"
}

build_arch arm64
build_arch x64

mkdir -p "$(dirname "$OUTPUT")"
lipo -create \
  "$TMP_DIR/sparkle_bridge-arm64.node" \
  "$TMP_DIR/sparkle_bridge-x64.node" \
  -output "$OUTPUT"

ARCHES="$(lipo -archs "$OUTPUT")"
has_arm64=false
has_x64=false
for arch in $ARCHES; do
  case "$arch" in
    arm64) has_arm64=true ;;
    x86_64) has_x64=true ;;
  esac
done
if [ "$has_arm64" != true ] || [ "$has_x64" != true ]; then
  echo "sparkle_bridge.node no es universal: $ARCHES" >&2
  exit 1
fi
echo "sparkle_bridge.node universal: $ARCHES"
