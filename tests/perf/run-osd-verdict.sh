#!/usr/bin/env bash
set -uo pipefail
export LC_ALL=C LANG=C

# M-O1 y M-O2 (docs/roadmap/hardening/Confianza_Cierre_2026-10-08.md, Frente 3): qué entrega la cadena de ADR-190
# cuando el OSD afirma un ángulo equivocado sobre una página con poco texto, y lo que falta medir antes de
# enmendarla. Cinco observaciones por página (producción y un veredicto forzado a cada ángulo), una instancia
# fría de Electron por observación, con el OCR real. Corre en Windows nativo (Git Bash). No cambia producto: es
# un runner propio sobre el preámbulo común de las campañas.
#
#   ANONLY_OSD_VERDICT_SET=m1 (por defecto): 140 PDF escaneados sintéticos (los 76 de la campaña de recuperación
#     de ADR-190 y 64 de página escasa), 700 observaciones. Solo sintéticos: no usa ANONLY_REAL_DOC_*.
#   ANONLY_OSD_VERDICT_SET=m3 (M-O3): el peor caso de tiempo y memoria si todas las páginas de un escaneo se leen en
#     los cuatro ángulos. Con el instrumento de memory.spec.ts (pico M2 de ADR-146, en frío y en caliente) sobre R1
#     (ANONLY_REAL_DOC_R1, entero), R4 rasterizado a 300 dpi (ANONLY_REAL_DOC_R4), P2 y P2 con ruido, en los brazos
#     A, A0, B y C, tres repeticiones: 30 corridas, que se reparten en tandas por corrida (LIMIT cuenta corridas).
#   ANONLY_OSD_VERDICT_SET=m2: ruido (24 PDF), margen (24 PDF) y las páginas de los documentos reales de
#     ANONLY_REAL_DOC_R1 a R4 (hasta 81), 645 observaciones. Los reales entran SOLO por esas variables: se
#     arman en memoria (nada se escribe a disco) y el registro de una página real no lleva texto. Si una variable
#     no está definida, ese documento no se mide y el manifiesto lo dice. Las rutas no se loguean.
#
# Una llamada no alcanza para todo (unos 4 a 8 s cada observación): el runner es REANUDABLE. Cada llamada hace una
# tanda de hasta ANONLY_OSD_VERDICT_LIMIT observaciones (80 por defecto) y se vuelve a lanzar con la misma
# carpeta de salida hasta que el resumen diga COMPLETA:
#
#   export ANONLY_OSD_VERDICT_OUTPUT_DIR=.measure/osd-verdict/<fecha>
#   ./tests/perf/run-osd-verdict.sh     # repetir
#
# Cada llamada reconstruye (VITE_E2E=1) y exige el mismo digest del dist, el mismo commit, el mismo árbol de
# producto (incluida, si el producto está sin commitear, la identidad de `product-tree.identity.sha256` con sus
# archivos sin trackear) y el mismo arnés que la primera; si algo difiere, aborta sin medir.
#   ANONLY_OSD_VERDICT_ONLY    expresión regular sobre la clave del PDF (humo: '^(N7|two-lines)-300-')
#   ANONLY_OSD_VERDICT_LIMIT   tope de observaciones por llamada (0: sin tope)
#   ANONLY_CAMPAIGN_ALLOW_UNCOMMITTED_PRODUCT=1   mide un producto sin commitear (corrida provisional)
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
# shellcheck source=support/ocr-pool-platform.sh
source "$ROOT_DIR/tests/perf/support/ocr-pool-platform.sh"
PLATFORM="$(detect_platform)"
RUN_DIR="${ANONLY_OSD_VERDICT_OUTPUT_DIR:-.measure/osd-verdict/$(date -u +%Y%m%dT%H%M%SZ)}"
# shellcheck source=support/ocr-campaign-common.sh
source "$ROOT_DIR/tests/perf/support/ocr-campaign-common.sh"

LIMIT="${ANONLY_OSD_VERDICT_LIMIT:-80}"
ONLY="${ANONLY_OSD_VERDICT_ONLY:-}"
SET="${ANONLY_OSD_VERDICT_SET:-m1}"
case "$SET" in
  m1)
    SPEC="tests/perf/osd-verdict.spec.ts"
    OPT_IN_VAR="ANONLY_OSD_VERDICT"
    SUMMARY_CLI="tests/perf/support/summarizeOsdVerdictCli.ts"
    TITLE="M-O1"
    ;;
  m2)
    SPEC="tests/perf/osd-verdict-m2.spec.ts"
    OPT_IN_VAR="ANONLY_OSD_VERDICT_M2"
    SUMMARY_CLI="tests/perf/support/summarizeOsdVerdictM2Cli.ts"
    TITLE="M-O2"
    ;;
  m3)
    SPEC="tests/perf/osd-verdict-m3.spec.ts"
    OPT_IN_VAR="ANONLY_OSD_VERDICT_M3"
    SUMMARY_CLI="tests/perf/support/summarizeOsdVerdictM3Cli.ts"
    TITLE="M-O3"
    ;;
  *) echo "ANONLY_OSD_VERDICT_SET inválido: $SET (m1, m2 o m3)" >&2; exit 1 ;;
esac

# Los archivos de identidad que se comparan entre tandas. `product-tree.identity.sha256` existe solo con el
# producto sin commitear (ANONLY_CAMPAIGN_ALLOW_UNCOMMITTED_PRODUCT=1): incluye los archivos sin trackear de
# packages/ y apps/, que `git diff` no ve. Si una tanda lo tiene y la otra no, también es una diferencia.
IDENTITY_FILES=(commit.txt product-tree.diff.sha256 product-tree.identity.sha256 tests-tree.diff.sha256 tests-untracked.sha256)

RESUMING=0
# La identidad de la PRIMERA tanda queda en first/: las siguientes la comparan con ella y nunca la tocan.
FIRST_DIR="$RUN_DIR/first"
if [[ -e "$RUN_DIR" ]]; then
  # Una tanda siguiente: no se pisa nada, se hereda la identidad de la primera y se compara.
  RESUMING=1
  [[ -f "$RUN_DIR/commit.txt" && -f "$RUN_DIR/client-dist.digest" ]] || { echo "La carpeta $RUN_DIR existe pero no es de esta campaña." >&2; exit 1; }
  trap campaign_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ ! -d "$FIRST_DIR" ]]; then
    # Carpeta de una versión anterior del runner: lo guardado es lo de su primera tanda.
    mkdir -p "$FIRST_DIR"
    for name in "${IDENTITY_FILES[@]}" client-dist.digest; do cp "$RUN_DIR/$name" "$FIRST_DIR/$name" 2>/dev/null || true; done
  fi
  # Lo que depende del estado del árbol se vuelve a escribir en este snapshot (o no existe si el árbol está limpio).
  rm -f "$RUN_DIR/product-tree.identity.sha256" "$RUN_DIR/product-untracked.sha256" "$RUN_DIR/product-uncommitted-status.txt"
else
  campaign_init
fi

# Los documentos reales llegan por variables de entorno (ANONLY_REAL_DOC_R1 a R4); Node lee C:/..., no /c/...
# Las rutas no se loguean ni se escriben en ninguna parte.
if [[ "$SET" == "m2" || "$SET" == "m3" ]]; then
  for doc in R1 R2 R3 R4; do export_real_doc_native "ANONLY_REAL_DOC_$doc"; done
fi

campaign_preflight
campaign_snapshot
if [[ "$RESUMING" == "1" ]]; then
  for name in "${IDENTITY_FILES[@]}"; do
    first_exists=0; now_exists=0
    [[ -f "$FIRST_DIR/$name" ]] && first_exists=1
    [[ -f "$RUN_DIR/$name" ]] && now_exists=1
    if [[ "$first_exists" != "$now_exists" ]] || { [[ "$now_exists" == "1" ]] && ! cmp -s "$RUN_DIR/$name" "$FIRST_DIR/$name"; }; then
      fail "$name difiere del de la primera tanda: el árbol o el arnés cambiaron; la campaña no es comparable."
    fi
  done
else
  mkdir -p "$FIRST_DIR"
  for name in "${IDENTITY_FILES[@]}"; do cp "$RUN_DIR/$name" "$FIRST_DIR/$name" 2>/dev/null || true; done
fi
log "$TITLE: tanda $([[ "$RESUMING" == "1" ]] && echo siguiente || echo primera); tope=$LIMIT; filtro='${ONLY}'."
campaign_build
if [[ ! -f "$FIRST_DIR/client-dist.digest" ]]; then
  cp "$RUN_DIR/client-dist.digest" "$FIRST_DIR/client-dist.digest"
elif ! cmp -s "$RUN_DIR/client-dist.digest" "$FIRST_DIR/client-dist.digest"; then
  fail "el dist del cliente difiere del de la primera tanda; la campaña no es comparable."
fi

ID="tanda-$(date -u +%Y%m%dT%H%M%SZ)"
capture_pressure "before-$ID"
guard_begin "$ID"
if env "$OPT_IN_VAR=1" ANONLY_OSD_VERDICT_OUTPUT_DIR="$RUN_DIR" \
  ANONLY_OSD_VERDICT_LIMIT="$LIMIT" ANONLY_OSD_VERDICT_ONLY="$ONLY" \
  pnpm exec playwright test --config=playwright.perf.config.ts "$SPEC" \
    --workers=1 --retries=0 >>"$RUN_DIR/playwright.log" 2>&1; then
  log "OK $ID"
else
  log "FALLO $ID (las observaciones que fallaron quedan en *-failure-*.json y se reintentan una vez)"
  FAILED=$((FAILED + 1))
fi
capture_pressure "after-$ID"
guard_end "$ID" || FAILED=$((FAILED + 1))
campaign_final_checks

summary_out="$(pnpm exec tsx "$SUMMARY_CLI" "$RUN_DIR")"
summary_status=$?
RESULT_LINE="$(printf '%s\n' "$summary_out" | tail -n 1)"
if [[ "$summary_status" -eq 0 ]]; then
  printf '%s\n' "$summary_out"
elif [[ "$summary_status" -ne 1 ]]; then
  FAILED=$((FAILED + 1))
fi

log "Tanda terminada: $RUN_DIR; fallidas=$FAILED; $RESULT_LINE. Sin cambios de producto ni defaults."
exit "$((FAILED > 0))"
