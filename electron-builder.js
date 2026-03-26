const fs = require("fs");
const path = require("path");

const extraResources = [{ from: "resources/parakeet", to: "parakeet" }];
const fnMonitorPath = path.join(__dirname, "resources", "HarnessFnMonitor");
if (fs.existsSync(fnMonitorPath)) {
  extraResources.push({ from: "resources/HarnessFnMonitor", to: "HarnessFnMonitor" });
}

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
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    gatekeeperAssess: false,
    extendInfo: {
      NSMicrophoneUsageDescription: "Harness uses your microphone to record voice messages for transcription.",
    },
  },
  dmg: {
    sign: false,
  },
  afterSign: "build/notarize.js",
};
