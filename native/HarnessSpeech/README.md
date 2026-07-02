# HarnessSpeech

macOS CLI helper for on-device speech transcription via Apple's Speech framework.

- **macOS 26+:** `SpeechAnalyzer` + `SpeechTranscriber` (long-form)
- **Older macOS:** `SFSpeechRecognizer` with on-device recognition and ~50s chunking

Built by `scripts/build-speech-helper.sh` and shipped as `resources/HarnessSpeech`.

Usage:

```bash
HarnessSpeech /path/to/recording.wav [--locale en_US]
```

Exit codes: `0` success, `2` permission denied, `3` locale unavailable, `4` no speech, `5` audio not ready.
