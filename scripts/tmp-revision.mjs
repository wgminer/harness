import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { computeRevision } = await import("../src/main/syncBundle.ts");

const dir = mkdtempSync(join(tmpdir(), "rev-"));
const localData = join(dir, "local-data");
await mkdir(join(localData, "app-state"), { recursive: true });
await mkdir(join(localData, "settings"), { recursive: true });
await writeFile(join(localData, "app-state/conversations.json"), '{"a":1}');
await writeFile(join(localData, "settings/settings.json"), '{"version":1}');
console.log(await computeRevision(localData));
rmSync(dir, { recursive: true, force: true });
