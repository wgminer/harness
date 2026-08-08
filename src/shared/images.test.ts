import { describe, expect, it } from "vitest";
import {
  imageVersionChildren,
  imageVersionLabel,
  type ImageVersion,
} from "./images";

function ver(
  partial: Pick<ImageVersion, "id" | "parentId" | "branch" | "indexInBranch">,
): ImageVersion {
  return {
    fileName: `${partial.id}.png`,
    prompt: partial.id,
    kind: "generate",
    size: "auto",
    quality: "auto",
    background: "auto",
    outputFormat: "png",
    createdAt: 0,
    ...partial,
  };
}

describe("imageVersionLabel", () => {
  it("formats branch + index", () => {
    expect(imageVersionLabel({ branch: "A", indexInBranch: 2 })).toBe("A2");
    expect(imageVersionLabel({ branch: "B", indexInBranch: 1 })).toBe("B1");
  });
});

describe("imageVersionChildren", () => {
  const versions = [
    ver({ id: "a1", parentId: null, branch: "A", indexInBranch: 1 }),
    ver({ id: "a2", parentId: "a1", branch: "A", indexInBranch: 2 }),
    ver({ id: "b1", parentId: "a1", branch: "B", indexInBranch: 1 }),
    ver({ id: "b2", parentId: "b1", branch: "B", indexInBranch: 2 }),
  ];

  it("returns roots and ordered siblings", () => {
    expect(imageVersionChildren(versions, null).map((v) => v.id)).toEqual(["a1"]);
    expect(imageVersionChildren(versions, "a1").map((v) => v.id)).toEqual(["a2", "b1"]);
  });
});
