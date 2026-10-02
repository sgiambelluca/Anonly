#!/usr/bin/env python3
"""Run one command in an isolated process group with a hard wall-clock limit."""

import os
import signal
import subprocess
import sys


def main() -> int:
    timeout_seconds = int(sys.argv[1])
    command = sys.argv[2:]
    if not command:
        raise SystemExit("command required")
    process = subprocess.Popen(command, start_new_session=True)
    try:
        return process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
