import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";

let userDataDir = "/tmp/harness-parakeet-paths";
let appPath = "/tmp/harness-app-path";
let packaged = false;
let resourcesPath = "/tmp/harness-resources";

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return packaged;
    },
    getAppPath: () => appPath,
    getPath: (name: string) => {
      if (name === "userData") return userDataDir;
      return `/tmp/${name}`;
    },
  },
}));

import {
  getParakeetRuntimeDir,
  PARAKEET_FILENAMES,
} from "./parakeetPaths";
import {
  getParakeetModelDir,
  isParakeetModelInstalled,
  resolveParakeetModelDir,
} from "./parakeetModelInstall";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    if (c) await c();
  }
});

beforeEach(async () => {
  const temp = await createTempDir("parakeet-paths-");
  userDataDir = temp.path;
  cleanups.push(temp.cleanup);
  packaged = false;
  appPath = join(temp.path, "app");
  resourcesPath = join(appPath, "resources", "parakeet");
  mkdirSync(resourcesPath, { recursive: true });
});

describe("parakeetPaths", () => {
  it("resolves dev runtime dir under app resources", () => {
    expect(getParakeetRuntimeDir()).toBe(resourcesPath);
  });

  it("uses dev resources for model when weights exist", () => {
    writeFileSync(join(resourcesPath, PARAKEET_FILENAMES.weights), "w");
    writeFileSync(join(resourcesPath, PARAKEET_FILENAMES.vocab), "v");
    expect(resolveParakeetModelDir()).toBe(resourcesPath);
  });

  it("uses userData model dir when dev weights missing", () => {
    expect(resolveParakeetModelDir()).toBe(getParakeetModelDir());
  });

  it("isParakeetModelInstalled with marker and sizes", async () => {
    const modelDir = getParakeetModelDir();
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, PARAKEET_FILENAMES.weights), Buffer.alloc(10));
    writeFileSync(join(modelDir, PARAKEET_FILENAMES.vocab), Buffer.alloc(3));
    writeFileSync(
      join(modelDir, "installed.json"),
      JSON.stringify({
        version: "1",
        weightsSha256: "x",
        vocabSha256: "y",
        weightsBytes: 10,
        vocabBytes: 3,
      })
    );
    expect(await isParakeetModelInstalled()).toBe(true);
  });
});
