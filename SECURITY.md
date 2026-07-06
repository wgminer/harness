# Security

Harness is a local-first desktop app that runs an LLM with tools against your filesystem and cloud sync bucket. This document describes intentional security boundaries and how to report issues.

## Reporting vulnerabilities

If you find a security issue, please **do not** open a public GitHub issue with exploit details. Email the maintainer via the contact on [github.com/wgminer/harness](https://github.com/wgminer/harness) or use GitHub **Private vulnerability reporting** if enabled on the repository.

## LLM file tools

The assistant can call file tools (`list_directory`, `read_file`, `write_file`, `delete_file`, `create_directory`) when the model requests them. Allowed roots are:

- Harness user data directory
- Your home directory
- Your desktop directory (when available)

Any path under those roots is reachable. A manipulated or compromised model response could read, modify, or delete files in those locations. Treat API keys, provider choice, and conversation content as part of your trust boundary.

## Credentials and secrets

- **Production builds** store OpenAI, Tavily, and R2 secrets in the OS keychain (macOS Keychain / platform keyring), not in settings JSON on disk.
- **Development** (`HARNESS_DEV=1`) may write a plaintext `credentials.json` under user data for convenience; do not use dev mode with real secrets on shared machines.
- **Settings UI** loads secrets into the renderer via Tauri IPC so fields can be edited. The desktop UI is trusted local code; avoid loading untrusted web content in the app window.
- **Sync bundles** strip API keys and Tavily keys from settings before upload; R2 secret access keys are stored separately in the keychain.

## Sync and cloud backup

R2 credentials you configure are used to read and write your backup bucket. Bucket contents include conversation data and redacted settings. Protect R2 access keys like any cloud storage credential.

## iOS companion

Harness Mobile stores API keys and R2 secrets in the iOS Keychain. See [ios/README.md](ios/README.md).

## Updates

Desktop in-app updates are verified with the minisign public key in `src-tauri/tauri.conf.json`. Release artifacts must be signed with the matching private key (see [BUILD.md](BUILD.md)); never commit signing keys or `.p12` files.
