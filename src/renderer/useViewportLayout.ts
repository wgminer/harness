import { useState, useEffect } from "react";
import { LAYOUT_COMPACT_MAX_WIDTH_PX, WINDOW_SMALL_PRESET_MAX_WIDTH_PX } from "../shared/windowLayout";

export function useViewportLayout(): { compactLayout: boolean; presetSmall: boolean } {
  const read = () => {
    const w = window.innerWidth;
    return {
      compactLayout: w <= LAYOUT_COMPACT_MAX_WIDTH_PX,
      presetSmall: w <= WINDOW_SMALL_PRESET_MAX_WIDTH_PX,
    };
  };

  const [state, setState] = useState(read);

  useEffect(() => {
    const update = () => setState(read());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return state;
}
