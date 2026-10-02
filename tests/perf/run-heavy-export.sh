#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

if [[ "${ANONLY_HEAVY_EXPORT:-}" != "1" ]]; then
  echo "Run explicitly with ANONLY_HEAVY_EXPORT=1 tests/perf/run-heavy-export.sh" >&2
  exit 2
fi

VITE_E2E=1 pnpm --filter @anonly/react-client build
pnpm --filter @anonly/desktop-shell build
pnpm exec playwright test --config=playwright.perf.config.ts tests/perf/heavy-export-memory.spec.ts
