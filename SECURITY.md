## Security

Harness is a local-first desktop app that runs an LLM with tools against your filesystem and cloud sync bucket. This document describes intentional security boundaries and how to report issues.

## Reporting vulnerabilities

If you find a security issue, please **do not** open a public GitHub issue with exploit details. Email the maintainer via the contact on [github.com/wgminer/harness](https://github.com/wgminer/harness) or use GitHub **Private vulnerability reporting** if enabled on the repository.

## LLM coding tools

When a conversation has a **coding scope**, the assistant can call scoped tools (`ws_list_tree`, `ws_search`, `ws_read`, `ws_edit`, `ws_write`, `ws_delete`, `run_command`, `git_*`).

- **Project scope:** a user-chosen folder. Paths must stay under that root; heavy dirs (`.git`, `node_modules`, `target`, `dist*`) are denied from listings/search.
- **Self scope (Harness Dev only):** the detected Harness repo root, limited to predefined aspect globs (`src/renderer/**/*.tsx`, `src/renderer/**/*.css`, `src/renderer/index.html`).
- Mutating tools (`ws_edit`, `ws_write`, `ws_delete`, non-allowlisted `run_command`, `git_checkout_branch`) require explicit Proceed/Cancel in the UI.
- `run_command` runs with the scope root as cwd, with timeout/output caps and scrubbed secret env vars. Only a small allowlist auto-runs.

Treat API keys, provider choice, and conversation content as part of your trust boundary.

## Credentials and secrets

- **Production builds** store OpenAI, Tavily, and R2 secrets in the OS keychain (macOS Keychain / platform keyring), not in settings JSON on disk.
- **Development** (`HARNESS_DEV=1`) may write a plaintext `credentials.json` under user data for convenience; do not use dev mode with real secrets on shared machines.
- **Settings UI** loads secrets into the renderer via Tauri IPC so fields can be edited. The desktop UI is trusted local code; avoid loading untrusted web content in the app window.
- **Sync bundles** strip API keys and Tavily keys from settings before upload; R2 secret access keys are stored separately in the keychain.

## Sync and cloud backup

R2 credentials you configure are used to read and write your backup bucket. Bucket contents include conversation data and redacted settings. Protect R2 access keys like any cloud storage credential.

### Mac → phone sync QR

Desktop **Show Sync QR** embeds R2 credentials and (when present) the OpenAI API key in a short-lived `harness-pair:1:…` string (~10 minutes). Treat the QR like a password: don’t screenshot or share it. Dismiss the modal when finished. Documented under Settings → General on desktop and Settings → Set up sync on iOS.

## iOS companion

Harness Mobile stores API keys and R2 secrets in the iOS Keychain. See [ios/README.md](ios/README.md).

## Updates

Desktop in-app updates are verified with the minisign public key in `src-tauri/tauri.conf.json`. Release artifacts must be signed with the matching private key (see [BUILD.md](BUILD.md)); never commit signing keys or `.p12` files.
