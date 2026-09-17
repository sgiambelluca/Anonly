#!/usr/bin/env bash
set -euo pipefail

# Campaña literal de docs/roadmap/Margenes_Menos_Pixeles_Implementacion_Handoff.md §2.2.
# Cada sesión tiene su build.log, playwright.log, manifest.json y session.json.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"
CAMPAIGN_ROOT="${ROOT_DIR}/.measure/margenes-i1-v2"
CAMPAIGN_DIR="${ANONLY_MARGIN_I1_V2_OUTPUT_DIR:-${CAMPAIGN_ROOT}/$(date -u +%Y%m%dT%H%M%SZ)}"
BEFORE_COMMIT="3650ce7"
AFTER_COMMIT="b76d18c"
STATE="after"
INSTRUMENTED=0
STATE_PATCH="${CAMPAIGN_DIR}/i1-state.patch"
INSTRUMENT_PATCH="${CAMPAIGN_DIR}/instrument.patch"
if [[ -e "$CAMPAIGN_DIR" ]]; then
  echo "La evidencia ya existe; se requiere un directorio nuevo: $CAMPAIGN_DIR" >&2
  exit 1
fi
mkdir -p "$CAMPAIGN_DIR"

if ! git diff --quiet -- packages apps; then
  echo "Cambios tracked en packages/apps; no se puede preservar el árbol." >&2
  exit 1
fi
git diff --binary "$BEFORE_COMMIT" "$AFTER_COMMIT" -- packages/anonymization-core/ocr-engine > "$STATE_PATCH"

SNAPSHOT_DIR="${CAMPAIGN_DIR}/tree-snapshot"
mkdir -p "$SNAPSHOT_DIR"
while IFS= read -r path; do
  mkdir -p "${SNAPSHOT_DIR}/$(dirname "$path")"
  cp "$path" "${SNAPSHOT_DIR}/$path"
done < <(git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT" -- packages/anonymization-core/ocr-engine)
for path in apps/react-client/src/core-adapter/index.ts pnpm-lock.yaml assets.lock.json; do
  mkdir -p "${SNAPSHOT_DIR}/$(dirname "$path")"
  cp "$path" "${SNAPSHOT_DIR}/$path"
done
(cd "$SNAPSHOT_DIR" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256) > "$CAMPAIGN_DIR/snapshot.sha256"

restore_tree() {
  set +e
  local restore_status=0
  if (( INSTRUMENTED == 1 )); then
    git apply -R "$INSTRUMENT_PATCH"
    INSTRUMENTED=0
  fi
  if [[ "$STATE" == before ]]; then
    git apply "$STATE_PATCH"
    STATE=after
  fi
  while IFS= read -r path; do
    cmp -s "$SNAPSHOT_DIR/$path" "$path" || restore_status=1
  done < <(git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT" -- packages/anonymization-core/ocr-engine)
  for path in apps/react-client/src/core-adapter/index.ts pnpm-lock.yaml assets.lock.json; do
    cmp -s "$SNAPSHOT_DIR/$path" "$path" || restore_status=1
  done
  if (( restore_status != 0 )); then
    echo "ERROR: restore exacto falló; no se declara campaña completada." >&2
    trap - EXIT
    exit 1
  fi
}
trap restore_tree EXIT INT TERM

apply_instrument() {
  # Instrumento descartable: cuenta cada llamada a recognizeRotatedMargins y
  # la transporta en KernelOcrResult hacia ctx.cache. Se elimina por trap.
  local base_dir="${CAMPAIGN_DIR}/instrument-base-${STATE}"
  mkdir -p "$base_dir"
  cp packages/anonymization-core/ocr-engine/src/worker/kernel.ts "$base_dir/kernel.ts"
  cp packages/anonymization-core/ocr-engine/src/ocr.engine.ts "$base_dir/ocr.engine.ts"
  local kernel_path="packages/anonymization-core/ocr-engine/src/worker/kernel.ts"
  local engine_path="packages/anonymization-core/ocr-engine/src/ocr.engine.ts"
  perl -0pi -e 's/(async function recognizeRotatedMargins\(params: \{.*?\n\}\)): Promise<Word\[\]> \{/$1: Promise<{ readonly words: Word[]; readonly passCount: number }> {/s' "$kernel_path"
  perl -0pi -e 's/if \(stripWidth <= 0\) return \[\];/if (stripWidth <= 0) return { words: [], passCount: 0 };/g; s/(const found: Word\[\] = \[\];)/$1\n  let passCount = 0;/; s/(for \(const rotation of rotations\) \{)/$1\n      passCount += 1;/; s/return found;/return { words: found, passCount };/g; s/(export interface KernelOcrResult \{\n  readonly words: ReadonlyArray<Word>;\n  readonly confidence: number;\n)/$1  readonly marginPassCount?: number;\n/; s/\{ words: \[\.\.\.words, \.\.\.rotated\], confidence \}/\{ words: [...words, ...rotated.words], confidence, marginPassCount: rotated.passCount \}/g' "$kernel_path"
  perl -0pi -e 's/return isRecord\(value\) && isWordArray\(value\.words\) && typeof value\.confidence === "number";/return isRecord(value) \&\& isWordArray(value.words) \&\& typeof value.confidence === "number" \&\& (value.marginPassCount === undefined || (typeof value.marginPassCount === "number" \&\& Number.isInteger(value.marginPassCount) \&\& value.marginPassCount >= 0));/; s/(const \{ words, confidence \} = result;)/$1\n        if (result.marginPassCount !== undefined) ctx.cache.set("margin-pass-count:" + documentId + ":" + pageIndex, result.marginPassCount);/' "$engine_path"
  {
    diff -u --label "a/$kernel_path" --label "b/$kernel_path" "$base_dir/kernel.ts" "$kernel_path" || true
    diff -u --label "a/$engine_path" --label "b/$engine_path" "$base_dir/ocr.engine.ts" "$engine_path" || true
  } > "$INSTRUMENT_PATCH"
  INSTRUMENTED=1
}

remove_instrument() {
  if (( INSTRUMENTED == 1 )); then
    git apply -R "$INSTRUMENT_PATCH"
    local base_dir="${CAMPAIGN_DIR}/instrument-base-${STATE}"
    cmp -s "$base_dir/kernel.ts" packages/anonymization-core/ocr-engine/src/worker/kernel.ts
    cmp -s "$base_dir/ocr.engine.ts" packages/anonymization-core/ocr-engine/src/ocr.engine.ts
    INSTRUMENTED=0
  fi
}

set_state() {
  [[ "$1" == "$STATE" ]] && return
  if [[ "$1" == before ]]; then git apply -R "$STATE_PATCH"; STATE=before; else git apply "$STATE_PATCH"; STATE=after; fi
}

write_manifest() {
  local state="$1" case_name="$2" session_dir="$3"
  node - "$state" "$case_name" "$session_dir" "$BEFORE_COMMIT" "$AFTER_COMMIT" <<'NODE'
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const [state,caseName,sessionDir,before,after]=process.argv.slice(2),root=process.cwd();
const hash=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const fixture=caseName==="p2"?".measure/fixtures/p2-scanned-50p-351fc4d31cd80ce0.pdf":".measure/fixtures/qa-stamp-scanned-4ce6e18e6411309f.pdf";
const source=["packages/anonymization-core/ocr-engine/src/worker/kernel.ts","packages/anonymization-core/ocr-engine/src/ocr.engine.ts","apps/react-client/src/core-adapter/index.ts"];
const assetsDir=path.join(root,"apps/react-client/dist/assets"),assets={};
for(const f of fs.readdirSync(assetsDir).sort())assets[f]=hash(path.join(assetsDir,f));
const out={campaign:"20260917-reproducible",state,baseCommit:state==="before"?before:after,fixture:{path:fixture,sha256:hash(path.join(root,fixture))},sourceSha256:Object.fromEntries(source.map(p=>[p,hash(path.join(root,p))])),distAssetsSha256:assets,distAssetsDigest:crypto.createHash("sha256").update(JSON.stringify(assets)).digest("hex"),lockSha256:hash(path.join(root,"pnpm-lock.yaml")),assetsLockSha256:hash(path.join(root,"assets.lock.json")),capturedAt:new Date().toISOString()};
fs.writeFileSync(path.join(sessionDir,"manifest.json"),JSON.stringify(out,null,2));
NODE
}

run_session() {
  local state="$1" case_name="$2" label="$3" dir="$CAMPAIGN_DIR/$3"
  mkdir -p "$dir"
  set_state "$state"
  apply_instrument
  if pgrep -f '[p]laywright test --config' >/dev/null; then echo "Playwright activo" >&2; exit 1; fi
  VITE_E2E=1 pnpm --filter @anonly/react-client build >"$dir/build.log" 2>&1
  pnpm --filter @anonly/desktop-shell build >>"$dir/build.log" 2>&1
  write_manifest "$state" "$case_name" "$dir"
  ANONLY_MARGIN_I1_ENABLED=1 ANONLY_MARGIN_I1_CASE="$case_name" ANONLY_MARGIN_I1_OUTPUT_DIR="$dir" \
    pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/margin-i1-campaign.spec.ts --workers=1 --retries=0 >"$dir/playwright.log" 2>&1
  remove_instrument
}

if [[ "${MARGIN_I1_SELF_TEST:-0}" == 1 ]]; then
  set_state after; apply_instrument; remove_instrument
  set_state before; apply_instrument; remove_instrument
  set_state after
  echo "Instrument roundtrip AFTER/BEFORE OK"
  exit 0
fi

run_session after p2 after-p2-b1
run_session before p2 before-p2-a1
run_session before p2 before-p2-a2
run_session after p2 after-p2-b2
run_session after p2 after-p2-b3
run_session before p2 before-p2-a3
run_session after qastamp after-qastamp
run_session before qastamp before-qastamp
echo "Campaña v2 completada: $CAMPAIGN_DIR"
