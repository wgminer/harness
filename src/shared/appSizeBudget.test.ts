import { describe, expect, it } from "vitest";
import {
  budgetLineCountSwift,
  physicalLineCount,
  stripSwiftPreviewBlocks,
} from "./appSizeBudget";

describe("appSizeBudget", () => {
  it("counts physical lines like wc -l", () => {
    expect(physicalLineCount("")).toBe(0);
    expect(physicalLineCount("a\n")).toBe(1);
    expect(physicalLineCount("a\nb\n")).toBe(2);
    expect(physicalLineCount("a\nb")).toBe(2);
  });

  it("strips brace-balanced #Preview blocks", () => {
    const src = [
      "struct Foo: View {",
      "  var body: some View { Text(\"hi\") }",
      "}",
      "",
      "#Preview(\"Foo\") {",
      "  Foo()",
      "  VStack {",
      "    Text(\"nested\")",
      "  }",
      "}",
      "",
      "struct Bar {}",
      "",
    ].join("\n");

    const stripped = stripSwiftPreviewBlocks(src);
    expect(stripped).toContain("struct Foo");
    expect(stripped).toContain("struct Bar");
    expect(stripped).not.toContain("#Preview");
    expect(stripped).not.toContain("nested");
    expect(budgetLineCountSwift(src)).toBeLessThan(physicalLineCount(src));
  });
});
