import { useState, useEffect } from "react";
import { WINDOW_SMALL_PRESET_MAX_WIDTH_PX } from "../shared/windowLayout";

export function useViewportLayout(): { presetSmall: boolean } {
  const read = () => ({
    presetSmall: window.innerWidth <= WINDOW_SMALL_PRESET_MAX_WIDTH_PX,
  });

  const [state, setState] = useState(read);

  useEffect(() => {
    const update = () => setState(read());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return state;
}
