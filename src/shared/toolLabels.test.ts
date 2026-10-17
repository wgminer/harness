import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import contract from "../../resources/contracts/toolLabels.json";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("resources/contracts/toolLabels.json", () => {
  it("has a non-empty label for every tool", () => {
    for (const [name, label] of Object.entries(contract.labels)) {
      expect(name).toMatch(/^[a-z_]+$/);
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("is the only place tool labels are written (desktop and iOS read the file)", () => {
    const desktop = read("src/renderer/chat/chatHelpers.tsx");
    const ios = read("ios/HarnessMobile/Chat/TaskToolExecutor.swift");
    expect(desktop).toContain("resources/contracts/toolLabels.json");
    expect(ios).toContain('forResource: "toolLabels"');
    for (const label of new Set(Object.values(contract.labels))) {
      expect(desktop).not.toContain(`"${label}"`);
      expect(ios).not.toContain(`"${label}"`);
    }
  });

  it("is bundled for iOS (pbxproj resource)", () => {
    expect(read("ios/HarnessMobile.xcodeproj/project.pbxproj")).toContain("toolLabels.json in Resources");
  });
});
