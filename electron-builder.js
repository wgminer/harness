const pkg = require("./package.json");

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.yourcompany.harness",
  productName: "Harness",
  files: ["out", "resources", "package.json"],
  artifactName: "${name}-v${version}-${os}.${ext}",
  mac: {
    category: "public.app-category.utilities",
    icon: "build/icon.icns",
    target: ["dmg", "zip"],
    hardenedRuntime: true,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    gatekeeperAssess: false,
  },
  dmg: {
    sign: false,
  },
  afterSign: "build/notarize.js",
};
