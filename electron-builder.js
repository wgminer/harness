const fs = require("fs");
const path = require("path");

// Load repo-root .env so APPLE_* (notarization) and other build-time vars are set.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const extraResources = [];
const speechHelperPath = path.join(__dirname, "resources", "HarnessSpeech");
if (fs.existsSync(speechHelperPath)) {
  extraResources.push({ from: "resources/HarnessSpeech", to: "HarnessSpeech" });
}
const fnMonitorPath = path.join(__dirname, "resources", "HarnessFnMonitor");
if (fs.existsSync(fnMonitorPath)) {
  extraResources.push({ from: "resources/HarnessFnMonitor", to: "HarnessFnMonitor" });
}

const unsigned =
  process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false" ||
  process.env.CSC_IDENTITY_AUTO_DISCOVERY === "0";

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.yourcompany.harness",
  productName: "Harness",
  files: [
    "out",
    "resources",
    "!resources/HarnessSpeech",
    "!resources/HarnessFnMonitor",
    // Legacy local Parakeet model weights (~2.3 GB); gitignored, unused at
    // runtime, and must never be packed into the app.
    "!resources/parakeet",
    "package.json",
  ],
  extraResources,
  artifactName: "${name}-v${version}-${os}.${ext}",
  mac: {
    category: "public.app-category.utilities",
    icon: "build/icon.icns",
    target: ["dmg", "zip"],
    identity: unsigned ? null : undefined,
    hardenedRuntime: !unsigned,
    ...(unsigned
      ? {}
      : {
          entitlements: "build/entitlements.mac.plist",
          entitlementsInherit: "build/entitlements.mac.plist",
        }),
    gatekeeperAssess: false,
    extendInfo: {
      NSMicrophoneUsageDescription: "Harness uses your microphone to record voice messages for transcription.",
      NSSpeechRecognitionUsageDescription:
        "Harness uses speech recognition to transcribe your voice recordings on this Mac.",
    },
  },
  dmg: {
    sign: false,
  },
  publish: {
    provider: "github",
    owner: "wgminer",
    repo: "harness",
  },
  afterSign: unsigned ? undefined : "build/notarize.js",
};
