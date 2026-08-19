#!/usr/bin/env bash
# Capture the current Harness desktop window at its on-screen size.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=capture-lib.sh
source "$ROOT/scripts/capture-lib.sh"

OUT="${HARNESS_CAPTURE_OUT:-$ROOT/tmp/ui-shots/window.png}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: capture:window requires macOS (screencapture)." >&2
  exit 1
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<EOF
Usage: $(basename "$0")

Captures the on-screen Harness / Harness Dev window to:
  $OUT

Requires Screen Recording permission for the terminal host.

Env:
  HARNESS_CAPTURE_OUT  Output PNG path (default: tmp/ui-shots/window.png)
EOF
  exit 0
fi

capture_harness_window_to "$OUT"
