import { parseLibraryHref } from "./conversationSearch";

/**
 * Extract a local filesystem path from a markdown href or inline-code string.
 * Supports `file://` URLs, absolute Unix paths, `~/…`, and Windows drive paths.
 * Returns null for library hrefs (`/c/…`, `/n/…`, `/i/…`) and non-file schemes.
 */
export function parseLocalFilePath(raw: string): string | null {
  const value = raw.trim().replace(/^`+|`+$/g, "").trim();
  if (!value) return null;
  if (parseLibraryHref(value)) return null;

  // Windows drive paths before scheme detection (`C:` looks like a protocol).
  if (/^[A-Za-z]:[\\/]/.test(value)) return value;

  if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(value)) {
    if (!/^file:/i.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "file:") return null;
      let pathname = decodeURIComponent(url.pathname);
      // Node/Chromium give `file:///C:/…` as pathname `/C:/…`.
      if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      return pathname.length > 0 ? pathname : null;
    } catch {
      return null;
    }
  }

  if (value === "~" || value.startsWith("~/")) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return null;
}
