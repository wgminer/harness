import { app } from "electron";
import { join } from "path";
import { isHarnessE2E } from "./e2eStub";

if (isHarnessE2E()) {
  const dir = process.env.HARNESS_E2E_USER_DATA ?? join(process.cwd(), ".e2e-user-data");
  app.setPath("userData", dir);
}
