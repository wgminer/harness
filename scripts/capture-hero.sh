#!/usr/bin/env bash
# Capture the Harness desktop window as the README hero image.
#
# Uses a throwaway profile (HARNESS_DATA_DIR) so real conversations never leak
# into media/hero.png. Requires macOS Screen Recording permission for the
# terminal / Cursor host that runs this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${HARNESS_HERO_OUT:-$ROOT/media/hero.png}"
PROFILE="${HARNESS_HERO_PROFILE:-$ROOT/media/.hero-profile}"
MAX_WAIT_SEC="${HARNESS_HERO_WAIT:-180}"
APP_BIN="${HARNESS_HERO_BIN:-}"

mkdir -p "$(dirname "$OUT")" "$PROFILE/local-data/app-state"

seed_demo_profile() {
  local state="$PROFILE/local-data/app-state"
  local settings_dir="$PROFILE/local-data/settings"
  local cid="conv_hero_demo"
  local now
  now="$(python3 -c 'import time; print(int(time.time()*1000))')"

  mkdir -p "$state" "$settings_dir"

  python3 - "$state" "$settings_dir" "$cid" "$now" <<'PY'
import json, sys
from pathlib import Path

state = Path(sys.argv[1])
settings_dir = Path(sys.argv[2])
cid = sys.argv[3]
now = int(sys.argv[4])
state.mkdir(parents=True, exist_ok=True)
settings_dir.mkdir(parents=True, exist_ok=True)

def write_messages(path: Path, pairs: list[tuple[str, str]]) -> None:
    msgs = [{"role": role, "content": content} for role, content in pairs]
    path.write_text(json.dumps(msgs, indent=2) + "\n")

conversations = {
    cid: {
        "createdAt": now - 3600_000,
        "hasMessages": True,
        "title": "Voice-first capture notes",
        "titleSource": "user",
    },
    "conv_hero_memory": {
        "createdAt": now - 7200_000,
        "hasMessages": True,
        "title": "Memory and context assembly",
        "titleSource": "user",
    },
    "conv_hero_sync": {
        "createdAt": now - 86400_000,
        "hasMessages": True,
        "title": "Desktop to phone sync",
        "titleSource": "user",
    },
    "conv_hero_notes": {
        "createdAt": now - 172800_000,
        "hasMessages": True,
        "title": "Notes as a writing surface",
        "titleSource": "user",
    },
    "conv_hero_tasks": {
        "createdAt": now - 259200_000,
        "hasMessages": True,
        "title": "Weekend task triage",
        "titleSource": "user",
    },
    "conv_hero_qa": {
        "createdAt": now - 1800_000,
        "hasMessages": True,
        "hasAssistantReply": True,
        "title": "Stay here or use the browser",
        "titleSource": "user",
        "chatMode": "qa",
    },
}
(state / "conversations.json").write_text(json.dumps(conversations, indent=2) + "\n")

write_messages(
    state / f"messages_{cid}.json",
    [
        (
            "user",
            "What should a personal LLM harness optimize for if it is not engagement?",
        ),
        (
            "assistant",
            (
                "Control and legibility.\n\n"
                "- Keep data on disk you can leave with.\n"
                "- Show how context was assembled for each reply.\n"
                "- Prefer tools you can inspect over a persona you cannot.\n\n"
                "Voice-first capture helps when the keyboard is the wrong interface; "
                "the transcript should stay yours."
            ),
        ),
    ],
)
write_messages(
    state / "messages_conv_hero_memory.json",
    [
        ("user", "How does context get assembled for a reply?"),
        ("assistant", "Memories, temporal notes, and the system prompt — then the visible thread."),
    ],
)
write_messages(
    state / "messages_conv_hero_sync.json",
    [
        ("user", "How do I pair the phone?"),
        ("assistant", "On Mac: System → Show Sync QR. On iOS: Set up sync. Credentials stay short-lived."),
    ],
)
write_messages(
    state / "messages_conv_hero_notes.json",
    [
        ("user", "Can notes take long replies?"),
        ("assistant", "Yes — proposeEdit and inline note writes keep long form out of the chat stream."),
    ],
)
write_messages(
    state / "messages_conv_hero_tasks.json",
    [
        ("user", "Add buy groceries and call the dentist."),
        ("assistant", "Added both to Tasks."),
    ],
)
write_messages(
    state / "messages_conv_hero_qa.json",
    [
        (
            "user",
            "I keep bouncing between ChatGPT in the browser and this. When should I stay here?",
        ),
        (
            "assistant",
            (
                "Stay here when you want the reply to be yours to inspect — "
                "context, tools, and the transcript on disk. Use the browser "
                "when you just need a quick answer you won't keep.\n\n"
                "What do you want this next hour to produce?\n\n"
                "::::options\n"
                ":::option{title=\"A decision I can stand behind\"}\n"
                ":::\n"
                ":::option{title=\"Notes I can edit later\"}\n"
                ":::\n"
                ":::option{title=\"A short answer, then done\"}\n"
                ":::\n"
                "::::"
            ),
        ),
    ],
)

# Dummy key so first-run setup does not cover the compose splash when
# HARNESS_DEV=1 (file-backed credentials). Production captures use Keychain.
creds_path = state.parent.parent / "credentials.json"
creds_path.write_text(json.dumps({"openaiApiKey": "sk-hero-demo"}, indent=2) + "\n")

print(f"Seeded demo profile at {state}")
PY
}

write_hero_session() {
  local shot="$1"
  local state="$PROFILE/local-data/app-state"
  local settings_dir="$PROFILE/local-data/settings"
  mkdir -p "$state" "$settings_dir"
  python3 - "$state" "$settings_dir" "$shot" <<'PY'
import json, sys
from pathlib import Path

state = Path(sys.argv[1])
settings_dir = Path(sys.argv[2])
shot = sys.argv[3]
compose = shot != "thread"
session = {
    "view": "chat",
    "conversationId": None if compose else "conv_hero_qa",
    "notesOpenNoteId": None,
    "openNoteInStickyWindow": False,
    "setupNoticeDismissed": True,
}
(state / "ui-session.json").write_text(json.dumps(session, indent=2) + "\n")
settings = {
    "version": 1,
    "chat": {"openToComposeOnLaunch": compose},
}
(settings_dir / "settings.json").write_text(json.dumps(settings, indent=2) + "\n")
print(f"Wrote {shot} session")
PY
}

window_id_via_cg() {
  # Prefer CGWindowList — System Events often cannot read Tauri window ids.
  # HARNESS_HERO_PID, when set, captures only that process (so a demo app can
  # sit beside a running Harness Dev window).
  swift -e '
import Cocoa
let pidFilter = Int(ProcessInfo.processInfo.environment["HARNESS_HERO_PID"] ?? "") ?? 0
let owners = ["harness", "Harness", "Harness Dev", "here", "Here", "Here Dev"]
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
var bestId = 0
var bestArea = 0
for w in info {
  let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
  guard owners.contains(where: { owner.caseInsensitiveCompare($0) == .orderedSame }) else { continue }
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  guard layer == 0 else { continue }
  let ownerPid = w[kCGWindowOwnerPID as String] as? Int ?? 0
  if pidFilter != 0 && ownerPid != pidFilter { continue }
  let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = Int((bounds["Width"] as? CGFloat) ?? CGFloat((bounds["Width"] as? Double) ?? 0))
  let height = Int((bounds["Height"] as? CGFloat) ?? CGFloat((bounds["Height"] as? Double) ?? 0))
  let area = width * height
  let id = w[kCGWindowNumber as String] as? Int ?? 0
  if area > bestArea && id > 0 {
    bestArea = area
    bestId = id
  }
}
if bestId == 0 { exit(1) }
print(bestId)
' 2>/dev/null || true
}

resolve_window_id() {
  local id
  id="$(window_id_via_cg)"
  if [[ -n "$id" ]]; then
    echo "$id"
    return 0
  fi
  return 1
}

bring_to_front() {
  osascript <<'EOF' >/dev/null 2>&1 || true
tell application "System Events"
  repeat with n in {"harness", "Harness", "Harness Dev", "here", "Here", "Here Dev"}
    if exists process (n as string) then
      set frontmost of process (n as string) to true
      exit repeat
    end if
  end repeat
end tell
EOF
}

# Move + resize the Harness window to fill the main display
# (visible frame: below the menu bar). Prints SIZE / CROP_Y / DISPLAY lines.
fill_builtin_screen() {
  swift -e '
import AppKit
import ApplicationServices

func targetScreen() -> NSScreen? {
  NSScreen.main ?? NSScreen.screens.first
}

guard let screen = targetScreen() else {
  fputs("error: no screen\n", stderr)
  exit(1)
}
let visible = screen.visibleFrame // bottom-left origin, AppKit points
let scale = screen.backingScaleFactor

let pidFilter = Int(ProcessInfo.processInfo.environment["HARNESS_HERO_PID"] ?? "") ?? 0
let owners: Set<String> = ["harness", "Harness", "Harness Dev", "here", "Here", "Here Dev"]
let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
  fputs("error: cannot list windows\n", stderr)
  exit(1)
}

var pid: pid_t = 0
var bestArea = 0
for w in info {
  let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
  guard owners.contains(where: { owner.caseInsensitiveCompare($0) == .orderedSame }) else { continue }
  let layer = w[kCGWindowLayer as String] as? Int ?? 0
  guard layer == 0 else { continue }
  let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = Int((bounds["Width"] as? CGFloat) ?? CGFloat((bounds["Width"] as? Double) ?? 0))
  let height = Int((bounds["Height"] as? CGFloat) ?? CGFloat((bounds["Height"] as? Double) ?? 0))
  let area = width * height
  let ownerPid = w[kCGWindowOwnerPID as String] as? pid_t ?? 0
  if pidFilter != 0 && Int(ownerPid) != pidFilter { continue }
  if area > bestArea && ownerPid != 0 {
    bestArea = area
    pid = ownerPid
  }
}
guard pid != 0 else {
  fputs("error: harness process not found\n", stderr)
  exit(1)
}

let app = AXUIElementCreateApplication(pid)
var windowsRef: CFTypeRef?
let winErr = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsRef)
guard winErr == .success, let windows = windowsRef as? [AXUIElement], let window = windows.first else {
  fputs("error: cannot get AX windows\n", stderr)
  exit(1)
}

// AX uses top-left global Cocoa coords; AppKit visibleFrame is bottom-left.
var origin = CGPoint(x: visible.origin.x, y: visible.origin.y)
var size = CGSize(width: visible.width, height: visible.height)
// Convert AppKit bottom-left Y to AX top-left Y for this screen.
let screenTop = screen.frame.origin.y + screen.frame.height
let axY = screenTop - visible.origin.y - visible.height
origin = CGPoint(x: visible.origin.x, y: axY)

var posVal = origin
var sizeVal = size
if let pos = AXValueCreate(.cgPoint, &posVal) {
  AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, pos)
}
if let sz = AXValueCreate(.cgSize, &sizeVal) {
  AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sz)
}

let backingW = Int((visible.width * scale).rounded())
let backingH = Int((visible.height * scale).rounded())
let topLeftY = screen.frame.maxY - visible.maxY
let rectX = Int(visible.origin.x.rounded())
let rectY = Int(topLeftY.rounded())
let rectW = Int(visible.width.rounded())
let rectH = Int(visible.height.rounded())
let displayId = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 1
print("SIZE \(backingW)x\(backingH)")
print("RECT \(rectX),\(rectY),\(rectW),\(rectH)")
print("DISPLAY \(displayId)")
print("CROP_Y \(Int((topLeftY * scale).rounded()))")
' 2>/dev/null
}

quit_harness() {
  osascript <<'EOF' >/dev/null 2>&1 || true
tell application "System Events"
  repeat with n in {"harness", "Harness", "Harness Dev", "here", "Here", "Here Dev"}
    if exists process (n as string) then
      try
        tell process (n as string) to click menu item "Quit Here" of menu "Here" of menu bar 1
      end try
      try
        tell process (n as string) to click menu item "Quit Here Dev" of menu "Here Dev" of menu bar 1
      end try
      try
        tell process (n as string) to click menu item "Quit Harness" of menu "Harness" of menu bar 1
      end try
    end if
  end repeat
end tell
EOF
  pkill -x harness 2>/dev/null || true
  pkill -x here 2>/dev/null || true
  pkill -x "Here Dev" 2>/dev/null || true
  pkill -x "Harness Dev" 2>/dev/null || true
  sleep 1
}

LAUNCH=0
KEEP=0
KEEP_EXISTING=0
SHOT="${HARNESS_HERO_SHOT:-compose}"
THREAD_OUT="${HARNESS_THREAD_OUT:-$ROOT/media/thread.png}"
for arg in "$@"; do
  case "$arg" in
    --launch) LAUNCH=1 ;;
    --keep) KEEP=1 ;;
    --keep-existing) KEEP_EXISTING=1 ;;
    --shot)
      ;;
    --shot=*)
      SHOT="${arg#--shot=}"
      ;;
    compose|thread|both)
      SHOT="$arg"
      ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--launch] [--keep] [--keep-existing] [--shot compose|thread|both]

Captures a seeded Harness window to:
  $OUT
  $THREAD_OUT  (with --shot thread or both)

  --launch         Quit any running Harness, seed a demo profile, start the app, capture
  --keep           Leave the demo app running after capture
  --keep-existing  With --launch: do not quit other Harness windows; capture the demo PID only
  --shot           compose (home), thread (Q&A conversation), or both

Env:
  HARNESS_HERO_OUT      Output path (default: media/hero.png)
  HARNESS_THREAD_OUT    Thread shot path (default: media/thread.png)
  HARNESS_HERO_PROFILE  Throwaway profile dir (default: media/.hero-profile)
  HARNESS_HERO_WAIT     Seconds to wait for window (default: 180)
  HARNESS_HERO_BIN      Optional path to app binary (else npm run tauri dev)
  HARNESS_HERO_PID      Optional process id to capture (set automatically with --keep-existing)
EOF
      exit 0
      ;;
  esac
done

# Allow `--shot compose` as two args.
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--shot" ]]; then
    SHOT="$arg"
  fi
  prev="$arg"
done

case "$SHOT" in
  compose|thread|both) ;;
  *)
    echo "error: unknown --shot $SHOT (use compose, thread, or both)" >&2
    exit 1
    ;;
esac

if [[ "$SHOT" == "both" && "$LAUNCH" -ne 1 ]]; then
  echo "error: --shot both requires --launch" >&2
  exit 1
fi

APP_PID=""
cleanup() {
  if [[ "$KEEP" -eq 0 && -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    sleep 0.5
    if [[ "$KEEP_EXISTING" -eq 0 ]]; then
      quit_harness
    fi
  fi
}
trap cleanup EXIT

start_demo_app() {
  echo "Starting Harness with demo profile…"
  if [[ -n "$APP_BIN" && -x "$APP_BIN" ]]; then
    HARNESS_DATA_DIR="$PROFILE" HARNESS_DISABLE_GLOBAL_HOTKEY=1 "$APP_BIN" \
      >/tmp/harness-capture-hero.log 2>&1 &
    APP_PID=$!
    export HARNESS_HERO_PID="$APP_PID"
  else
    (
      cd "$ROOT"
      # Use production productName/title ("Harness"), not `npm run dev`
      # which forces HARNESS_DEV=1 → "Harness Dev". Profile is still isolated
      # via HARNESS_DATA_DIR.
      HARNESS_DATA_DIR="$PROFILE" HARNESS_DISABLE_GLOBAL_HOTKEY=1 \
        npx tauri dev
    ) >/tmp/harness-capture-hero.log 2>&1 &
    APP_PID=$!
  fi
}

wait_for_window() {
  local deadline=$((SECONDS + MAX_WAIT_SEC))
  WID=""
  while (( SECONDS < deadline )); do
    WID="$(resolve_window_id || true)"
    if [[ -n "$WID" ]]; then
      # Let the webview paint past the boot wordmark / blank frame.
      sleep 8
      bring_to_front
      sleep 1
      WID="$(resolve_window_id || true)"
      return 0
    fi
    sleep 1
  done
  return 1
}

stop_demo_app() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    sleep 0.5
  fi
  APP_PID=""
  if [[ "$KEEP_EXISTING" -eq 0 ]]; then
    quit_harness
  fi
}

# Crop the top `cropY` pixels off a PNG (menu bar), keep `cropH` of height.
crop_png_top() {
  local src="$1" dest="$2" cropY="$3" cropH="$4"
  HARNESS_CROP_SRC="$src" HARNESS_CROP_DST="$dest" HARNESS_CROP_Y="$cropY" HARNESS_CROP_H="$cropH" swift -e '
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let env = ProcessInfo.processInfo.environment
guard let srcPath = env["HARNESS_CROP_SRC"], let dstPath = env["HARNESS_CROP_DST"] else { exit(1) }
let cropY = Int(env["HARNESS_CROP_Y"] ?? "0") ?? 0
let cropH = Int(env["HARNESS_CROP_H"] ?? "0") ?? 0
let srcURL = URL(fileURLWithPath: srcPath)
let dstURL = URL(fileURLWithPath: dstPath)
guard let src = CGImageSourceCreateWithURL(srcURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { exit(1) }
let width = image.width
let height = min(cropH, max(0, image.height - cropY))
guard height > 0, cropY >= 0, cropY < image.height,
      let cropped = image.cropping(to: CGRect(x: 0, y: cropY, width: width, height: height)),
      let dest = CGImageDestinationCreateWithURL(dstURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else { exit(1) }
CGImageDestinationAddImage(dest, cropped, nil)
if !CGImageDestinationFinalize(dest) { exit(1) }
'
}

image_has_visible_content() {
  local src="$1"
  HARNESS_CROP_SRC="$src" swift -e '
import CoreGraphics
import Foundation
import ImageIO

guard let srcPath = ProcessInfo.processInfo.environment["HARNESS_CROP_SRC"],
      let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: srcPath) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil),
      let data = image.dataProvider?.data,
      let ptr = CFDataGetBytePtr(data)
else { exit(1) }
let n = CFDataGetLength(data)
if n < 16 { exit(1) }
var lit = 0
var samples = 0
let stride = max(1, n / 4000)
var i = 0
while i + 2 < n {
  let r = Int(ptr[i]), g = Int(ptr[i+1]), b = Int(ptr[i+2])
  if r + g + b > 40 { lit += 1 }
  samples += 1
  i += stride
}
if samples == 0 || (Double(lit) / Double(samples)) < 0.02 { exit(1) }
'
}

capture_window_to() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  bring_to_front
  echo "Resizing window to fill the main display…"
  FILL_OUT="$(fill_builtin_screen || true)"
  FILL_SIZE="$(printf '%s\n' "$FILL_OUT" | awk '/^SIZE / { print $2 }')"
  FILL_CROP_Y="$(printf '%s\n' "$FILL_OUT" | awk '/^CROP_Y / { print $2 }')"
  FILL_DISPLAY="$(printf '%s\n' "$FILL_OUT" | awk '/^DISPLAY / { print $2 }')"
  if [[ -n "$FILL_SIZE" ]]; then
    echo "Target size (backing pixels): $FILL_SIZE"
  else
    echo "warning: could not resize window (Accessibility permission may be required)." >&2
  fi
  sleep 2
  bring_to_front
  WID="$(resolve_window_id || true)"
  if [[ -z "${WID:-}" ]]; then
    echo "error: lost Harness window after resize." >&2
    return 1
  fi

  local capture_ok=0
  if screencapture -l "$WID" -o -x "$dest" 2>/tmp/harness-capture-hero-screencapture.err; then
    capture_ok=1
  else
    echo "Window capture unavailable; capturing the main display and cropping the menu bar." >&2
    cat /tmp/harness-capture-hero-screencapture.err >&2 || true
    local full_png
    full_png="$(mktemp /tmp/harness-hero-full.XXXXXX.png)"
    extra=()
    if [[ -n "$FILL_DISPLAY" ]]; then
      extra+=(-D "$FILL_DISPLAY")
    fi
    if screencapture "${extra[@]}" -x "$full_png" 2>/tmp/harness-capture-hero-screencapture.err; then
      CROP_H="${FILL_SIZE##*x}"
      CROP_Y="${FILL_CROP_Y:-0}"
      if [[ -n "$CROP_H" ]] && crop_png_top "$full_png" "$dest" "$CROP_Y" "$CROP_H"; then
        capture_ok=1
      else
        cp "$full_png" "$dest"
        capture_ok=1
        echo "warning: could not crop menu bar; kept full-display capture." >&2
      fi
    fi
    rm -f "$full_png"
  fi
  if [[ "$capture_ok" -ne 1 ]]; then
    echo "error: screencapture failed (Screen Recording permission required)." >&2
    cat /tmp/harness-capture-hero-screencapture.err >&2 || true
    return 1
  fi

  echo "Wrote $dest ($(file -b "$dest"); sips -g pixelWidth -g pixelHeight "$dest" 2>/dev/null | paste - - | sed 's/  */ /g')"

  if ! image_has_visible_content "$dest"; then
    echo "error: captured image is blank (almost all black). Is the display asleep or off-screen?" >&2
    echo "Open: file://$dest" >&2
    return 1
  fi
  return 0
}

sync_site_asset() {
  local src="$1"
  local name="$2"
  local dest="$ROOT/site/assets/$name"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "Synced $dest"
}

capture_shot() {
  local shot="$1"
  local dest="$2"
  local site_name="$3"
  if [[ "$LAUNCH" -eq 1 ]]; then
    write_hero_session "$shot"
    start_demo_app
    if ! wait_for_window; then
      echo "error: no Harness window found." >&2
      echo "Re-run with --launch (builds/starts the app), or open Harness first." >&2
      echo "Log: /tmp/harness-capture-hero.log" >&2
      return 1
    fi
  else
    WID="$(resolve_window_id || true)"
    if [[ -z "${WID:-}" ]]; then
      echo "error: no Harness window found." >&2
      echo "Re-run with --launch (builds/starts the app), or open Harness first." >&2
      return 1
    fi
  fi
  capture_window_to "$dest" || return 1
  sync_site_asset "$dest" "$site_name"
  echo "Open: file://$dest"
  if [[ "$LAUNCH" -eq 1 ]]; then
    stop_demo_app
  fi
}

if [[ "$LAUNCH" -eq 1 ]]; then
  if [[ "$KEEP_EXISTING" -eq 0 ]]; then
    quit_harness
  fi
  seed_demo_profile
fi

if [[ "$SHOT" == "both" || "$SHOT" == "compose" ]]; then
  capture_shot compose "$OUT" "hero.png" || exit 1
fi
if [[ "$SHOT" == "both" || "$SHOT" == "thread" ]]; then
  capture_shot thread "$THREAD_OUT" "thread.png" || exit 1
fi
if [[ "$KEEP" -eq 1 && "$LAUNCH" -eq 1 ]]; then
  if [[ "$SHOT" == "thread" ]]; then
    write_hero_session thread
  else
    write_hero_session compose
  fi
  start_demo_app
fi
