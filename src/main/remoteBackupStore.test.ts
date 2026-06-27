import { describe, expect, it } from "vitest";
import { isR2ConfigComplete, normalizeR2Prefix } from "./remoteBackupStore";

describe("remoteBackupStore helpers", () => {
  it("normalizes prefix with trailing slash", () => {
    expect(normalizeR2Prefix("harness")).toBe("harness/");
    expect(normalizeR2Prefix("/harness/")).toBe("harness/");
    expect(normalizeR2Prefix("")).toBe("harness/");
  });

  it("detects complete R2 config", () => {
    expect(
      isR2ConfigComplete(
        { accountId: "acc", bucket: "b", prefix: "h/", accessKeyId: "key" },
        true,
      ),
    ).toBe(true);
    expect(isR2ConfigComplete({ accountId: "acc", bucket: "", accessKeyId: "key" }, true)).toBe(false);
    expect(
      isR2ConfigComplete({ accountId: "acc", bucket: "b", accessKeyId: "key" }, false),
    ).toBe(false);
  });
});
