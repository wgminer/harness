/** True when the renderer is inside a Tauri webview (desktop app). */
export function isTauriRuntime(win: Window = window): boolean {
  const candidate = win as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return candidate.__TAURI_INTERNALS__ != null || candidate.__TAURI__ != null;
}
