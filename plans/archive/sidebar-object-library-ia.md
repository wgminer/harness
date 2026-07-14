# Plan: Sidebar object-library IA

> **Archived (shipped).** Object-library sidebar IA landed (notes/images in list; Editor tab removed). Remaining Phase 2 CSS polish (Tasks/System → shared `.sidebar-item`) tracked under v0.8 workstream D in [plans/2026-07-14-consolidation.md](../2026-07-14-consolidation.md).

**Status:** Shipped / archived  
**Created:** 2026-07-12  
**Audience:** Implementing LLM / engineer (handoff doc)  
**Product:** Harness desktop (`src/renderer`)

---

## Goal

Move from “conversations list + peer workspace tabs (Tasks / Editor / System)” to:

1. **Object library** in the sidebar — a unified chronological (or sortable) list of user-created artifacts.
2. **Cross-cutting meta destinations** above that list — surfaces that organize, configure, or track work *across* objects, not peer content types.

### Target sidebar anatomy

```
[ New ▾ ]  [ Search ]

Tasks · System          ← meta row (Projects optional later)
─────────────────────
Today
  🎤 Dictation @ 9:41
  💬 Refactor sync merge
  📝 Meeting notes
  …
Yesterday
  …
```

### Target content types (object library)

| Kind | Today | In this migration |
|------|--------|-------------------|
| Chat | Sidebar conversation list | Keep |
| Dictation | Same list, mic icon | Keep |
| Note | Behind **Editor** workspace tab → `NotesView` | **Move into sidebar list** |
| Generated image | Not built | **Stub / extension point only** — do not ship gallery UI |
| Plan (agent plan) | Data + API, no UI | **Out of scope** for this IA pass |
| Audio recording | Attached to conversations | Stay attached; not a top-level list kind |

### Target meta destinations

| Item | Role | This pass |
|------|------|-----------|
| **Tasks** | Cross-cutting work queue | Keep as workspace button |
| **System** | Settings (`view === "settings"`, label System) | Keep |
| **Search** | Tool over the library | Keep; extend to notes when notes are in the list |
| **Projects** | Scope / container across objects | **Defer** — design-ready, not implement |
| **Editor** | Notes list + editor shell | **Remove** as a peer nav item |

---

## Why (product rule)

- **Object list:** things the user creates and returns to (chat, dictation, note, later image).
- **Meta row:** things that organize, configure, or track work across those objects (Tasks, System; later Projects / Activity).

Notes are documents, not a “mode.” Editor-as-tab incorrectly elevates one content type to the same level as Tasks/System.

---

## Current state (as of plan date)

### Views

```ts
// src/renderer/sidebarUtils.ts
export type View = "chat" | "settings" | "tasks" | "notes";
```

Same set in `src/shared/uiSession.ts` (`UiSessionView`). Legacy `"clippings"` already migrates → `"notes"`.

### Sidebar (`src/renderer/Sidebar.tsx`)

- **New** menu: New chat (⌘N), New note (⇧⌘N)
- **Workspace nav:** Tasks · Editor · System
- **List:** conversations only (`ConversationListRow`), grouped by date / sort mode
- Editor button active when `view === "notes" && notesScreen === "list"` (`notesItemActive`)

### Notes today

- Full list + detail UI lives in `NotesView` (`WritingSurfaceView.tsx`)
- `App.tsx` holds `notesScreen: "list" | "detail"`, `activeNoteId`
- Sticky/windowed notes via `RootApp` / `WindowedNoteView` — keep; same note objects, different window
- Chat can create/open notes (`onOpenNotesView`)

### Related but not this plan

- `plans.json` / `harness.plans` loaded in `App.tsx` but UI suppressed (`void plans`)
- Memory import text mentions “Projects & Plans” — not a nav feature
- Tasks already have tags (`TasksView`) — light grouping without Projects

---

## Non-goals (explicit)

1. Do **not** implement Projects UI or project scoping in this pass (document extension point only).
2. Do **not** implement generated-image library UI (reserve kind + New menu placeholder only if cheap; otherwise omit until images exist).
3. Do **not** put Plans into the object list unless product later decides plans are durable documents.
4. Do **not** redesign Tasks or System internals beyond nav wiring / active states.
5. Do **not** change sticky-note window behavior except how “open note” is selected from the main window.
6. Avoid drive-by refactors unrelated to IA.

---

## Proposed data model for sidebar rows

Introduce a unified list row type (name flexible; suggested):

```ts
export type LibraryObjectKind = "chat" | "dictation" | "note" | "image";

export type LibraryListRow = {
  id: string;
  kind: LibraryObjectKind;
  title: string | null;
  /** Sort / group timestamp — typically updatedAt for notes, createdAt or last activity for chats */
  sortAt: number;
  // kind-specific optional fields:
  sessionKind?: "dictation" | "chat"; // for conversation icon rules
  hasAssistantReply?: boolean;
  hasMessages?: boolean;
};
```

**Merging rules**

- Conversations: reuse existing `ConversationListRow` + `conversationSidebarIconKind` / visibility (`isSidebarVisibleConversation`).
- Notes: from `window.harness.notes.list()` — map to `kind: "note"`, `sortAt` = note updatedAt (or createdAt if no updated field).
- Hide empty chats the same way as today; notes with empty body — product choice: **show** notes once created (unlike empty chats), unless current notes list already filters; match existing `NotesView` list behavior.
- Sort/group: reuse `groupConversationsForSidebar` patterns in `sidebarUtils.ts`, generalized to `LibraryListRow` (same Today / Yesterday / … keys on `sortAt`).

**Selection model**

- Selecting a chat/dictation → `view = "chat"`, `conversationId = id`
- Selecting a note → `view = "notes"`, `notesScreen = "detail"`, `activeNoteId = id`  
  (Keep internal view id `"notes"` for session restore; only the **Editor workspace button** goes away.)
- Active row highlighting: conversation when `view === "chat" && conversationId === id`; note when `view === "notes" && activeNoteId === id` (including detail — unlike today where Editor is only active on list).

**Optional later:** drop `notesScreen === "list"` entirely if the sidebar *is* the list; opening NotesView always in detail (or empty state when no note selected).

---

## Phased implementation

### Phase 0 — Prep (small)

1. Confirm note list API shape (`desktopAPI` notes.list / read) and fields available for title + timestamps.
2. Inventory tests/UI selectors that assume Editor nav:
   - `data-testid="sidebar-notes"`
   - any Playwright / unit tests for workspace nav
3. Keep `View` including `"notes"` for detail routing; do not invent a new top-level view for “library.”

### Phase 1 — Remove Editor from meta row; open notes from library

1. **Sidebar UI**
   - Remove Editor button from `sidebar-workspace` nav.
   - Meta row becomes **Tasks · System** only.
   - Extend list rendering: icons/labels per `kind` (reuse chat/dictation icons; note = existing SquarePen or note icon).
2. **App.tsx**
   - Load notes list alongside conversations (or pass notes into Sidebar).
   - Merge + sort into library rows.
   - `onSelectLibraryItem(row)` switches chat vs note as above.
   - `onNewNote` / ⇧⌘N: create note then select it in library (same as today but without navigating via Editor tab). Prefer main-window detail unless sticky preference is on (`openNoteInStickyWindow`).
3. **NotesView**
   - Prefer **detail-only** in main pane when opened from sidebar (list UI becomes redundant).
   - Keep list UI temporarily only if needed for empty state / templates — goal is sidebar owns browsing.
   - Preserve sticky, print, show-in-folder, templates flows.
4. **Session restore** (`uiSession.ts`)
   - Continue restoring `notesOpenNoteId` → open that note detail.
   - No migration needed for removing Editor tab (session never stored “editor” as separate from `notes`).
5. **Search**
   - Minimum: keep conversation search; update aria-label to “Search” if still conversation-only.
   - Better (same phase if cheap): search notes titles/body and return mixed results with kind.

### Phase 2 — Polish & consistency

1. Empty states: library empty copy; note-selected empty editor.
2. Pagination (“More”): apply to merged list, not conversations-only.
3. Context menus / delete: ensure note delete/remove from sidebar if conversation rows support similar actions.
4. CSS: `sidebar-workspace` with 2 buttons; update comments that say “Tasks / Notes / System.”
5. Update any user-facing copy that says “Editor” as a place (headers, setup notice deep links) — note surface title may stay “Editor” or become the note title; prefer **note title in header**, not “Editor” page chrome, if easy.

### Phase 3 — Deferred extensions (do not implement unless asked)

Document only for handoff continuity:

#### Projects (meta / scope)

- New optional workspace destination or scope control: **Projects**.
- Model: project id + name; objects (and optionally tasks) reference `projectId | null`.
- Sidebar: filter library by active project or “All”.
- Not an object kind in the list.
- Until needed, tags on tasks + single implicit All scope are enough.

#### Generated images

- Implemented as peer library objects — see `2026-07-12-image-objects.md` (this archive folder).
- `kind: "image"` in library, New → New image, canvas + right controls panel.

#### Plans

- Either meta (like Tasks) or objects — **decide later**. Current API links plans ↔ conversations; closer to Tasks/process than Notes until product says otherwise.

#### Activity / Inbox / Today overview

- Optional fourth meta surface for cross-object events; not required for this IA.

---

## Key files to touch

| Area | Path |
|------|------|
| Sidebar UI | `src/renderer/Sidebar.tsx`, `src/renderer/sidebar.css` |
| List helpers | `src/renderer/sidebarUtils.ts` |
| Shell / state | `src/renderer/App.tsx` |
| Notes surface | `src/renderer/WritingSurfaceView.tsx` (`NotesView`) |
| Session | `src/shared/uiSession.ts` (+ tests) |
| Conversation row helpers | `src/shared/conversationSession.ts` |
| Notes API | `src/shared/desktopAPI.ts`, `src/renderer/desktopAdapter.ts` |
| System label | `src/shared/rigPage.ts` |
| Tests | `src/shared/uiSession.test.ts`, any Sidebar / Playwright coverage |

---

## Acceptance criteria

- [ ] Sidebar meta row shows **Tasks** and **System** only (no Editor).
- [ ] Notes appear in the same sidebar list as chats/dictations, with a distinct icon.
- [ ] Clicking a note opens the note editor in the main pane; clicking a chat opens chat.
- [ ] New note (menu + ⇧⌘N) creates a note and selects it in the library (respect sticky preference).
- [ ] New chat unchanged.
- [ ] Session restore still reopens the last chat or last open note.
- [ ] Sticky/windowed notes still work.
- [ ] Chat → save/open note (`onOpenNotesView`) still works and selects the note in the sidebar.
- [ ] Tasks and System behavior unchanged aside from layout of the meta row.
- [ ] Existing tests updated; no reliance on `sidebar-notes` workspace button (replace with library row selection tests).

---

## Implementation notes for the coding agent

1. **Prefer small PRs:** (A) unified list model + merge without removing Editor, (B) remove Editor + detail-only notes, (C) search expansion — or A+B together if tightly coupled.
2. **Match existing patterns:** list-item-base, sidebar sort modes, fade wrappers, `RIG_PAGE_TITLE` for System.
3. **Do not** rename `view: "settings"` persistence to `"system"` unless necessary — label is already System via `RIG_PAGE_TITLE`.
4. **Do not** commit unless the user asks.
5. After UI changes, run relevant unit tests (`uiSession`, conversation helpers, any sidebar utils tests).

---

## Open product decisions (resolve during impl if blocked)

1. **Note sort key:** `updatedAt` vs `createdAt` for grouping with chats?
2. **NotesView list screen:** remove entirely vs keep as fallback empty state?
3. **Search v1:** conversations-only vs mixed notes?
4. **Clippings note:** remains a normal note row (yes — keep special title, no special nav).

**Recommended defaults if unspecified:** `updatedAt` for notes; remove redundant notes list when sidebar shows notes; extend search to note titles at minimum.

---

## Success picture

User opens Harness and sees one library of their stuff. Tasks and System remain the only fixed destinations. Notes feel like peers of chats. Editor-as-mode is gone. Projects and images can plug in later without another IA rewrite.
