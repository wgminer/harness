/**
 * afterSign hook for electron-builder: notarize the Mac app so Gatekeeper accepts it.
 * Requires env: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 */
const path = require("path");
const { notarize } = require("@electron/notarize");

module.exports = async function afterSign(context) {
  if (process.platform !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      "Skipping notarization: set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID to notarize."
    );
    return;
  }

  await notarize({
    appBundleId: context.packager.config.appId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
    tool: "notarytool",
  });
};
