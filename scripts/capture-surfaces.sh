#!/usr/bin/env bash
# Capture Harness desktop surfaces via sidebar navigation (demo profile optional).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=capture-lib.sh
source "$ROOT/scripts/capture-lib.sh"

OUT_DIR="${HARNESS_CAPTURE_SURFACES_DIR:-$ROOT/tmp/ui-shots/surfaces}"
PROFILE="${HARNESS_CAPTURE_PROFILE:-$ROOT/media/.hero-profile}"
LOG="${HARNESS_CAPTURE_LOG:-/tmp/harness-capture-surfaces.log}"
MAX_WAIT_SEC="${HARNESS_CAPTURE_WAIT:-180}"
APP_BIN="${HARNESS_CAPTURE_BIN:-}"

LAUNCH=0
KEEP=0
FAILURES=0

for arg in "$@"; do
  case "$arg" in
    --launch) LAUNCH=1 ;;
    --keep) KEEP=1 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--launch] [--keep]

Captures sidebar-navigated surfaces to:
  $OUT_DIR/{compose,chat-thread,search,tasks,settings}.png

  --launch   Quit Harness, seed demo profile, start app, then capture
  --keep     Leave the demo app running after capture

Requires Screen Recording (+ Accessibility for sidebar clicks).

Env:
  HARNESS_CAPTURE_SURFACES_DIR  Output directory
  HARNESS_CAPTURE_PROFILE       Throwaway profile dir
  HARNESS_CAPTURE_WAIT          Seconds to wait for window (default: 180)
  HARNESS_CAPTURE_BIN           Optional path to app binary
EOF
      exit 0
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: capture:surfaces requires macOS." >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$PROFILE/local-data/app-state"

capture_surface() {
  local name="$1"
  local out="$OUT_DIR/${name}.png"
  if capture_harness_window_to "$out"; then
    return 0
  fi
  FAILURES=$((FAILURES + 1))
  return 1
}

try_nav() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    sleep 1
    bring_to_front
    return 0
  fi
  echo "warning: could not navigate — $desc (Accessibility may be required)." >&2
  FAILURES=$((FAILURES + 1))
  return 1
}

APP_PID=""
cleanup() {
  if [[ "$KEEP" -eq 0 && -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    sleep 0.5
    quit_harness
  fi
}
trap cleanup EXIT

if [[ "$LAUNCH" -eq 1 ]]; then
  quit_harness
  seed_demo_profile "$PROFILE"
  echo "Starting Harness with demo profile…"
  APP_PID="$(launch_harness_demo "$PROFILE" "$LOG")"
  if ! wait_for_harness_window "$MAX_WAIT_SEC"; then
    echo "error: Harness window did not appear within ${MAX_WAIT_SEC}s." >&2
    echo "Log: $LOG" >&2
    exit 1
  fi
elif ! resolve_window_id >/dev/null 2>&1; then
  echo "error: no Harness window found. Re-run with --launch or open Harness first." >&2
  exit 1
fi

bring_to_front

echo "Capturing compose…"
capture_surface "compose" || true

echo "Opening demo conversation…"
if try_nav "open chat thread" click_sidebar_conversation "Voice-first capture notes"; then
  echo "Capturing chat-thread…"
  capture_surface "chat-thread" || true
fi

echo "Opening Search…"
if try_nav "Search" click_sidebar_button "Search"; then
  echo "Capturing search…"
  capture_surface "search" || true
fi

echo "Opening Tasks…"
if try_nav "Tasks" click_sidebar_button "Tasks"; then
  echo "Capturing tasks…"
  capture_surface "tasks" || true
fi

echo "Opening System settings…"
if try_nav "System" click_sidebar_button "System"; then
  echo "Capturing settings…"
  capture_surface "settings" || true
fi

echo "Surface captures written under $OUT_DIR"
if (( FAILURES > 0 )); then
  echo "Completed with $FAILURES navigation/capture warning(s)." >&2
  echo "Switch views manually and re-run npm run capture:window for a single shot." >&2
  exit 1
fi
