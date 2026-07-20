# Building and signing the Mac app


| Command                    | What it does                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`              | Install project dependencies.                                                                                                                                                                                                                                                                                                                                         |
| `npm run dev`              | Run the app in development mode with hot reload.                                                                                                                                                                                                                                                                                                                      |
| `npm run build`            | Runs **prebuild** first: `icon:icns`, then `build:speech-helper` and `build:fn-monitor` on macOS, then compiles the renderer to `dist-web/`. |
| `npm run dist`             | Full pipeline: native helpers → vite build → `tauri build` (DMG + `.app` on macOS). Does **not** bump version unless you pass `--bump`.                                                                                                                                                                  |
| `npm run dist:mac`         | Same as `dist` on macOS. Use for the main Mac build and with `--replace`.                                                                                                                                                                                                                                                               |
| `npm run dist:mac:quick`   | Adhoc-signed local build (`APPLE_SIGNING_IDENTITY=-`, no version bump). Not for distribution.                                                                                                                                                                                                                                                               |
| `npm run dist:mac:replace` | `dist:mac` with `--replace`: copy the built `.app` into `/Applications`.                                                                                                                                                                                                                                                                                              |
| `npm run release`          | Bumps patch version, signed+notarized `dist:mac`, verify trust, publish GitHub Release + `latest.json`, push tag. |
| `npm run icon:icns`        | Generate `build/icon.icns` from the project icon assets.                                                                                                                                                                                                                                                                                                              |
| `npm run build:speech-helper` | **(macOS)** Build `native/HarnessSpeech` and copy the CLI into `resources/HarnessSpeech`. Needs Xcode Command Line Tools and Swift. |
| `npm run build:fn-monitor` | **(macOS)** Build `native/HarnessFnMonitor` for the global Fn dictation shortcut. |


This guide walks you through creating a double-clickable, signed (and optionally notarized) Mac app using your Apple Developer account.

---

## Dev vs installed profiles

`npm run dev` sets `HARNESS_DEV=1` and merges [`src-tauri/tauri.dev.conf.json`](src-tauri/tauri.dev.conf.json) (`productName` / bundle id **Harness Dev** / `com.harness.app.dev`). That splits the **Application Support directory**, window title, and the name macOS shows in Dock / menu bar / Privacy & Security (Accessibility, Microphone, Speech). Tray icons still use the same production assets.

| Mode | How you launch | App Support folder (macOS) | System name (Dock / A11y) |
|------|----------------|----------------------------|---------------------------|
| Development | `npm run dev` | `~/Library/Application Support/Harness Dev` | **Harness Dev** |
| Installed | `/Applications/Harness.app` or `npm run dist:mac:replace` | `~/Library/Application Support/Harness` | **Harness** |

### What is separate (not shared)

- All app state under that folder: `local-data/` (conversations, messages, tasks, notes, memory, settings, sync state)
- `audio-recordings/` (local-only; never synced)
- Dev may also write a plaintext `credentials.json` under the Dev folder (see [SECURITY.md](SECURITY.md)); production keeps secrets in the OS keychain

### What is shared or external

- R2 backup bucket (same credentials → same remote bundle)
- OpenAI / Tavily API accounts (same keys work in both profiles once entered)
- Signing / notarization env (`APPLE_SIGNING_IDENTITY`, `APPLE_*`, `TAURI_SIGNING_*`) — build-time only, not per profile

Deleting or moving either Application Support folder forces a **fresh empty profile** on next launch.

---

## 1. One-time: Install dependencies

```bash
npm install
```

**Native helpers:** install **Xcode Command Line Tools** (`xcode-select --install`) for Swift builds. `npm run build` (and anything that runs it, e.g. `dist:mac`) automatically runs **prebuild**: icon generation, then `build:speech-helper` and `build:fn-monitor` on macOS. `resources/HarnessSpeech` and `resources/HarnessFnMonitor` are gitignored build outputs.

### On-device speech transcription

Voice is transcribed locally with Apple's **Speech** framework via the `HarnessSpeech` helper (`native/HarnessSpeech`). No separate transcription API or model download is required.

- **macOS 26+:** `SpeechAnalyzer` + `SpeechTranscriber` for long-form recordings
- **Older macOS:** `SFSpeechRecognizer` with on-device recognition and chunked audio

Grant **Microphone** and **Speech Recognition** when Harness prompts you (System Settings → Privacy & Security). Fn also needs **Accessibility**. After toggling any of these, quit and reopen the app. Settings → Voice has buttons to ask for Microphone / open those privacy panes (and Accessibility for Fn). On older macOS, also ensure the dictation language is installed under Keyboard → Dictation.

Packaged apps must be signed with the hardened-runtime entitlement `com.apple.security.device.audio-input` ([`src-tauri/entitlements.plist`](src-tauri/entitlements.plist), wired via `bundle.macOS.entitlements`). Without it, macOS silently denies the mic — **no prompt and no Harness row** under Privacy → Microphone.

Packaged apps bundle `HarnessSpeech` in `Contents/Resources/`. Development builds load it from `resources/HarnessSpeech` after `npm run build:speech-helper`.

**New Mac checklist:** enable Microphone + Speech Recognition for **Harness** (or **Harness Dev** when using `npm run dev`), then Accessibility for Fn. Deny once means macOS will not re-prompt — flip the toggle in System Settings. If Microphone never lists Harness, rebuild/reinstall a dist that includes the audio-input entitlement (`codesign -d --entitlements :- …/Harness.app` should show `com.apple.security.device.audio-input`).
---

## 2. One-time: Create a “Developer ID Application” certificate

You need this to **sign** the app for distribution outside the App Store.

1. On your Mac, open **Keychain Access**.
2. Menu: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**.
3. Enter your email, choose “Saved to disk”, and save the `.certSigningRequest` file.
4. Go to [Apple Developer → Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list).
5. Click **+** to add a certificate.
6. Under **Software**, select **Developer ID Application** and continue.
7. Upload the CSR you saved, then download the generated certificate (e.g. `developerID_application.cer`).
8. Double‑click the `.cer` file to add it to your **login** keychain.

You should now see “Developer ID Application: Your Name (TEAM_ID)” under **My Certificates** in Keychain Access.

---

## 3. One-time: Confirm the signing identity (local builds)

With the certificate in your login keychain, find the exact identity string:

```bash
security find-identity -v -p codesigning
```

Look for a line like `Developer ID Application: Your Name (TEAM_ID)`. That full string is `APPLE_SIGNING_IDENTITY`.

### Optional: Export a `.p12` for CI

CI machines usually don’t have your keychain. Export a `.p12` and base64-encode it:

1. In **Keychain Access**, select the **login** keychain and the **My Certificates** category.
2. Find **Developer ID Application: Your Name (…)**. Expand it; you should see the certificate and its private key.
3. **Cmd‑click** to select both the certificate and the private key.
4. Right‑click → **Export 2 items…**.
5. Save as e.g. `DeveloperIDApplication.p12` with a strong password.
6. Encode for Tauri:

```bash
openssl base64 -A -in DeveloperIDApplication.p12 -out certificate-base64.txt
```

Set `APPLE_CERTIFICATE` to the contents of that file and `APPLE_CERTIFICATE_PASSWORD` to the export password. Also set `APPLE_SIGNING_IDENTITY` to the same identity string as above.

---

## 4. One-time: App-specific password (for notarization)

Notarization makes Gatekeeper accept your app without “damaged” / “unidentified developer” warnings on other Macs.

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign In and Security → **App-Specific Passwords**.
2. Generate a new app-specific password (e.g. name: “Harness notarization”).
3. Copy the generated password; you’ll use it as `APPLE_PASSWORD` (this is **not** your normal Apple ID password).

---

## 5. Get your Team ID

1. Go to [Apple Developer → Membership](https://developer.apple.com/account#MembershipDetailsCard).
2. Copy your **Team ID** (e.g. `ABCD1234`). You’ll use it as `APPLE_TEAM_ID`.

---

## 6. Build the app (signed and notarized)

Put these in `.env` (see [`.env.example`](.env.example)) or export them in the shell. **Do not commit real values.**

Tauri reads Apple’s vars — **not** electron-builder’s `CSC_*`.


| Variable | Meaning |
| -------- | ------- |
| `APPLE_SIGNING_IDENTITY` | Exact Keychain identity, e.g. `Developer ID Application: Your Name (TEAM_ID)`. Required for real signing. |
| `APPLE_CERTIFICATE` | (CI) Base64-encoded `.p12` contents. |
| `APPLE_CERTIFICATE_PASSWORD` | (CI) Password for that `.p12`. |
| `APPLE_ID` | Your Apple ID email. |
| `APPLE_PASSWORD` | App-specific password from step 4. |
| `APPLE_TEAM_ID` | Your Team ID from step 5. |
| `REQUIRE_NOTARIZE` | Set to `1` to **fail the build** if signing/notarization credentials are missing. `npm run release` sets this automatically. |


Example (local machine with the cert already in Keychain):

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCD1234"

npm run dist:mac
```

After `dist:mac`, share the DMG under `src-tauri/target/release/bundle/dmg/` (not a bare `.app`). `npm run release` also copies a versioned DMG/ZIP into `dist/`.

To copy the built app into `/Applications` (replacing an existing install with the same name):

```bash
npm run dist:mac:replace
```

Equivalent: `npm run dist:mac -- --replace` (the dedicated script avoids the extra `--`).

Quit Harness if it is running before replacing, so the copy can succeed.

- If you set `APPLE_SIGNING_IDENTITY` but **omit** notarization credentials (`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`), the app is signed but **not** notarized. Other Macs often see Gatekeeper **“damaged”** or **“cannot be opened”** — **do not ship** builds made this way.
- If you set signing **and** notarization vars, Tauri signs, notarizes, and staples. Then run `npm run verify:mac-trust` before sharing.
- `npm run release` sets `REQUIRE_NOTARIZE=1`, so missing credentials **fail the build** instead of producing an adhoc/un-notarized artifact.

---

## 7. Verify the build before distributing

On the Mac where you built (or on CI, this runs automatically after pack), confirm the app is signed, passes Gatekeeper, and has a **stapled** notarization ticket:

```bash
npm run verify:mac-trust
```

This looks for `src-tauri/target/release/bundle/macos/Harness.app`, then fallbacks under `dist/mac-*`. To check a specific bundle:

```bash
npm run verify:mac-trust -- /path/to/Harness.app
```

**Only share the DMG** from a build where `verify:mac-trust` passes. Prefer the DMG over AirDrop’ing a bare `.app`.

Outputs (for Mac) are under:

- `src-tauri/target/release/bundle/dmg/Harness_<version>_*.dmg` – installer from `npm run dist` / `dist:mac` (this is what you share)
- `src-tauri/target/release/bundle/macos/Harness.app` – app bundle (verify this; don’t ship it alone)
- `dist/harness-vx.x.x-mac.dmg` / `.zip` – versioned copies created by `npm run release` when publishing

---

## 8. Release, download site, and auto-update

This project does not commit DMGs to git. Build artifacts land under `dist/` and are published as **GitHub Releases on this repo** (`wgminer/harness`).

The download page lives in [`site/`](site/) and is deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) whenever `site/` changes on `main`. After you make the repo public, enable Pages under **Settings → Pages → Build and deployment → GitHub Actions**.

The landing page download button points to:

- `https://github.com/wgminer/harness/releases/latest`

### One-command release

`package.json` is the single version source. `scripts/dist-runner.js --bump` (and `npm run release`) sync the same patch into `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. iOS `MARKETING_VERSION` stays separate.

1. Set signing env vars in `.env` (see [`.env.example`](.env.example)): `GH_TOKEN`, `APPLE_SIGNING_IDENTITY`, Apple notarization (`APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`), and updater signing (`TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Always set the password variable (empty if the key has no password) so builds never hang on a TTY prompt.
2. Generate an updater key pair once (if you have not already):

```bash
npx tauri signer generate -w ~/.tauri/harness.key
```

Copy the printed public key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

3. On a clean `main` working tree:

```bash
npm run release
```

This command:

1. Verifies your git working tree is clean.
2. Bumps the patch version in `package.json` (and syncs Cargo / tauri.conf).
3. Builds `dist:mac` with `REQUIRE_NOTARIZE=1` (signed + notarized).
4. Runs `verify:mac-trust`.
5. Collects DMG, ZIP, updater bundle, and `latest.json`, then publishes them to GitHub Releases on this repo.
6. Creates git tag `vX.Y.Z` and pushes tag + `main`.

Installed copies of Harness check GitHub on launch and show an **Update** button in the sidebar when a newer release exists.

Optional flags:

- `npm run release -- --dry-run` — build and verify the **current** version only; skip bump, publish, and git tag.
- `npm run release -- --no-bump` — publish the already-committed version (use after a manual minor/major bump); still publishes and tags.
- `npm run release -- --no-tag` — publish to GitHub but skip git tag push.

Local dist without releasing:

```bash
npm run dist:mac              # current version
npm run dist:mac -- --bump    # bump patch, then build
```

A Vitest check (`src/shared/versionParity.test.ts`) fails CI if the three desktop version fields drift.

### Manual release

```bash
npm run dist:mac
npm run verify:mac-trust
node scripts/publish-github-release.js
```

### GitHub asset size limit

GitHub Release assets reject individual files **>= 2 GiB**. If upload fails due to size, host artifacts on a public bucket (e.g. R2) and configure the Tauri updater plugin for a generic endpoint.

### GitHub Pages setup

1. Make the repository **public** (required for free public Pages and public release downloads).
2. Under **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push changes under `site/` to `main`; the deploy workflow publishes automatically.
4. Optionally set a custom domain (e.g. `williamminer.com`) in Pages settings and update DNS.

You can archive the old [`wgminer/harness-site`](https://github.com/wgminer/harness-site) repo once Pages and releases run from this repo.

---

## 9. Optional: Customize app id and name

In `src-tauri/tauri.conf.json`:

- `identifier`: e.g. `com.harness.app` (reverse-DNS bundle id).
- `productName`: **Harness** (Dock/Finder name; version is shown inside the app, not in the title).

Update `author` and `description` in `package.json` as needed.

---

## Troubleshooting

- **“App is damaged” / Gatekeeper on another Mac**  
The artifact was **adhoc-signed** or **not notarized**. Confirm `codesign -dv --verbose=4 …/Harness.app` shows `Developer ID Application: …` (not `Signature=adhoc`). Ensure `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` were set at build time, then run `npm run verify:mac-trust`. Share the **DMG**, not a bare `.app`.
- **“No identity found” / signing fails**  
Run `security find-identity -v -p codesigning` and set `APPLE_SIGNING_IDENTITY` to the exact `Developer ID Application: …` string. On CI, also set `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD`.
- **Notarization fails with “Invalid credentials”**  
Use an **app-specific password** in `APPLE_PASSWORD`, not your normal Apple ID password. Confirm `APPLE_ID` and `APPLE_TEAM_ID` are correct.
- **“The signature of the binary is invalid”**  
Make sure you’re using a **Developer ID Application** certificate (not “Mac Development” or “Apple Distribution”). Re-install the `.cer` or re-export the `.p12` and try again.
- **Notarization Invalid: helper “not signed with a valid Developer ID” / missing hardened runtime / no secure timestamp**  
Apple rejected nested helpers (`HarnessSpeech`, `HarnessFnMonitor` under `Contents/Resources/_up_/resources/`). `dist:mac` must see `APPLE_SIGNING_IDENTITY` when those helpers are built — `scripts/codesign-native-helper.sh` then signs them with `--options runtime --timestamp` before Tauri bundles. Rebuild with `npm run dist:mac` (not a leftover adhoc `resources/` binary from a prior local build).
- **App crashes on launch**  
Check Console.app for Rust panics. Ensure native helpers (`HarnessSpeech`, `HarnessFnMonitor`) were built (`npm run prebuild`).
- **HarnessFnMonitor restart loop / global Fn hotkey not working**  
If logs show `terminated by signal 9`, Crash Reports will usually say `SIGKILL (Code Signature Invalid)` — rebuild the helper (`npm run build:fn-monitor`) so it is codesigned, then restart the app.  
If logs show exit code 1 (Accessibility / event tap), enable **Accessibility** for **Harness Dev** (or **Harness**) and **HarnessFnMonitor** if listed separately in System Settings → Privacy & Security → Accessibility, then restart the app. You can also run `resources/HarnessFnMonitor` once from a terminal to trigger the permission prompt.
- **Microphone denied / Harness missing from Privacy → Microphone**  
Signed builds use the hardened runtime. Without `com.apple.security.device.audio-input` in `bundle.macOS.entitlements`, macOS denies mic access silently (no prompt, no Settings row). Confirm with `codesign -d --entitlements :- /path/to/Harness.app`, rebuild via `npm run dist:mac`, reinstall, then use Settings → Voice → Ask For Microphone.
- **Build without distribution signing (local only)**  
`npm run dist:mac:quick` forces `APPLE_SIGNING_IDENTITY=-` (adhoc). Do not share that DMG.

