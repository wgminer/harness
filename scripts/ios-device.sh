#!/usr/bin/env bash
# Build Harness Mobile and install it on a connected iPhone without opening Xcode.
#
# Usage:
#   npm run ios:device
#   npm run ios:device -- --list
#   npm run ios:device -- --device "Will's iPhone"
#   npm run ios:device -- --no-launch
#
# Team ID comes from APPLE_TEAM_ID / DEVELOPMENT_TEAM in `.env` (or the environment).
# Pin a phone with IOS_DEVICE (name, UDID, or CoreDevice identifier).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT/ios"
PROJECT="$IOS_DIR/HarnessMobile.xcodeproj"
SCHEME="HarnessMobile"
BUNDLE_ID="com.harness.mobile"
DERIVED="$IOS_DIR/.build-device"
CONFIGURATION="Debug"

LIST_ONLY=0
LAUNCH=1
DEVICE_QUERY="${IOS_DEVICE:-}"

usage() {
  cat <<'EOF'
Build Harness Mobile and install it on a paired iPhone.

Usage: ios-device.sh [--list] [--device <name-or-udid>] [--no-launch]

  --list              Print reachable iOS devices and exit
  --device <id>       Phone name, UDID, or CoreDevice identifier
  --no-launch         Install but do not launch the app

Environment:
  APPLE_TEAM_ID / DEVELOPMENT_TEAM   Apple Developer Team ID (required to build)
  IOS_DEVICE                         Same as --device
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)
      LIST_ONLY=1
      shift
      ;;
    --device)
      DEVICE_QUERY="${2:-}"
      if [[ -z "$DEVICE_QUERY" ]]; then
        echo "ios-device: --device needs a name or UDID" >&2
        exit 2
      fi
      shift 2
      ;;
    --no-launch)
      LAUNCH=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ios-device: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ios-device: macOS + Xcode required" >&2
  exit 1
fi

load_dotenv_value() {
  local key="$1"
  python3 - "$ROOT/.env" "$key" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
key = sys.argv[2]
if not path.is_file():
    raise SystemExit(0)
for raw in path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    name, value = line.split("=", 1)
    if name.strip() != key:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    print(value)
    break
PY
}

if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
  APPLE_TEAM_ID="$(load_dotenv_value APPLE_TEAM_ID || true)"
fi
if [[ -z "${DEVELOPMENT_TEAM:-}" ]]; then
  DEVELOPMENT_TEAM="$(load_dotenv_value DEVELOPMENT_TEAM || true)"
fi
if [[ -z "${IOS_DEVICE:-}" && -z "$DEVICE_QUERY" ]]; then
  DEVICE_QUERY="$(load_dotenv_value IOS_DEVICE || true)"
fi

TEAM_ID="${DEVELOPMENT_TEAM:-${APPLE_TEAM_ID:-}}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ios-device: missing $1. $2" >&2
    exit 1
  fi
}

require_cmd xcodegen "Install with: brew install xcodegen"
require_cmd xcodebuild "Install Xcode from the App Store, then open it once."
require_cmd python3 "Install Python 3."

echo "ios-device: generating Xcode project"
(
  cd "$IOS_DIR"
  xcodegen generate
)

list_devicectl_json() {
  local out="$1"
  xcrun devicectl list devices --json-output "$out" >/dev/null
}

reachable_devices_json() {
  # Prefer phones xcodebuild can actually build to; fall back to paired CoreDevice phones.
  python3 - "$PROJECT" "$SCHEME" <<'PY'
import json, re, subprocess, sys
from pathlib import Path

project, scheme = sys.argv[1], sys.argv[2]
proc = subprocess.run(
    ["xcodebuild", "-project", project, "-scheme", scheme, "-showdestinations"],
    capture_output=True,
    text=True,
)
text = proc.stdout + proc.stderr
devices = []
for match in re.finditer(r"\{([^}]+)\}", text):
    fields = {}
    for part in match.group(1).split(","):
        if ":" not in part:
            continue
        key, value = part.split(":", 1)
        fields[key.strip()] = value.strip()
    if fields.get("platform") != "iOS":
        continue
    dest_id = fields.get("id", "")
    if not dest_id or dest_id.startswith("dvtdevice-"):
        continue
    devices.append({
        "name": fields.get("name", dest_id),
        "udid": dest_id,
        "source": "xcodebuild",
    })
print(json.dumps(devices))
PY
}

coredevice_phones_json() {
  local tmp
  tmp="$(mktemp -t harness-ios-devices)"
  list_devicectl_json "$tmp"
  python3 - "$tmp" <<'PY'
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
out = []
for device in data.get("result", {}).get("devices", []):
    hardware = device.get("hardwareProperties") or {}
    props = device.get("deviceProperties") or {}
    conn = device.get("connectionProperties") or {}
    if hardware.get("platform") != "iOS":
        continue
    if hardware.get("deviceType") not in {"iPhone", "iPad"}:
        continue
    out.append({
        "name": props.get("name") or hardware.get("marketingName") or device.get("identifier"),
        "udid": hardware.get("udid") or "",
        "identifier": device.get("identifier") or "",
        "deviceType": hardware.get("deviceType") or "",
        "pairingState": conn.get("pairingState") or "",
        "transportType": conn.get("transportType") or "",
        "tunnelState": conn.get("tunnelState") or "",
        "os": props.get("osVersionNumber") or "",
        "developerMode": props.get("developerModeStatus") or "",
    })
print(json.dumps(out))
PY
  rm -f "$tmp"
}

print_device_list() {
  python3 - <<'PY'
import json, os, sys
reachable = json.loads(os.environ["HARNESS_REACHABLE"])
core = json.loads(os.environ["HARNESS_CORE"])
print("Reachable for xcodebuild:")
if not reachable:
    print("  (none)")
else:
    for d in reachable:
        print(f"  {d['name']}  {d['udid']}")
print("Paired CoreDevice phones/tablets:")
if not core:
    print("  (none)")
else:
    for d in core:
        transport = d.get("transportType") or "offline"
        print(
            f"  {d['name']}  {d.get('udid') or d.get('identifier')}  "
            f"{d.get('deviceType')}  {d.get('os')}  {transport}  "
            f"tunnel={d.get('tunnelState') or '-'}  "
            f"devmode={d.get('developerMode') or '-'}"
        )
PY
}

REACHABLE="$(reachable_devices_json)"
CORE="$(coredevice_phones_json)"
export HARNESS_REACHABLE="$REACHABLE"
export HARNESS_CORE="$CORE"

if [[ "$LIST_ONLY" -eq 1 ]]; then
  print_device_list
  exit 0
fi

if [[ -z "$TEAM_ID" ]]; then
  echo "ios-device: set APPLE_TEAM_ID in .env (same Team ID as desktop signing)." >&2
  echo "  Find it at https://developer.apple.com/account#MembershipDetailsCard" >&2
  echo "  One-time: add that Apple ID in Xcode → Settings → Accounts." >&2
  exit 1
fi

SELECTED="$(
  python3 - "$DEVICE_QUERY" <<'PY'
import json, os, sys
query = (sys.argv[1] or "").strip().casefold()
reachable = json.loads(os.environ["HARNESS_REACHABLE"])
core = json.loads(os.environ["HARNESS_CORE"])

def matches(device: dict) -> bool:
    if not query:
        return True
    fields = [
        device.get("name") or "",
        device.get("udid") or "",
        device.get("identifier") or "",
    ]
    return any(query == field.casefold() or query in field.casefold() for field in fields)

def reachable_now(device: dict) -> bool:
    transport = (device.get("transportType") or "").strip()
    tunnel = (device.get("tunnelState") or "").strip()
    if transport in {"", "None"}:
        return False
    return tunnel not in {"unavailable"}

phones = [d for d in reachable if matches(d)]
if not phones:
    # Fall back to a CoreDevice phone that looks connected.
    candidates = [
        d for d in core
        if d.get("deviceType") == "iPhone" and matches(d) and reachable_now(d)
    ]
    phones = [
        {"name": d["name"], "udid": d.get("udid") or d.get("identifier"), "identifier": d.get("identifier")}
        for d in candidates
    ]

if query and not phones:
    print("no-match", file=sys.stderr)
    sys.exit(3)

if not phones:
    print("none", file=sys.stderr)
    sys.exit(4)

if len(phones) > 1:
    print("ambiguous", file=sys.stderr)
    sys.exit(5)

chosen = phones[0]
ident = next(
    (d.get("identifier") for d in core if d.get("udid") == chosen.get("udid")),
    chosen.get("udid"),
)
print(json.dumps({
    "name": chosen["name"],
    "udid": chosen["udid"],
    "identifier": ident or chosen["udid"],
}))
PY
)" || {
  status=$?
  echo
  print_device_list
  echo
  case "$status" in
    3)
      echo "ios-device: no device matched '${DEVICE_QUERY}'." >&2
      ;;
    4)
      echo "ios-device: no reachable iPhone. Unlock the phone, keep it on the same Wi-Fi or plug in USB," >&2
      echo "  enable Developer Mode (Settings → Privacy & Security), and trust this Mac." >&2
      ;;
    5)
      echo "ios-device: several phones are reachable. Re-run with --device <name-or-udid> or set IOS_DEVICE." >&2
      ;;
    *)
      echo "ios-device: failed to pick a device (exit $status)." >&2
      ;;
  esac
  exit 1
}

DEVICE_NAME="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["name"])' "$SELECTED")"
DEVICE_UDID="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["udid"])' "$SELECTED")"
DEVICE_IDENT="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["identifier"])' "$SELECTED")"

echo "ios-device: building ${SCHEME} (${CONFIGURATION}) → ${DEVICE_NAME}"
mkdir -p "$DERIVED"
APP="$DERIVED/Build/Products/${CONFIGURATION}-iphoneos/${SCHEME}.app"

# shellcheck disable=SC2086
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination "platform=iOS,id=${DEVICE_UDID}" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  build

if [[ ! -d "$APP" ]]; then
  echo "ios-device: build succeeded but app bundle missing: $APP" >&2
  exit 1
fi

echo "ios-device: installing on ${DEVICE_NAME}"
xcrun devicectl device install app --device "$DEVICE_IDENT" "$APP"

if [[ "$LAUNCH" -eq 1 ]]; then
  echo "ios-device: launching ${BUNDLE_ID}"
  xcrun devicectl device process launch --device "$DEVICE_IDENT" --terminate-existing "$BUNDLE_ID"
fi

echo "ios-device: done → ${DEVICE_NAME}"
