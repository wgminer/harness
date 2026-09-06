#!/usr/bin/env bash
# Capture the Harness desktop window as the README hero image.
#
# Uses a throwaway profile (HARNESS_DATA_DIR) so real conversations never leak
# into media/hero.png. Requires macOS Screen Recording permission for the
# terminal / Cursor host that runs this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=capture-lib.sh
source "$ROOT/scripts/capture-lib.sh"

OUT="${HARNESS_HERO_OUT:-$ROOT/media/hero.png}"
PROFILE="${HARNESS_HERO_PROFILE:-$ROOT/media/.hero-profile}"
MAX_WAIT_SEC="${HARNESS_HERO_WAIT:-180}"
APP_BIN="${HARNESS_HERO_BIN:-}"

mkdir -p "$(dirname "$OUT")" "$PROFILE/local-data/app-state"

LAUNCH=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --launch) LAUNCH=1 ;;
    --keep) KEEP=1 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--launch] [--keep]

Captures a seeded Harness window to:
  $OUT

  --launch   Quit any running Harness, seed a demo profile, start the app, capture
  --keep     Leave the demo app running after capture

Env:
  HARNESS_HERO_OUT      Output path (default: media/hero.png)
  HARNESS_HERO_PROFILE  Throwaway profile dir (default: media/.hero-profile)
  HARNESS_HERO_WAIT     Seconds to wait for window (default: 180)
  HARNESS_HERO_BIN      Optional path to app binary (else npm run tauri dev)
EOF
      exit 0
      ;;
  esac
done

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
  if [[ -n "$APP_BIN" && -x "$APP_BIN" ]]; then
    HARNESS_DATA_DIR="$PROFILE" HARNESS_DISABLE_GLOBAL_HOTKEY=1 "$APP_BIN" \
      >/tmp/harness-capture-hero.log 2>&1 &
    APP_PID=$!
  else
    APP_PID="$(launch_harness_demo "$PROFILE" /tmp/harness-capture-hero.log)"
  fi

  if ! wait_for_harness_window "$MAX_WAIT_SEC"; then
    echo "error: Harness window did not appear within ${MAX_WAIT_SEC}s." >&2
    echo "Log: /tmp/harness-capture-hero.log" >&2
    exit 1
  fi
else
  if ! resolve_window_id >/dev/null 2>&1; then
    echo "error: no Harness window found." >&2
    echo "Re-run with --launch (builds/starts the app), or open Harness first." >&2
    echo "Log: /tmp/harness-capture-hero.log" >&2
    exit 1
  fi
fi

bring_to_front
echo "Resizing window to fill built-in display…"
FILL_SIZE="$(fill_builtin_screen || true)"
if [[ -n "$FILL_SIZE" ]]; then
  echo "Target size (backing pixels): $FILL_SIZE"
else
  echo "warning: could not resize window (Accessibility permission may be required)." >&2
fi
sleep 1
bring_to_front

WID="$(resolve_window_id || true)"
if [[ -z "${WID:-}" ]]; then
  echo "error: lost Harness window after resize." >&2
  exit 1
fi

capture_window_id_to "$WID" "$OUT"

SITE_HERO="$ROOT/site/assets/hero.png"
mkdir -p "$(dirname "$SITE_HERO")"
cp "$OUT" "$SITE_HERO"
echo "Synced $SITE_HERO"
