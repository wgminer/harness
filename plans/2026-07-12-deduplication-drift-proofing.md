# Harness: De-duplication and Drift-Proofing Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prefer small commits per task group unless the user asks otherwise.
>
> **Status:** ACTIVE — parented under v0.8 Consolidation as **workstream B**. See [ROADMAP.md](../ROADMAP.md) and [2026-07-14-consolidation.md](./2026-07-14-consolidation.md).
>
> **Prerequisite:** Finish **workstream A (Cull)** first. Removing plans objects, weather, and memory compile shrinks the contract surface before shared JSON / parity work. Strike weather/plans-related items from the inventories below once the cull lands (do not re-add `get_weather` to iOS tool expansion; drop `plans.json` sync-scope mirrors rather than “sharing” them).
>
> **Source:** Filed from Cursor chat draft on 2026-07-12; sequencing updated 2026-07-14.

**Goal:** (1) Inventory all duplication/drift across the three-language codebase, (2) consolidate to single sources of truth where practical, (3) add automated parity checks so a forgetful developer cannot silently reintroduce drift — enforcement by failing tests, not by memory or comments.

**Architecture:** Shared JSON/constants resources consumed by TS, Rust, and Swift where contracts can be physically shared; golden-fixture / source-scanning parity tests where they cannot. Extend the proven `grid-audit` dual CLI + vitest pattern (reuse the shape, not the grid rules) as the drift-guard model.

**Tech Stack:** TypeScript (vitest + npm scripts), Rust (`include_str!` / bundled resources), Swift (bundled resources), GitHub Actions CI (`static` / `rust` / `ios` jobs)

---

## Context

Harness is a three-language codebase (TypeScript renderer + shared, Rust Tauri backend, Swift iOS app) largely built by AI agents working one platform at a time. That workflow hand-copied shared contracts (tool definitions, prompts, model names, labels, sync scopes, storage paths) into each language, guarded only by "Keep in sync with ..." comments. Copies have already drifted (e.g. `task_update` tool description differs between desktop and iOS; the desktop prompt promises a weather-ZIP default the schema doesn't mention).

## Confirmed findings (from initial investigation)

### Cross-language contract duplication

1. **Tool definitions** — 2 executable copies + 3 prose copies:
   - `src-tauri/src/openai.rs:86` `tool_definitions()` (~300 lines JSON)
   - `ios/HarnessMobile/Chat/TaskToolExecutor.swift:18` + `ChatToolDefinitions.swift` (~125 lines)
   - Prose "Available tools:" lists in `src-tauri/src/system_prompt.rs:64`, `src/shared/systemPromptDefaults.ts:69`, `ios/HarnessMobile/Chat/SystemPromptSettings.swift:70`
   - Drifted: `task_update`, `task_clear_completed`, `tags` descriptions differ desktop vs iOS.
2. **System prompt defaults** — triplicated verbatim (TS / Rust / Swift, files above).
3. **OpenAI model names** — `src/shared/openaiModels.ts` vs `ios/.../OpenAIClient.swift:12-19` (comment-guarded) vs Rust env-var defaults in `src-tauri/src/openai.rs:12-26`.
4. **Sync scopes** — `src-tauri/src/sync_bundle.rs:42-55` vs `ios/.../Sync/SyncScopes.swift:20-27`.
5. **Gated tool names** — `src-tauri/src/chat.rs:446` `matches!` vs `TaskToolDefinitions.gatedToolNames`.
6. **Tool-call UI labels** — `src/renderer/chatHelpers.tsx:354` vs `ios/.../TaskToolExecutor.swift:214`.
7. **Title-generation prompt** — `src-tauri/src/openai.rs:389` vs `ios/.../OpenAIClient.swift:204` (byte-identical today).
8. **Dictation polish instruction / reply label** — `ios/.../OpenAIClient.swift:22-31` mirrors `src/shared/dictationPolish.ts`, `dictationReplyStrip.ts`.

### Within-language duplication

9. **iOS ChatService** — three copy-pasted ~40-line executeTool closures + identical post-stream persistence (`ChatService.swift` send/generateReply/polishLastUser).
10. **iOS double tool-call bookkeeping** — ChatService closure and `OpenAIClient.streamChatWithTools` both parse the same tool-result JSON into records.
11. **Rust streaming accumulator** — `merge_delta`/`partial_from_delta` (`openai.rs:564-641`, ~80 lines, O(n²) per chunk) vs the clean 34-line Swift `PartialAssistantMessage` equivalent.
12. **`encodeJSON` duplicated** in `AssistantTools.swift` and `TaskToolExecutor.swift`.

### Approved removals

- **All grid functionality** (user-confirmed, both halves):
  - Design-grid overlay feature: `gridOverlay` option in the `set_layout` tool (`openai.rs` tool def + `customization.rs` executor + renderer overlay CSS/UI + the "optional design grid overlay" prose in all three prompt defaults). `set_layout` itself stays, sidebar-position only.
  - 4px grid-audit tooling: `scripts/grid-audit.js`, `src/shared/gridAudit.test.ts`, `npm run grid:audit` script in package.json, the `grid:audit` CI step in `.github/workflows/ci.yml`, `docs/4PX_GRID.md`.
  - The grid-audit *dual CLI + vitest scanner pattern* is still the template for the new drift checks — we reuse the shape, not the grid rules.

### Functional gaps found along the way (in scope)

- Tool execution errors abort the whole chat turn on both platforms (should return `{"error": ...}` as tool result).
- No cap on the tool-call loop on either platform.
- iOS tool expansion approved: `get_datetime`, `memory_set_fact`/`memory_list_facts` (`user_memory.json` already syncs). ~~`get_weather`~~ — **struck by v0.8 cull** (weather removed on desktop too). `web_search` requires a Tavily key which is redacted from sync — needs iOS-side key entry; defer or gate on key presence. Note tools stay desktop-only (iOS is chat-only, no notes UI).

### Environment facts

- No existing mechanism bundles files from outside `ios/` into the iOS app; no codegen; no cross-language parity tests today. `src/shared/systemPromptDefaults.test.ts` only checks TS-internal consistency.
- Rust uses no `include_str!` yet (only an `include_bytes!` icon); runtime resources resolve via `resolve_bundled_resource()` in `src-tauri/src/paths.rs:62`.
- Sync covers `app-state/` (user_memory.json, tasks.json, notes, conversations, writing.md) + redacted `settings/settings.json`.

## Existing enforcement infrastructure

- **The model to extend**: `scripts/grid-audit.js` + `src/shared/gridAudit.test.ts` — a scanner that reads real repo files (`src/renderer/*.css`), exported as both a CLI (`npm run grid:audit`) and a vitest test; both run in CI. This is the repo's proven "read the sources, fail on drift" pattern.
- **CI**: `.github/workflows/ci.yml` — `static` job (lint, typecheck, vitest, grid:audit), `rust` job (`cargo test --lib`), `ios` job (xcodegen + xcodebuild test on simulator). New drift checks slot into the `static` job.
- **ipcNames**: `src/shared/ipcNames.ts` derives Rust command/event wire names from TS names by convention (parity by construction); `ipcNames.test.ts` is only a golden-value table. Nothing verifies the derived names against the actual ~70 handlers in `src-tauri/src/commands.rs` / `lib.rs` `generate_handler![...]` — a real drift gap.
- **No repo CLAUDE.md exists** (root or nested); docs live in README.md, BUILD.md, docs/ (incl. `4PX_GRID.md`, the contract grid-audit enforces), ios/README.md. No pre-commit hooks, no husky; eslint ignores `src/` entirely (typecheck covers TS).
- Known cross-language logic mirrors with independent test suites that can silently diverge: `src/shared/syncMerge.ts` ↔ `ios/.../Sync/SyncMerge.swift`; `settingsSecrets.ts` ↔ `SettingsSecretsTests.swift`; bundle format across `remote_store.rs` / `dataStorageLayout.ts` / `BundleCodec.swift`.

## Within-language duplication inventory

Ranked; consolidation safety noted.

### Tier 1 (do)

- [x] **Rust JSON persistence scaffolding**: `storage.rs` helpers exist (`read_json_object_file`, `atomic_write_utf8`, `storage.rs:103-130`) but `notes.rs:112-165`, `tasks.rs:229-270`, `sticky_notes.rs:57-64`, `ui_session.rs:90-98`, ~~`memory_compile.rs`~~ (**struck by v0.8 cull**), and 6+ write sites in `memory.rs` hand-roll the same read→parse→pretty-print→write cycle, each with its own fallback literal. Extract the IO envelope (e.g. `write_json_pretty`) only — leave interleaved per-module row migrations (tasks status migration, notes field validation) in place. After cull, also drop plans persistence sites rather than consolidating them.
- [ ] **iOS ChatService triplication** (bigger than first flagged): byte-identical `executeTool` closures ×3 (`ChatService.swift:120-147, 176-201, 237-262`) AND identical trailing append+title-refinement blocks ×3 (`:152-159, 206-213, 267-274`). Extract `makeToolExecutor(onToolCall:)` + `finishAssistantTurn(...)`.

### Tier 2 (quick safe wins)

- [x] `encodeJSON` duplicated verbatim: `AssistantTools.swift:37-45` vs `TaskToolExecutor.swift:200-208` → shared util.
- [x] `OpenAIClient.swift` URLRequest preamble repeated (`:153-156`, `:198-201`) → `makeChatRequest(timeout:)` factory.
- [x] `load_tray_image` duplicated: `global_recording.rs:84-87` vs `global_recording_effects.rs:42-45` → keep one.
- [x] Dead code: `getDocumentPanel` (`chatHelpers.tsx:65-68`, deprecated forwarder, zero importers) → delete.

### Defer (flagged, not in scope)

DocumentCard hand-rolled modal, three `toLocaleTimeString` formatters, idiomatic `.map_err(|e| e.to_string())` sites, note load/save-debounce overlap in `WindowedNoteView`/`WritingSurfaceView`.

### Do NOT touch

`open_long_response` legacy path (`chatHelpers.tsx:53` etc.) — reads stored legacy payloads; removal needs a data migration. IPC wiring, note editor cores, recording modules, SSE parsers checked clean — no duplication.

## Cross-language contract inventory

28 hand-mirrored contracts across TS/Rust/Swift; guarded only by comments. Grouped by kind:

### Already-drifted bugs (fix explicitly)

- [x] Recent-conversations empty-title label: Rust emits `"Empty chat @ {time}"` (`recent_conversations.rs:113`), Swift emits `"New chat @ {time}"` (via `ConversationTitlePolicy.swift:42`). Also Rust `%I:%M %p` (leading-zero hour) vs localized numeric hour on Swift/TS.
- [x] Sync-merge serialization: Swift `.prettyPrinted + .sortedKeys` vs TS `JSON.stringify(x, null, 2)` (insertion order); messages-dedup stamp differs too → merged bytes and revision hashes differ across platforms (`syncMerge.ts` / `sync_merge.rs` / `SyncMerge.swift`). **Fixed:** canonical 2-space pretty-print with sorted keys via `canonicalJson.ts` / `canonical_json.rs` / `CanonicalJson.swift`; golden fixtures in `src/shared/fixtures/syncMerge/`. Revision hashes change once — devices must re-pull.
- [x] Tool-label fallback: TS capitalizes first char, Swift `.capitalized`; iOS map missing 7 labels (`chatHelpers.tsx:354` vs `TaskToolExecutor.swift:214`). Also Swift `summarize` iterates a Dictionary (nondeterministic order) vs TS Map (insertion order); Swift has unused `compressThreshold`.
- [ ] Memory selection: on stopword-only messages Swift returns first 3 entries, TS+Rust return `[]` (TS defines `RELEVANT_FALLBACK_COUNT=3`, suggesting fallback-3 was the intent); char-budget counting is UTF-16 units (TS) vs graphemes (Swift) vs bytes (Rust) → divergent for non-ASCII.

### Value contracts (identical today, hand-copied — candidates for shared JSON resources)

- Tool definitions (23 desktop / 6 iOS) — the anchor case.
- System prompt defaults (triplicated); dictation-polish instruction (triplicated); default transcription prompt (triplicated); transcript-cleanup prompt + anti-injection markers + chatbot-reply heuristic constants (`recording.rs:201-255` ↔ `OpenAIClient.swift:317-371`); title-generation prompt + params (`openai.rs:383-440` ↔ `OpenAIClient.swift:197-245`).
- OpenAI model names (TS/Rust/Swift); task status enum + priority order (triplicated ~60-85 lines); sync scopes + bundle format constants (`sync_bundle.rs` ↔ `SyncScopes.swift`); settings secret paths (TS/Swift/Rust inline); storage paths (~6 files incl. id-sanitizer regex); memory `[USER_MEMORY_CONTEXT]`/`[MEMORY_RULES]` literals (triplicated); memory-selection constants (stopwords, thresholds, formula); recent-conversations budgets; header quote; dictation reply label; motion duration (`motion.ts` ↔ `TasksListView.swift`); title sources (`user/imported/auto` — typed enum in Rust only); message role strings (stringly-typed everywhere).

### Logic mirrors (can't share code — candidates for shared golden-fixture tests)

- Sync merge (~260/330/323 lines ×3), sync decision engine (×3), bundle revision/codec (Rust↔Swift, already fixture-tested on iOS side: `BundleCodecTests.swift:23`), title-refinement policy (×3), tag normalization (×3 ~65 lines), temporal context/sent-at annotation (×3), recent-conversations builder (Rust+Swift full, TS partial), memory scoring (×3), transcript dictionary replacement (Rust↔Swift).

### Cross-surface (flag only)

iOS `ThemeSupport.swift` hex tokens hand-copied from desktop `base.css`.

## Approach (to be finalized)

Three workstreams, roughly in order:

1. **Shared contracts**: single JSON/constants source of truth per contract, consumed by all three languages (mechanism TBD after infra exploration — leading candidate: checked-in JSON + `include_str!` on Rust + bundled resource on iOS + direct import in TS).
2. **Parity tests as the drift guard**: extend the repo's existing parity-test pattern (ipcNames.test.ts, if confirmed) to every contract that cannot be physically shared; tests read the actual source/resource files and fail on mismatch.
3. **Targeted refactors**: iOS ChatService dedup, Rust accumulator rewrite, error-tolerant tool loop + iteration cap, iOS tool expansion.
4. **Developer guardrails**: repo CLAUDE.md + docs describing the single-source rules; one npm script that runs all drift checks.

---

## Workstreams (checkbox tracking)

### W0 — Removals (grid)

- [x] Remove `gridOverlay` from `set_layout` tool def, executor, renderer overlay CSS/UI, and "optional design grid overlay" prose in all three prompt defaults. Keep `set_layout` (sidebar-position only).
- [x] Delete `scripts/grid-audit.js`, `src/shared/gridAudit.test.ts`, `npm run grid:audit`, CI `grid:audit` step, `docs/4PX_GRID.md`.
- [x] Preserve the dual CLI + vitest scanner *pattern* for the new drift checks.

### W1 — Shared contracts (single sources of truth)

- [x] Decide bundling mechanism (JSON + `include_str!` / iOS resource / TS import). **Decided:** checked-in JSON under `resources/contracts/` (repo-root, sibling to the existing Tauri-bundled `resources/`) as the single source per contract. Rust reads it via `include_str!` (compiled in — no runtime resource resolution needed since it's embedded at build time, unlike the existing `resolve_bundled_resource()` runtime assets). iOS gets it via an extra XcodeGen `sources` entry in `ios/project.yml` (`../resources/contracts`) so `xcodegen generate` adds it to the `HarnessMobile` target's Copy Bundle Resources phase; loaded at runtime via `Bundle.main` (works in both the app and hosted unit tests, since `HarnessMobileTests` sets `TEST_HOST`). TS contracts that need direct consumption can `import`/`fetch` the same file directly (no build step needed for TS); none do yet since only tool defs are wired this pass. Rejected: codegen into per-language copies (adds a build step + staleness risk that's exactly what this workstream removes) and duplicating the file per-language (defeats the point).
- [x] Extract tool definitions to shared resource (desktop full set; iOS subset). **Done for tool defs only** (`resources/contracts/tools.json`, 21 desktop tool schemas). Desktop `openai.rs::tool_definitions()` now `include_str!`s + parses it verbatim. iOS `ChatToolDefinitions`/`TaskToolDefinitions` (`ios/HarnessMobile/Chat/`) filter the same array by name via a new `SharedToolDefinitions` loader — iOS keeps its own `toolNames`/`gatedToolNames` sets (behavior, not contract JSON) but no longer hand-writes the OpenAI `function.parameters` schemas. This also fixed the noted `task_update`/`task_clear_completed`/tags description drift (one JSON, so both platforms now say the same thing — the richer iOS wording won). Remaining, deferred to a later W1 pass: system prompt defaults, dictation/title/transcript prompts, model names, sync scopes, gated tool names, tool-call UI labels, and other value contracts listed above are **not yet extracted**.
- [ ] Extract system prompt defaults, dictation/title/transcript prompts, model names, sync scopes, gated tool names, tool-call UI labels, and other value contracts listed above.
- [ ] Wire Rust, TS, and Swift consumers; delete hand-copied duplicates. (Tool defs wired; remaining contracts above still pending.)

### W2 — Parity / drift guards

- [ ] Add drift-check scanner(s) modeled on grid-audit (CLI + vitest, CI `static` job).
- [ ] Cover logic mirrors with shared golden fixtures where code cannot be shared (sync merge, title policy, memory scoring, tag normalization, etc.).
- [x] Close ipcNames gap: verify derived wire names against actual `generate_handler!` / commands.
- [ ] One npm script that runs all drift checks.

### W3 — Within-language dedup

- [x] Tier 1: Rust `write_json_pretty` (or equivalent) envelope; [ ] iOS ChatService `makeToolExecutor` + `finishAssistantTurn`.
- [x] Tier 2: shared `encodeJSON`, `makeChatRequest`, single `load_tray_image`, delete `getDocumentPanel`.
- [x] Rewrite Rust streaming accumulator to match Swift `PartialAssistantMessage` clarity (and fix O(n²)).

### W4 — Functional gaps

- [x] Tool execution errors return `{"error": ...}` as tool result (both platforms); do not abort the turn.
- [x] Cap the tool-call loop on both platforms.
- [x] iOS tool expansion: `get_datetime`, `memory_set_fact` / `memory_list_facts`; gate or defer `web_search` on Tavily key presence. (**Do not** add `get_weather` — removed in v0.8 cull.)
- [ ] Fix already-drifted bugs (memory selection).

### W5 — Developer guardrails

- [x] Add repo `CLAUDE.md` + docs describing single-source rules and "do not hand-copy contracts."
- [ ] Update README / ios README as needed for the new resource layout and drift-check scripts.

## Verification

_To be completed._

## Out of scope / deferred

- DocumentCard hand-rolled modal; `toLocaleTimeString` formatter consolidation; `.map_err(|e| e.to_string())` churn; note load/save-debounce overlap.
- `open_long_response` legacy path (needs data migration).
- Theme token sharing (`ThemeSupport.swift` ↔ `base.css`) — flag only.
- Full `web_search` on iOS without a key-entry story.
- Note tools on iOS (chat-only surface).
