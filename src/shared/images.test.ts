import { describe, expect, it } from "vitest";
import {
  displayVersionLabel,
  imageVersionChildren,
  imageVersionLabel,
  isLeafVersion,
  orderedImageVersions,
  parentVersionId,
  versionDisplayIndex,
  versionDisplayIndexMap,
  type ImageVersion,
} from "./images";
import { IMAGE_MARKER_PROMPT_PREFIX, buildMarkerAdjustPrompt } from "./imageMarkerPrompt";

function ver(
  partial: Pick<ImageVersion, "id" | "parentId" | "branch" | "indexInBranch"> & {
    createdAt?: number;
  },
): ImageVersion {
  return {
    fileName: `${partial.id}.png`,
    prompt: partial.id,
    kind: "generate",
    size: "auto",
    quality: "auto",
    background: "auto",
    outputFormat: "png",
    createdAt: partial.createdAt ?? 0,
    ...partial,
  };
}

const treeImage = {
  versions: [
    ver({ id: "a1", parentId: null, branch: "A", indexInBranch: 1, createdAt: 10 }),
    ver({ id: "a2", parentId: "a1", branch: "A", indexInBranch: 2, createdAt: 20 }),
    ver({ id: "b1", parentId: "a1", branch: "B", indexInBranch: 1, createdAt: 30 }),
    ver({ id: "b2", parentId: "b1", branch: "B", indexInBranch: 2, createdAt: 40 }),
  ],
};

describe("imageVersionLabel", () => {
  it("formats branch + index for fork metadata", () => {
    expect(imageVersionLabel({ branch: "A", indexInBranch: 2 })).toBe("A2");
    expect(imageVersionLabel({ branch: "B", indexInBranch: 1 })).toBe("B1");
  });
});

describe("display version labels", () => {
  it("assigns sequential vN labels by createdAt order", () => {
    expect(orderedImageVersions(treeImage).map((v) => v.id)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(versionDisplayIndex(treeImage, "b1")).toBe(3);
    expect(displayVersionLabel(treeImage, "b1")).toBe("v3");
    expect(displayVersionLabel(treeImage, "a2")).toBe("v2");
    expect(versionDisplayIndexMap(treeImage).get("b2")).toBe(4);
  });

  it("breaks createdAt ties by id", () => {
    const image = {
      versions: [
        ver({ id: "z", parentId: null, branch: "A", indexInBranch: 1, createdAt: 5 }),
        ver({ id: "a", parentId: null, branch: "A", indexInBranch: 2, createdAt: 5 }),
      ],
    };
    expect(orderedImageVersions(image).map((v) => v.id)).toEqual(["a", "z"]);
    expect(displayVersionLabel(image, "z")).toBe("v2");
  });
});

describe("version tree helpers", () => {
  it("returns roots and ordered siblings", () => {
    const versions = treeImage.versions;
    expect(imageVersionChildren(versions, null).map((v) => v.id)).toEqual(["a1"]);
    expect(imageVersionChildren(versions, "a1").map((v) => v.id)).toEqual(["a2", "b1"]);
  });

  it("reports parent and leaf status", () => {
    expect(parentVersionId(treeImage, "b2")).toBe("b1");
    expect(parentVersionId(treeImage, "a1")).toBeNull();
    expect(isLeafVersion(treeImage, "b2")).toBe(true);
    expect(isLeafVersion(treeImage, "a1")).toBe(false);
    expect(isLeafVersion(treeImage, "a2")).toBe(true);
    expect(isLeafVersion(treeImage, "b1")).toBe(false);
  });
});

describe("imageMarkerPrompt", () => {
  it("exports the contract prefix", () => {
    expect(IMAGE_MARKER_PROMPT_PREFIX).toContain("marked in red");
  });

  it("prepends prefix to user prompt", () => {
    expect(buildMarkerAdjustPrompt("make it bluer")).toBe(
      `${IMAGE_MARKER_PROMPT_PREFIX}\n\nmake it bluer`,
    );
    expect(buildMarkerAdjustPrompt("  ")).toBe(IMAGE_MARKER_PROMPT_PREFIX);
  });
});
