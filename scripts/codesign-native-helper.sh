#!/usr/bin/env bash
# Sign a Mach-O helper for local launch or Apple notarization.
#
# Usage:
#   source "$ROOT/scripts/codesign-native-helper.sh"
#   codesign_native_helper /path/to/binary
#
# When APPLE_SIGNING_IDENTITY is a real Developer ID (set by dist-runner via .env),
# signs with hardened runtime + secure timestamp so nested Resources/ binaries
# survive notarization. Tauri deep-signs the .app but does not reliably re-sign
# Mach-Os under nested Resources paths (e.g. Contents/Resources/_up_/resources/).
#
# Otherwise uses adhoc signing so `tauri dev` can launch helpers from resources/
# without SIGKILL (Code Signature Invalid).
codesign_native_helper() {
  local bin="$1"
  if [[ -z "$bin" || ! -f "$bin" ]]; then
    echo "codesign-native-helper: missing binary: ${bin:-<empty>}" >&2
    return 1
  fi
  local identity="${APPLE_SIGNING_IDENTITY:-}"
  if [[ -n "$identity" && "$identity" != "-" ]]; then
    echo "codesign-native-helper: Developer ID + hardened runtime → $bin"
    codesign --force --options runtime --timestamp --sign "$identity" "$bin"
  else
    echo "codesign-native-helper: adhoc → $bin"
    codesign --force --sign - "$bin"
  fi
  codesign --verify --verbose "$bin"
}
