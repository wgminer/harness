# OpenAI Image Generation Tool — Design Spec

**Status:** Approved for implementation planning  
**Date:** 2026-07-21  
**Platform:** Harness desktop (Tauri)  
**Outcomes:** O2 (subscription consolidation), O4 (learning lab)

---

## Summary

Add a `generate_image` assistant tool that lets the chat model create images via the OpenAI Images API. Images are saved locally, shown inline in the conversation (not markdown-only), and gated by default because API calls cost money.

---

## Goals

- Chat model can call `generate_image({ prompt, size? })` during a conversation
- Reuse the existing OpenAI API key from OS credential store
- Show the generated image inline in chat via a dedicated `ImageCard` component
- Require user confirmation (Proceed/Cancel) before calling the API, with prompt preview
- Return small JSON metadata to the model (never base64 in tool results or conversation history)
- Rust unit tests for response parsing and file save logic

## Non-goals (v1)

- Vision / multimodal follow-up (“make it bluer” on the next turn)
- Syncing generated images via R2 backup bundle
- Separate Images panel or composer mode
- User-facing model picker (fixed constant like chat models)
- iOS support
- Local / non-OpenAI image backends

---

## Architecture

```
User message
  → Chat LLM (gpt-5.4) decides to call generate_image
  → chat.rs execute_tool (gated path)
       → emit pending tool panel (prompt + size preview)
       → user Proceed / Cancel
  → image_generation.rs
       → resolve OpenAI API key (credentials.rs)
       → POST /v1/images/generations
       → decode base64 → write PNG to userData/generated-images/<uuid>.png
       → return { ok, id, path, size, revisedPrompt, synced: false }
  → tool panel update + persist toolCalls on assistant message
  → renderer: ImageCard reads generate_image payload, convertFileSrc(path)
  → LLM streams prose around the image
```

### Stack notes

Harness is Tauri + Rust backend (`src-tauri/`), React renderer (`src/renderer/`). This spec replaces an earlier Electron-oriented plan (`harness://` custom protocol, TypeScript main process module).

---

## Backend (Rust)

### New module: `src-tauri/src/image_generation.rs`

Responsibilities:

- `openai_image_model()` — env override with default `gpt-image-1` (or current OpenAI default)
- `generate_image(api_key, prompt, size) -> Result<GenerateImageResult, ImageGenerationError>`
- HTTP via existing `reqwest` pattern (same style as `openai.rs` chat completions)
- Decode `b64_json` from API response; write bytes to disk
- Return structured result; never embed image bytes in JSON returned to the model

### Storage path

```
{user_data_dir}/generated-images/{uuid}.png
```

Add helper in `paths.rs`:

```rust
pub fn get_generated_images_dir() -> PathBuf
```

Create directory on first write. Filenames are opaque UUIDs; prompt lives in tool payload / conversation metadata only.

### Tool registration

1. **`openai.rs` — `tool_definitions()`**  
   Add `generate_image` function schema:
   - `prompt` (required, string)
   - `size` (optional enum: `1024x1024`, `1536x1024`, `1024x1536`; default `1024x1024`)

2. **`assistant_tools.rs`**
   - Add `"generate_image"` to `is_assistant_tool_name`
   - Dispatch in `execute_assistant_tool` → `image_generation::generate_and_save(...)`

3. **`system_prompt.rs`**  
   Append `generate_image` to the available-tools list with brief usage guidance (“creates an image from a text prompt; gated — user must confirm”).

### Gating (default on)

Add `generate_image` to the gated tool set in `chat.rs` (alongside `task_delete`, `task_update`, `task_clear_completed`):

- Pending payload includes `prompt` and `size` for UI preview
- Cancel returns `{ "error": "Image generation cancelled." }` to the model
- Proceed runs `execute_assistant_tool`

**Future (not v1):** Config toggle `imageGeneration.skipGate` to allow immediate generation.

### Tool result shape

```json
{
  "ok": true,
  "id": "img_abc123",
  "path": "/Users/.../generated-images/img_abc123.png",
  "size": "1024x1024",
  "revisedPrompt": "A cozy cabin in the snow...",
  "synced": false
}
```

Error shape (consistent with `web_search`):

```json
{
  "error": "OpenAI API key is not set. Add it in Config → Credentials."
}
```

### Credentials

Reuse `resolve_openai_api_key()` — no new Settings credential field in v1.

---

## Frontend (React)

### ImageCard (new component)

Follow the `DocumentCard` / `InlineWriteupCard` pattern used for attached notes:

| File | Change |
|------|--------|
| `src/renderer/ImageCard.tsx` | New — thumbnail, prompt caption, loading/error states |
| `src/renderer/chatHelpers.tsx` | `getInlineImage(toolCalls)`, `parseGenerateImagePayload`, `toolLabel` entry |
| `src/renderer/ChatMessageList.tsx` | Render `ImageCard` when `getInlineImage` returns payload |
| `src/renderer/chat.css` | Grid-aligned styles for image card |

**Display rules:**

- Resolve local path with `@tauri-apps/api/core` `convertFileSrc(path)` — do not use raw `file://`
- Show spinner while tool payload has `{ pending: true }` or `{ loading: true }` (if needed)
- On success: `<img src={convertFileSrc(path)} alt={revisedPrompt || prompt} />`
- Actions: **Reveal in Finder** (`@tauri-apps/plugin-opener` or existing shell-open pattern), **Copy path**

**Do not rely on markdown images alone.** The model may describe the image in prose, but the primary visual is `ImageCard`.

### ToolCallsCard

- Add label: `generate_image` → `"Generated image"`
- Optionally use a distinct icon (image glyph) instead of the generic checkmark for this tool only
- Filter attached image tool calls from compressed summary the same way attached `note_create` is deduplicated (if we mark payload with `attachedToMessage: true`)

### Tool panel during generation

While the API call is in flight (after Proceed, before result):

- Tool row shows loading state (“Generating image…”)
- Consider emitting an intermediate tool panel update or using pending state on the gated flow

---

## Data & sync

- Generated PNGs are **local-only in v1**
- Tool result includes `"synced": false` so the model can mention images won't appear on other devices
- Conversation JSON stores tool metadata (path, id, prompt) — small, no binary
- **Risk:** Restoring conversation on another machine shows a broken image card (path not found). Accept for v1; v2 adds R2 image prefix or bundle inclusion.

---

## Error handling

| Condition | Behavior |
|-----------|----------|
| Missing API key | Structured error pointing to Config |
| API 401/429/5xx | Surface API message; no partial file left on disk |
| Invalid prompt (empty) | Return error before HTTP call |
| Disk write failure | Return error; do not report success to model |
| User Cancel on gate | `{ error: "Image generation cancelled." }` |

---

## Testing

### Rust (`src-tauri/src/image_generation.rs`)

- Parse fixture JSON from OpenAI Images API response → correct file bytes written
- Empty prompt rejected
- Error response mapped to `{ error: "..." }` JSON

### Renderer (`src/renderer/`)

- `parseGenerateImagePayload` unit test
- `getInlineImage` selects latest attached `generate_image` tool call
- Optional: snapshot test for `ImageCard` error/loading/success states (Vitest + jsdom)

### Manual QA checklist

- Gate shows prompt; Cancel stops API call
- Proceed generates image; ImageCard displays thumbnail
- Reveal in Finder works
- Missing API key shows helpful error in tool card and model reply
- Conversation reload shows image from saved path

---

## Implementation phases

### Phase 1 — MVP (this spec)

Backend tool + gating + ImageCard + Rust tests + system prompt update.

### Phase 2 — Polish

- Config: default size, optional skip-gate toggle
- Distinct tool icon; better loading UX
- Save to Desktop action

### Phase 3 — Later

- Vision input for edit/regenerate flows
- R2 sync for generated images
- Image history / gallery view

---

## Files to touch (MVP)

| Path | Action |
|------|--------|
| `src-tauri/src/image_generation.rs` | **New** |
| `src-tauri/src/lib.rs` | `mod image_generation;` |
| `src-tauri/src/paths.rs` | `get_generated_images_dir()` |
| `src-tauri/src/openai.rs` | Tool schema + optional shared HTTP client pattern |
| `src-tauri/src/assistant_tools.rs` | Register + dispatch |
| `src-tauri/src/chat.rs` | Add to gated set |
| `src-tauri/src/system_prompt.rs` | Tool list text |
| `src/renderer/ImageCard.tsx` | **New** |
| `src/renderer/chatHelpers.tsx` | Parsers + labels |
| `src/renderer/ChatMessageList.tsx` | Render ImageCard |
| `src/renderer/chat.css` | Styles |
| `src/renderer/chatHelpers.test.ts` or new test file | Payload parser tests |

---

## Decisions log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Provider | OpenAI Images API | Reuses existing key; user confirmed |
| Gate before API | Yes (default) | Cost control |
| Display | ImageCard inline | ToolCallsCard labels alone are insufficient |
| Local URL | Tauri `convertFileSrc` | Native Tauri pattern; no custom protocol |
| Sync | Local-only v1 | Avoids bundle format change |
| Vision follow-up | Deferred | Text-only chat today |

---

## References

- `DocumentCard` / `getInlineWriteup` — inline rich tool result pattern
- `chat.rs` gated tools — Proceed/Cancel flow
- `web_search` in `assistant_tools.rs` — external API + credential error pattern
- ROADMAP O2, O4 — image gen serves subscription consolidation and learning lab goals
