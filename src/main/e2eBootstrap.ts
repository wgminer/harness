import { existsSync, mkdirSync, writeFileSync } from "fs";
import { app } from "electron";
import { join } from "path";
import type { LayoutOptions } from "../shared/types";
import { isHarnessE2E } from "./e2eStub";

function seedE2ELayout(userDataDir: string): void {
  const gridRaw = process.env.HARNESS_E2E_GRID_OVERLAY;
  const gridOverlay: LayoutOptions["gridOverlay"] =
    gridRaw === "4" || gridRaw === "8" || gridRaw === "16" ? gridRaw : "off";
  if (gridOverlay === "off") return;

  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });
  writeFileSync(
    join(userDataDir, "layout.json"),
    JSON.stringify({ sidebar: "left", gridOverlay } satisfies LayoutOptions, null, 2),
    "utf-8",
  );
}

if (isHarnessE2E()) {
  const dir = process.env.HARNESS_E2E_USER_DATA ?? join(process.cwd(), ".e2e-user-data");
  app.setPath("userData", dir);
  seedE2ELayout(dir);
}
