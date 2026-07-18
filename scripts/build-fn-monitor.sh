#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-fn-monitor: skipping (not macOS)"
  exit 0
fi
# shellcheck source=codesign-native-helper.sh
source "$ROOT/scripts/codesign-native-helper.sh"
cd "$ROOT/native/HarnessFnMonitor"
swift build -c release
mkdir -p "$ROOT/resources"
cp ".build/release/HarnessFnMonitor" "$ROOT/resources/HarnessFnMonitor"
chmod +x "$ROOT/resources/HarnessFnMonitor"
codesign_native_helper "$ROOT/resources/HarnessFnMonitor"
echo "build-fn-monitor: installed resources/HarnessFnMonitor"
