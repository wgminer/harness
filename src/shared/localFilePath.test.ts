import { describe, expect, it } from "vitest";
import { parseLocalFilePath } from "./localFilePath";

describe("parseLocalFilePath", () => {
  it("parses file:// URLs", () => {
    expect(parseLocalFilePath("file:///Users/wgm/Projects/harness/src/foo.ts")).toBe(
      "/Users/wgm/Projects/harness/src/foo.ts",
    );
    expect(parseLocalFilePath("file:///tmp/a%20b.txt")).toBe("/tmp/a b.txt");
  });

  it("parses Windows file:// URLs", () => {
    expect(parseLocalFilePath("file:///C:/Users/wgm/file.txt")).toBe("C:/Users/wgm/file.txt");
  });

  it("parses absolute and home-relative paths", () => {
    expect(parseLocalFilePath("/Users/wgm/Projects/harness")).toBe("/Users/wgm/Projects/harness");
    expect(parseLocalFilePath("~/Library/Application Support/Harness")).toBe(
      "~/Library/Application Support/Harness",
    );
    expect(parseLocalFilePath("C:\\Users\\wgm\\file.txt")).toBe("C:\\Users\\wgm\\file.txt");
  });

  it("accepts backtick-wrapped paths", () => {
    expect(parseLocalFilePath("`/Users/wgm/x.ts`")).toBe("/Users/wgm/x.ts");
  });

  it("rejects library hrefs and non-file schemes", () => {
    expect(parseLocalFilePath("/c/conv_1")).toBeNull();
    expect(parseLocalFilePath("/n/note_1")).toBeNull();
    expect(parseLocalFilePath("https://example.com/x")).toBeNull();
    expect(parseLocalFilePath("src/relative.ts")).toBeNull();
    expect(parseLocalFilePath("")).toBeNull();
  });
});
