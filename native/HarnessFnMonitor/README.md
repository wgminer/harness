# HarnessFnMonitor

Small macOS helper that watches the **Fn** key (`flagsChanged`, key code 63) and prints one JSON line per edge to stdout:

```json
{"t":"fn","phase":"down","ms":1700000000000}
{"t":"fn","phase":"up","ms":1700000000050}
```

Requires **Accessibility** permission for the parent app (Harness). The binary is spawned by the Tauri backend and has no UI.

## Build

```bash
cd native/HarnessFnMonitor
swift build -c release
```

The repo’s `npm run build:fn-monitor` copies the binary to `resources/HarnessFnMonitor` for local dev and packaging.
