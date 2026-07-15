# Building and signing the Mac app


| Command                    | What it does                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`              | Install project dependencies.                                                                                                                                                                                                                                                                                                                                         |
| `npm run dev`              | Run the app in development mode with hot reload.                                                                                                                                                                                                                                                                                                                      |
| `npm run build`            | Runs **prebuild** first: `icon:icns`, then `build:speech-helper` and `build:fn-monitor` on macOS, then compiles the renderer to `dist-web/`. |
| `npm run dist`             | Full pipeline: native helpers → vite build → `tauri build` (DMG + `.app` on macOS). Does **not** bump version by default (use an explicit bump / release path).                                                                                                                                                                                                         |
| `npm run dist:mac`         | Same as `dist` on macOS. Use for the main Mac build and with `--replace`.                                                                                                                                                                                                                                                               |
| `npm run dist:mac:quick`   | Unsigned local build (`CSC_IDENTITY_AUTO_DISCOVERY=false`, no version bump).                                                                                                                                                                                                                                                               |
| `npm run dist:mac:replace` | `dist:mac` with `--replace`: copy the built `.app` into `/Applications`.                                                                                                                                                                                                                                                                                              |
| `npm run icon:icns`        | Generate `build/icon.icns` from the project icon assets.                                                                                                                                                                                                                                                                                                              |
| `npm run build:speech-helper` | **(macOS)** Build `native/HarnessSpeech` and copy the CLI into `resources/HarnessSpeech`. Needs Xcode Command Line Tools and Swift. |
| `npm run build:fn-monitor` | **(macOS)** Build `native/HarnessFnMonitor` for the global Fn dictation shortcut. |


This guide walks you through creating a double-clickable, signed (and optionally notarized) Mac app using your Apple Developer account.

---

## Dev vs installed profiles

`npm run dev` sets `HARNESS_DEV=1`. That switches the **Application Support directory** and window title — nothing else is split (Dock / tray icons use the same production assets).

| Mode | How you launch | App Support folder (macOS) | Window title |
|------|----------------|----------------------------|--------------|
| Development | `npm run dev` | `~/Library/Application Support/Harness Dev` | **Harness Dev** |
| Installed | `/Applications/Harness.app` or `npm run dist:mac:replace` | `~/Library/Application Support/Harness` | **Harness** |

### What is separate (not shared)

- All app state under that folder: `local-data/` (conversations, messages, tasks, notes, memory, settings, sync state)
- `audio-recordings/` (local-only; never synced)
- Dev may also write a plaintext `credentials.json` under the Dev folder (see [SECURITY.md](SECURITY.md)); production keeps secrets in the OS keychain

### What is shared or external

- R2 backup bucket (same credentials → same remote bundle)
- OpenAI / Tavily API accounts (same keys work in both profiles once entered)
- Signing / notarization env (`CSC_*`, `APPLE_*`, `TAURI_SIGNING_*`) — build-time only, not per profile

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

Grant **Speech Recognition** permission when Harness prompts you (System Settings → Privacy & Security → Speech Recognition). On older macOS, also ensure the dictation language is installed under Keyboard → Dictation.

Packaged apps bundle `HarnessSpeech` in `Contents/Resources/`. Development builds load it from `resources/HarnessSpeech` after `npm run build:speech-helper`.

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

## 3. One-time: Export the certificate as a `.p12` file

Code signing can use a `.p12` so you (or CI) don’t rely on the keychain. Tauri uses the same `CSC_LINK` / `CSC_KEY_PASSWORD` env vars.

1. In **Keychain Access**, select the **login** keychain and the **My Certificates** category.
2. Find **Developer ID Application: Your Name (…)**. Expand it; you should see the certificate and its private key.
3. **Cmd‑click** to select both the certificate and the private key.
4. Right‑click → **Export 2 items…**.
5. Save as e.g. `DeveloperIDApplication.p12`.
6. Choose a **strong password** and remember it; you’ll use it as `CSC_KEY_PASSWORD`.
7. Store the `.p12` somewhere safe (e.g. not in the repo). You’ll point `CSC_LINK` at this file when building.

---

## 4. One-time: App-specific password (for notarization)

Notarization makes Gatekeeper accept your app without “unidentified developer” warnings.

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign In and Security → **App-Specific Passwords**.
2. Generate a new app-specific password (e.g. name: “Harness notarization”).
3. Copy the generated password; you’ll use it as `APPLE_APP_SPECIFIC_PASSWORD` (this is **not** your normal Apple ID password).

---

## 5. Get your Team ID

1. Go to [Apple Developer → Membership](https://developer.apple.com/account#MembershipDetailsCard).
2. Copy your **Team ID** (e.g. `ABCD1234`). You’ll use it as `APPLE_TEAM_ID`.

---

## 6. Build the app (signed and notarized)

Set these environment variables, then run the build. You can put them in a `.env.dist` or export in the shell (don’t commit real values).


| Variable                      | Meaning                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CSC_LINK`                    | Full path to your `.p12` file (e.g. `~/certs/DeveloperIDApplication.p12`)                                                                                                      |
| `CSC_KEY_PASSWORD`            | Password you set when exporting the `.p12`                                                                                                                                     |
| `CSC_NAME`                    | Optional. Use if you have multiple “Developer ID Application” identities; value is the exact name as shown in Keychain (e.g. `Developer ID Application: Your Name (TEAM_ID)`). |
| `APPLE_ID`                    | Your Apple ID email                                                                                                                                                            |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 4                                                                                                                                          |
| `APPLE_TEAM_ID`               | Your Team ID from step 5                                                                                                                                                       |
| `REQUIRE_NOTARIZE`            | Set to `1` or `true` to **fail the build** if notarization credentials are missing (instead of skipping with a warning). `npm run release` sets this automatically.            |


Example (replace with your values):

```bash
export CSC_LINK="$HOME/certs/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="your-p12-password"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCD1234"

npm run dist:mac
```

To copy the built app into `**/Applications**` (replacing an existing install with the same name):

```bash
npm run dist:mac:replace
```

Equivalent: `npm run dist:mac -- --replace` (the dedicated script avoids the extra `--`).

Quit Harness if it is running before replacing, so the copy can succeed.

- If you **omit** the `APPLE_`* variables, the app will still be **signed** (when `CSC_`* is set); the build will skip notarization and print a warning. Other Macs often see Gatekeeper **“unverified”** or **“cannot be opened”** until users override security — **do not ship** builds made this way.
- If you **set** all `APPLE_`* variables, the build will sign and then notarize the app. After notarization, the DMG/zip is ready to distribute.
- `**npm run release`** sets `REQUIRE_NOTARIZE=1`, so a missing `APPLE_`* configuration **fails the build** instead of producing a skipped-notarization artifact.

---

## 7. Verify the build before distributing

On the Mac where you built (or on CI, this runs automatically after pack), confirm the app is signed, passes Gatekeeper, and has a **stapled** notarization ticket:

```bash
npm run verify:mac-trust
```

This looks for `dist/mac-universal/Harness.app`, `dist/mac-arm64/Harness.app`, or `dist/mac/Harness.app`. To check a specific bundle:

```bash
npm run verify:mac-trust -- /path/to/Harness.app
```

**Only share the DMG/ZIP** from a build where `verify:mac-trust` passes. If another computer still shows a warning, compare that machine’s copy against a fresh download: re-download; don’t copy `.app` over AirDrop without the full zip/dmg flow if quarantine attributes differ.

Outputs (for Mac) are under:

- `dist/harness-vx.x.x-mac.dmg` – installer (`harness` comes from `package.json` `name`; `v` matches `version`)
- `dist/harness-vx.x.x-mac.zip` – zip of the app (e.g. for auto-updates)
- `dist/mac-arm64/Harness.app` (and/or `mac/` for Intel) – the app bundle (Dock/Finder title is **Harness**; the semantic version still comes from `package.json` and is shown in the app UI)

You can double‑click `Harness.app` in `dist/mac-`* or the DMG to install and open from the icon.

---

## 8. Release, download site, and auto-update

This project does not commit DMGs to git. Build artifacts land under `dist/` and are published as **GitHub Releases on this repo** (`wgminer/harness`).

The download page lives in [`site/`](site/) and is deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) whenever `site/` changes on `main`. After you make the repo public, enable Pages under **Settings → Pages → Build and deployment → GitHub Actions**.

The landing page download button points to:

- `https://github.com/wgminer/harness/releases/latest`

### One-command release

1. Bump `version` in `package.json` and commit to `main`.
2. Set signing env vars in `.env` (see [`.env.example`](.env.example)): `GH_TOKEN`, Apple notarization (`APPLE_*`), code signing (`CSC_*`), and updater signing (`TAURI_SIGNING_PRIVATE_KEY`).
3. Generate an updater key pair once (if you have not already):

```bash
npx tauri signer generate -w ~/.tauri/harness.key
```

Copy the printed public key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

4. Run:

```bash
npm run release
```

This command:

1. Verifies your git working tree is clean.
2. Builds `dist:mac` with `REQUIRE_NOTARIZE=1` (signed + notarized).
3. Runs `verify:mac-trust`.
4. Collects DMG, ZIP, updater bundle, and `latest.json`, then publishes them to GitHub Releases on this repo.
5. Creates git tag `vX.Y.Z` and pushes tag + `main`.

Installed copies of Harness check GitHub on launch and show an **Update** button in the sidebar when a newer release exists.

Optional flags:

- `npm run release -- --dry-run` — build and verify only; skip publish and git tag.
- `npm run release -- --no-tag` — publish to GitHub but skip git tag push.

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

- **“Unverified developer” / Gatekeeper on another Mac**  
The artifact was likely **not notarized** (notarization was skipped because `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` were not all set at build time). Rebuild with those variables set and run `npm run verify:mac-trust` on the produced `.app`. If verification passes but users still see warnings, ensure they are installing from your **DMG or ZIP**, not a manually copied `.app` missing quarantine clearing.
- **“No identity found” / signing fails**  
Ensure `CSC_LINK` points to the `.p12` and `CSC_KEY_PASSWORD` is correct. If you have multiple Developer ID certs, set `CSC_NAME` to the exact name in Keychain.
- **Notarization fails with “Invalid credentials”**  
Use an **app-specific password**, not your normal Apple ID password. Confirm `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are correct.
- **“The signature of the binary is invalid”**  
Make sure you’re using a **Developer ID Application** certificate (not “Mac Development” or “Apple Distribution”). Re-export the `.p12` and try again.
- **App crashes on launch**  
Check Console.app for Rust panics. Ensure native helpers (`HarnessSpeech`, `HarnessFnMonitor`) were built (`npm run prebuild`).
- **HarnessFnMonitor restart loop / global Fn hotkey not working**  
Enable **Accessibility** for **Harness Dev** (or **Harness**) and **HarnessFnMonitor** if listed separately in System Settings → Privacy & Security → Accessibility, then restart the app. If the helper still fails, run `resources/HarnessFnMonitor` once from a terminal to trigger the permission prompt.
- **Build without signing (local only)**  
To build an unsigned app (not for distribution):  
`CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac:quick`

