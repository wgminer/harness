# Building and signing the Mac app

This guide walks you through creating a double-clickable, signed (and optionally notarized) Mac app using your Apple Developer account.

---

## 1. One-time: Install dependencies

```bash
npm install
npm run icon:icns   # already done if you have build/icon.icns
```

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

electron-builder can use a `.p12` so you (or CI) don’t rely on the keychain.

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
2. Generate a new app-specific password (e.g. name: “Electron notarization”).
3. Copy the generated password; you’ll use it as `APPLE_APP_SPECIFIC_PASSWORD` (this is **not** your normal Apple ID password).

---

## 5. Get your Team ID

1. Go to [Apple Developer → Membership](https://developer.apple.com/account#MembershipDetailsCard).
2. Copy your **Team ID** (e.g. `ABCD1234`). You’ll use it as `APPLE_TEAM_ID`.

---

## 6. Build the app (signed and notarized)

Set these environment variables, then run the build. You can put them in a `.env.dist` or export in the shell (don’t commit real values).

| Variable | Meaning |
|----------|--------|
| `CSC_LINK` | Full path to your `.p12` file (e.g. `~/certs/DeveloperIDApplication.p12`) |
| `CSC_KEY_PASSWORD` | Password you set when exporting the `.p12` |
| `CSC_NAME` | Optional. Use if you have multiple “Developer ID Application” identities; value is the exact name as shown in Keychain (e.g. `Developer ID Application: Your Name (TEAM_ID)`). |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 4 |
| `APPLE_TEAM_ID` | Your Team ID from step 5 |

Example (replace with your values):

```bash
export CSC_LINK="$HOME/certs/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="your-p12-password"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCD1234"

npm run dist:mac
```

- If you **omit** the `APPLE_*` variables, the app will still be **signed**; the build will skip notarization and print a warning. The app will run but users may see Gatekeeper warnings.
- If you **set** all of them, the build will sign and then notarize the app. After notarization, the DMG/zip is ready to distribute.

Outputs (for Mac) are under:

- `dist/Harness-x.x.x.dmg` – installer
- `dist/Harness-x.x.x-mac.zip` – zip of the app (e.g. for auto-updates)
- `dist/mac-arm64/Harness.app` (and/or `mac/` for Intel) – the actual app bundle

You can double‑click `Harness.app` or the DMG to install and open from the icon.

---

## 7. Optional: Customize app id and name

In `package.json`, under `build`:

- `appId`: e.g. `com.yourcompany.client` (use your reverse-DNS bundle id).
- `productName`: displayed name of the app (default here: “Harness”).

Update `author` and `description` in `package.json` as needed.

---

## Troubleshooting

- **“No identity found” / signing fails**  
  Ensure `CSC_LINK` points to the `.p12` and `CSC_KEY_PASSWORD` is correct. If you have multiple Developer ID certs, set `CSC_NAME` to the exact name in Keychain.

- **Notarization fails with “Invalid credentials”**  
  Use an **app-specific password**, not your normal Apple ID password. Confirm `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are correct.

- **“The signature of the binary is invalid”**  
  Make sure you’re using a **Developer ID Application** certificate (not “Mac Development” or “Apple Distribution”). Re-export the `.p12` and try again.

- **App crashes on launch (e.g. JIT)**  
  The included `build/entitlements.mac.plist` enables JIT and unsigned executable memory for Electron. If you change entitlements, ensure those are still present for your use case.

- **Build without signing (local only)**  
  To build an unsigned app (not for distribution):  
  `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac`
