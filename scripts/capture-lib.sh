#!/usr/bin/env bash
# Shared macOS window capture helpers for Harness screenshot scripts.
set -euo pipefail

capture_lib_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

seed_demo_profile() {
  local profile="${1:-${HARNESS_CAPTURE_PROFILE:-$capture_lib_root/media/.hero-profile}}"
  local state="$profile/local-data/app-state"
  local settings_dir="$profile/local-data/settings"
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

session = {
    "view": "chat",
    "conversationId": None,
    "notesOpenNoteId": None,
    "openNoteInStickyWindow": False,
    "setupNoticeDismissed": True,
}
(state / "ui-session.json").write_text(json.dumps(session, indent=2) + "\n")

settings = {
    "version": 1,
    "chat": {"openToComposeOnLaunch": True},
}
(settings_dir / "settings.json").write_text(json.dumps(settings, indent=2) + "\n")
print(f"Seeded demo profile at {state}")
PY
}

window_id_via_cg() {
  swift -e '
import Cocoa
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

fill_builtin_screen() {
  swift -e '
import AppKit
import ApplicationServices

func builtinScreen() -> NSScreen? {
  NSScreen.screens.first { $0.localizedName.localizedCaseInsensitiveContains("built-in") }
    ?? NSScreen.main
}

guard let screen = builtinScreen() else {
  fputs("error: no built-in screen\n", stderr)
  exit(1)
}
let visible = screen.visibleFrame
let scale = screen.backingScaleFactor

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

let screenTop = screen.frame.origin.y + screen.frame.height
let axY = screenTop - visible.origin.y - visible.height
var origin = CGPoint(x: visible.origin.x, y: axY)
var size = CGSize(width: visible.width, height: visible.height)

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
print("\(backingW)x\(backingH)")
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

capture_window_id_to() {
  local wid="$1"
  local out="$2"
  mkdir -p "$(dirname "$out")"
  if ! screencapture -l "$wid" -o -x "$out" 2>"${out}.screencapture.err"; then
    echo "error: screencapture failed (Screen Recording permission required)." >&2
    cat "${out}.screencapture.err" >&2 || true
    return 1
  fi
  rm -f "${out}.screencapture.err"
  echo "Wrote $out"
  echo "Open: file://$out"
}

capture_harness_window_to() {
  local out="$1"
  local wid
  wid="$(resolve_window_id || true)"
  if [[ -z "${wid:-}" ]]; then
    echo "error: no Harness window found." >&2
    return 1
  fi
  bring_to_front
  sleep 0.5
  wid="$(resolve_window_id || true)"
  capture_window_id_to "$wid" "$out"
}

wait_for_harness_window() {
  local max_wait_sec="${1:-180}"
  local deadline=$((SECONDS + max_wait_sec))
  while (( SECONDS < deadline )); do
    if resolve_window_id >/dev/null 2>&1; then
      sleep 4
      bring_to_front
      sleep 1
      return 0
    fi
    sleep 1
  done
  return 1
}

launch_harness_demo() {
  local profile="$1"
  local log_file="${2:-/tmp/harness-capture.log}"
  local app_bin="${HARNESS_CAPTURE_BIN:-}"

  if [[ -n "$app_bin" && -x "$app_bin" ]]; then
    HARNESS_DATA_DIR="$profile" HARNESS_DISABLE_GLOBAL_HOTKEY=1 "$app_bin" >"$log_file" 2>&1 &
    echo $!
    return 0
  fi

  (
    cd "$capture_lib_root"
    HARNESS_DATA_DIR="$profile" HARNESS_DISABLE_GLOBAL_HOTKEY=1 npx tauri dev
  ) >"$log_file" 2>&1 &
  echo $!
}

# Click a sidebar icon button by accessibility label (Search, Tasks, System).
click_sidebar_button() {
  local label="$1"
  osascript <<EOF
tell application "System Events"
  repeat with procName in {"Harness Dev", "Harness", "here", "Here", "Harness Dev"}
    if exists process procName then
      tell process procName
        set frontmost to true
        delay 0.4
        try
          click (first button of window 1 whose description is "$label" or name is "$label" or title is "$label")
          return
        end try
      end tell
    end if
  end repeat
  error "sidebar button not found: $label"
end tell
EOF
}

# Click a sidebar conversation row by visible title text.
click_sidebar_conversation() {
  local title="$1"
  osascript <<EOF
tell application "System Events"
  repeat with procName in {"Harness Dev", "Harness", "here", "Here"}
    if exists process procName then
      tell process procName
        set frontmost to true
        delay 0.4
        try
          click (first static text of window 1 whose value is "$title")
          return
        end try
        try
          click (first UI element of window 1 whose description contains "$title")
          return
        end try
      end tell
    end if
  end repeat
  error "conversation not found: $title"
end tell
EOF
}
