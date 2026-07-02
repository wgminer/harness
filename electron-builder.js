const fs = require("fs");
const path = require("path");

// Load repo-root .env so APPLE_* (notarization) and other build-time vars are set.
require("dotenv").config({ path: path.join(__dirname, ".env") });

const extraResources = [
  {
    from: "resources/parakeet",
    to: "parakeet",
    filter: ["parakeet", "libaxiom.0.dylib"],
  },
];
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
    "!resources/parakeet/**",
    "!resources/HarnessFnMonitor",
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
