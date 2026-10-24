# HarnessSpeech

macOS 14+ CLI helper for on-device speech transcription.

- **`--engine apple` (default)**
  - **macOS 26+:** `SpeechAnalyzer` + `SpeechTranscriber` (long-form)
  - **Older macOS:** `SFSpeechRecognizer` with on-device recognition and ~50s chunking
- **`--engine parakeet`:** NVIDIA Parakeet via [FluidAudio](https://github.com/FluidInference/FluidAudio). English uses Parakeet TDT v2; other locales use the multilingual Ultra model. Models live under `--models-dir` (FluidAudio's default cache when omitted). Transcription never downloads: it exits `6` until `--prepare` has fetched and compiled the models.

Built by `scripts/build-speech-helper.sh` and shipped as `resources/HarnessSpeech`.

Usage:

```bash
HarnessSpeech /path/to/recording.wav [--locale en_US] [--engine apple|parakeet] [--models-dir <path>]
HarnessSpeech --prepare --engine parakeet [--models-dir <path>]   # download + compile models
HarnessSpeech --check --engine parakeet [--models-dir <path>]     # exit 0 if models are on disk
```

Exit codes: `0` success, `2` permission denied, `3` locale unavailable, `4` no speech, `5` audio not ready, `6` Parakeet models not downloaded.
