import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function tauriConfVersion(): string {
  const conf = JSON.parse(
    readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")
  ) as { version: string };
  return conf.version;
}

function cargoTomlVersion(): string {
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const match = cargo.match(/^version = "([^"]+)"/m);
  if (!match) throw new Error("No version = \"…\" in src-tauri/Cargo.toml");
  return match[1];
}

describe("version parity", () => {
  it("keeps package.json, Cargo.toml, and tauri.conf.json in sync", () => {
    const pkg = packageVersion();
    expect(tauriConfVersion()).toBe(pkg);
    expect(cargoTomlVersion()).toBe(pkg);
  });
});
