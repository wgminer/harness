import { app } from "electron";
import { join } from "path";
import { isHarnessDev, isHarnessE2E } from "./e2eStub";

export const HARNESS_DEV_APP_NAME = "Harness Dev";

/** Dev builds get their own Dock name and userData so they do not collide with production. */
if (isHarnessDev() && !isHarnessE2E()) {
  app.setName(HARNESS_DEV_APP_NAME);
  app.setPath("userData", join(app.getPath("appData"), HARNESS_DEV_APP_NAME));
}
