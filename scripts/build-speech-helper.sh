#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-speech-helper: skipping (not macOS)"
  exit 0
fi
cd "$ROOT/native/HarnessSpeech"
swift build -c release
mkdir -p "$ROOT/resources"
cp ".build/release/HarnessSpeech" "$ROOT/resources/HarnessSpeech"
chmod +x "$ROOT/resources/HarnessSpeech"
echo "build-speech-helper: installed resources/HarnessSpeech"
