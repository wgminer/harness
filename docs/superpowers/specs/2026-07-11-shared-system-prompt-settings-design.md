# Shared System Prompt via Settings — Design

## Goal

One shared source of truth for the chat system prompt across desktop and iOS. Platform differences are limited to a small desktop/iOS overlay (tools + identity). Personality, formatting, and shared rules stay identical. Desktop Settings can preview both platform assemblies; editing comes later (desktop-only).

## Settings shape

Stored in synced `settings/settings.json`:

```json
{
  "systemPrompt": {
    "shared": "…",
    "desktop": "…",
    "ios": "…"
  }
}
```

| Field | Role |
|-------|------|
| `shared` | Concise / high-signal, structure-first, formatting capabilities, other personality rules that must match |
| `desktop` | Desktop identity + desktop tool list + desktop-only extras (e.g. long-reply → note) |
| `ios` | iOS identity + iOS tool list only |

Defaults are baked into settings defaults (TS `DEFAULT_SETTINGS`, Rust `default_settings()`, and iOS fallback). Missing keys merge from defaults like other settings.

## Assembly

Same recipe on both platforms:

```
static = shared + "\n\n" + platform(desktop|ios)
system = static
       + optional [USER_MEMORY_CONTEXT] / [MEMORY_RULES]
       + [TEMPORAL_CONTEXT]
```

- Desktop send → `platform = desktop`
- iOS send → `platform = ios`
- Memory injection strategies and temporal / `sent_at` behavior unchanged
- Hardcoded CORE / formatting strings in `chat.rs` and `ChatService.swift` are replaced by reading settings (+ defaults)

TS does **not** assemble the live prompt. It may hold default strings for settings types/UI and display helpers (`stripSentAtPrefix`) only — not a third algorithm for memory/temporal block text if those strings also move into shared defaults.

## Settings UI (desktop)

New **System prompt** section:

- Toggle: **Desktop** | **iOS**
- Read-only preview of the assembled static prompt for the selected platform (`shared` + that platform section)
- Preview should also show how memory + temporal append at send time (using current strategy / facts), so the viewer matches what the model sees for the static+dynamic whole — without a copy button
- No editor in this pass

iOS: no system-prompt viewer required for v1; it consumes synced settings.

## Future edit (out of scope now)

- Desktop-only editing of `systemPrompt.shared` / `.desktop` / `.ios`
- Same JSON fields; no assembly redesign
- iOS continues to read synced settings only

## Out of scope

- Editing UI
- Copy button on the preview
- Per-conversation prompt overrides
- Expanding iOS tool *implementations* to match desktop (prompt text only lists tools the app actually has)
- Changing transcription cleanup prompt (already a separate settings field)

## Testing

- Defaults present and merge correctly when `systemPrompt` is absent
- Desktop assemble with `desktop` overlay; iOS path / Settings toggle assemble with `ios` overlay; `shared` identical in both
- Memory / temporal still appended; `none` strategy omits memory block
- Settings toggle switches preview between desktop and iOS assemblies
