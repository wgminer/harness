import { useEffect, useState } from "react";
import { DEFAULT_LAYOUT, type LayoutOptions } from "../../shared/types";

function normalizeLayout(raw: LayoutOptions): LayoutOptions {
  return { sidebar: raw.sidebar === "right" ? "right" : "left" };
}

/** Persisted shell layout (sidebar side), kept live across customization updates. */
export function useLayoutOptions(): LayoutOptions {
  const [layout, setLayout] = useState<LayoutOptions>(DEFAULT_LAYOUT);

  useEffect(() => {
    const load = () => {
      void window.harness.customization.getLayoutOptions().then((raw) => setLayout(normalizeLayout(raw)));
    };
    load();
    return window.harness.customization.onUpdated((p) => {
      if (p.type === "layout") load();
    });
  }, []);

  return layout;
}
