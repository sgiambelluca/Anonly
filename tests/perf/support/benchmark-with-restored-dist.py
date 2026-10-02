#!/usr/bin/env python3
"""Build and benchmark, then restore ignored renderer/shell dist trees."""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DIST_DIRS = (Path("apps/react-client/dist"), Path("apps/desktop-shell/dist"))


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="anonly-regex-dist-") as temp_name:
        backup_root = Path(temp_name)
        existed: set[Path] = set()
        for relative in DIST_DIRS:
            source = ROOT / relative
            if source.exists():
                existed.add(relative)
                shutil.copytree(source, backup_root / relative)

        try:
            build_environment = {
                key: value
                for key, value in os.environ.items()
                if key not in ("ANONLY_REAL_DOC_R1", "ANONLY_REAL_DOC_R2")
            }
            build_environment["VITE_E2E"] = "1"
            build_commands = (
                ("pnpm", "--filter", "@anonly/react-client", "build"),
                ("pnpm", "--filter", "@anonly/desktop-shell", "build"),
            )
            for command in build_commands:
                result = subprocess.run(command, cwd=ROOT, env=build_environment, check=False)
                if result.returncode != 0:
                    return result.returncode
            result = subprocess.run(
                ("bash", "tests/perf/run-regex-real-docs.sh"),
                cwd=ROOT,
                env=dict(os.environ),
                check=False,
            )
            if result.returncode != 0:
                return result.returncode
            return 0
        finally:
            for relative in DIST_DIRS:
                destination = ROOT / relative
                if destination.exists():
                    shutil.rmtree(destination)
                if relative in existed:
                    shutil.copytree(backup_root / relative, destination)


if __name__ == "__main__":
    raise SystemExit(main())
