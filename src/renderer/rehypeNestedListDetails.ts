import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

/** Wrap nested list blocks in closed <details> so they collapse with CSS-only behavior. */
export function rehypeNestedListDetails() {
  return (tree: Root) => {
    visit(tree, "element", (node, index, parent) => {
      if (index == null || !parent || parent.type !== "element") return;
      if (node.tagName !== "ul" && node.tagName !== "ol") return;
      if (parent.tagName !== "li") return;

      const details: Element = {
        type: "element",
        tagName: "details",
        properties: { className: ["md-nested-list"] },
        children: [
          {
            type: "element",
            tagName: "summary",
            properties: { className: ["md-nested-list__summary"] },
            children: [],
          },
          node,
        ],
      };

      parent.children[index] = details;
    });
  };
}
