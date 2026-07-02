import { rm } from "fs/promises";
import { join } from "path";
import { app } from "electron";

const LEGACY_PARAKEET_MODEL_DIR = "parakeet-model";

/** One-time cleanup: remove leftover Parakeet model weights from userData. */
export async function cleanupLegacyParakeetModel(): Promise<void> {
  if (process.platform !== "darwin") return;
  const modelDir = join(app.getPath("userData"), LEGACY_PARAKEET_MODEL_DIR);
  await rm(modelDir, { recursive: true, force: true }).catch(() => {});
}
