export type SidebarGlyphKind = "chat" | "dictation" | "note" | "image";

/**
 * Leading mark for a sidebar row: filled shapes -- a circle for chats, a small dot
 * for dictations, a square for notes, and a triangle for images. All kinds share one tone.
 */
export function SidebarKindGlyph({ kind }: { kind: SidebarGlyphKind }) {
  return (
    <span className="sidebar-item-glyph" data-glyph={kind} aria-hidden>
      <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" focusable="false">
        {kind === "chat" ? <circle cx="6" cy="6" r="4.5" /> : null}
        {kind === "dictation" ? <circle cx="6" cy="6" r="2.5" /> : null}
        {kind === "note" ? <rect x="2" y="2" width="8" height="8" rx="1" /> : null}
        {kind === "image" ? (
          <path
            d="M6 1.5 L10.5 10 H1.5 Z"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
    </span>
  );
}
