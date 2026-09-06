import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");

interface SelfModifyContract {
  aspects: Record<string, string[]>;
}

function readContract(): SelfModifyContract {
  const raw = readFileSync(join(root, "resources/contracts/selfModifyScopes.json"), "utf8");
  return JSON.parse(raw) as SelfModifyContract;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "dist-web") continue;
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Minimal `**` / `*` glob match for contract drift tests. */
function globMatch(pattern: string, path: string): boolean {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${esc}$`).test(path);
}

describe("resources/contracts/selfModifyScopes.json", () => {
  it("has ui and css aspects with renderer-only globs", () => {
    const contract = readContract();
    expect(Object.keys(contract.aspects)).toEqual(expect.arrayContaining(["ui", "css"]));
    const patterns = Object.values(contract.aspects).flat();
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(pattern.startsWith("src/renderer/"), `glob escapes renderer: ${pattern}`).toBe(true);
    }
  });

  it("every aspect glob matches at least one real file", () => {
    const contract = readContract();
    const files = walkFiles(join(root, "src/renderer")).map((f) =>
      relative(root, f).replace(/\\/g, "/"),
    );
    for (const [aspect, patterns] of Object.entries(contract.aspects)) {
      for (const pattern of patterns) {
        const hit = files.some((f) => globMatch(pattern, f));
        expect(hit, `${aspect} glob ${pattern} matched no files`).toBe(true);
      }
    }
  });
});
