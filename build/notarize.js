/**
 * afterSign hook for electron-builder: notarize the Mac app so Gatekeeper accepts it.
 * Requires env: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 */
const path = require("path");
const { notarize } = require("@electron/notarize");

module.exports = async function afterSign(context) {
  if (process.platform !== "darwin") return;

  const unsigned =
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false" ||
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === "0";
  if (unsigned) {
    console.warn("Skipping notarization: code signing disabled (CSC_IDENTITY_AUTO_DISCOVERY=false).");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  const requireNotarize =
    process.env.REQUIRE_NOTARIZE === "1" ||
    process.env.REQUIRE_NOTARIZE === "true";

  if (!appleId || !appleIdPassword || !teamId) {
    if (requireNotarize) {
      throw new Error(
        "Notarization is required (REQUIRE_NOTARIZE) but one or more of APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID are missing."
      );
    }
    console.warn(
      "Skipping notarization: set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID to notarize. For release builds, set REQUIRE_NOTARIZE=1 to fail instead of skipping."
    );
    return;
  }

  // The upload to Apple's notary service can fail transiently (e.g. connection
  // reset mid-upload). Retry so a network blip doesn't kill a long build.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await notarize({
        appBundleId: context.packager.config.appId,
        appPath,
        appleId,
        appleIdPassword,
        teamId,
        tool: "notarytool",
      });
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delaySeconds = 30 * attempt;
      console.warn(
        `Notarization attempt ${attempt}/${maxAttempts} failed: ${err.message}\nRetrying in ${delaySeconds}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }
};
