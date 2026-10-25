# Sleep memory

Active project on the [roadmap](../../ROADMAP.md). Serves O2/O3/O4. Promoted from Frozen "Semantic memory".

Memory should be a by-product of using Harness, not something the model has to remember to do. Once per day the desktop app "sleeps": it reads the day's dictations and chats and consolidates them into a small, dated, legible store. At chat time it "wakes" with only the parts that match the turn.

**Goal: Harness is the only assistant.** Memory is one of the things that keeps conversations in Claude today, so it is a switching requirement, not a nice-to-have. The store is built for Harness chat and dictation. Imported Claude history is a one-time backfill and a shrinking source, not something to keep serving; exporting memory to other assistants is a non-goal.

### What prod use showed (installed app, 2026-06 to 2026-10)

Usage:

- **Dictation is the product, chat happens elsewhere.** Since June: 1,778 dictations, 512 imported Claude conversations, and roughly 200 to 275 native Harness chats. Median 17 sessions per active day (max 118).
- **Harness is the mouth, Claude the brain.** At least 230 of 1,719 usable dictations (13%) show up near-verbatim as a Claude message, typically within a minute. The rest went to destinations Harness cannot see.
- **Claude conversations are short but reply-heavy.** Median 2 user turns; about 370 characters from the user against 2,000 from the model (top tenth near 10,000).
- **Claude carries the personal topics.** Health, money, and family appear there far more than in dictations.
- **Most dictations never reach a model.** 1,665 of 1,778 have no assistant reply. They are voice-to-text taken elsewhere (messages, briefs, prompts for coding agents).
- **Sessions are single-shot.** Median conversation is one message; 84 of 3,662 exceed 20 messages. Median dictation is about 240 characters.
- **Content is mostly work,** with app development and home topics behind. The same people and projects recur for weeks.

Memory today:

- **Nothing written since May.** `memory_set` ran 19 times in two conversations. The last distill was 2026-05-24 (nightly compile was culled in v0.8).
- **No selection.** All 127 keys (about 15k characters) are injected on every turn, sorted by key.
- **Noisy store.** 18 keys hold a "[removed by user request]" tombstone instead of being deleted; style rules are stored three and four times under different keys; dated one-off events never expire.
- **Poor coverage.** Several of the most-mentioned people in dictations (20 to 40 conversations each) have no entry.
- **Recall was tried and failed.** 22 of 23 recorded `memory_search_conversations` calls in July returned nothing, mostly long keyword-soup queries. The two August calls returned hits; the model has rarely searched since.
- **Recall is wanted.** About 75 user messages since June lean on prior context ("we talked", "last week", "what did I say about the brief").

Conclusions: Harness chat has to earn the conversations that go to Claude today, and remembered context is part of that; a tool the model must choose to call does not get called; the corpus worth learning from is the user's own dictated words, which the model never sees today; and what is missing is work context (who, what project, what is open), not more profile facts.

### Principles

1. **Passive.** No memory depends on the model deciding to save it.
2. **Derived and rebuildable.** Conversations stay the source of truth. Every memory entry cites the conversation ids it came from and can be regenerated.
3. **Legible.** Plain files, visible and editable in Settings. No embeddings or vector store in v1.
4. **Dated.** Every entry has `lastSeen`; things decay unless re-mentioned.
5. **Bounded.** The injected memory has a fixed budget (target under 1.5k tokens, down from roughly 3.7k).
6. **Desktop writes, iOS reads.** One writer keeps sync merges trivial.

### Store

Under `app-state/memory/`:

| File | Holds | Written by |
|------|-------|------------|
| `standing.md` | Standing instructions (voice, formatting, "do only what is asked"). Always injected. | User only |
| `user_memory.json` (existing) | Explicit profile facts: Settings edits and `memory_set`. | User, model |
| `days/YYYY-MM-DD.json` | Day digest: summary, topics, decisions, open threads, each with source conversation ids. | Sleep |
| `entities.json` | Cards for people, projects, topics: `id`, `kind`, `name`, `aliases`, `summary`, `firstSeen`, `lastSeen`, `mentionCount`, `sources`. | Sleep, user edits |
| `threads.json` | Open threads and decisions: `text`, `entityIds`, `openedOn`, `lastSeen`, `status` (open / done / expired). | Sleep, user edits |
| `sleep_state.json` | Last processed local day, per-run counts, token use, last error. Not synced. | Sleep |

### Sleep run (the collector)

**Trigger.** Desktop only. When the app is running and a local day has closed (launch, or idle after 03:00), process every closed day that is new or dirty, oldest first, at most 7 per run. `sleep_state.json` keeps a fingerprint of each day's inputs, so an import that adds backdated conversations marks those days dirty and they are digested again. Settings has **Run now** and shows the last run. No API key or offline: skip and retry next trigger. A lock in `sleep_state.json` prevents overlapping runs.

**Stages for day D:**

1. **Collect** (no model). Every conversation with activity on D: dictation transcripts and chat turns, cleaned with the existing `clean_dialogue_body`. Imported conversations count on the day they happened. Skip conversations flagged "exclude from memory", tool output, and assistant text in coding-scope conversations. A dictation whose text reappears as the opening of another conversation within a few minutes is linked to it and counted once. Each item keeps its id, time, and kind. Cap per conversation; if the day exceeds the input budget, digest in chunks and merge.
2. **Digest** (one model call, JSON). The user's words are read in full; model replies contribute only conclusions and decisions, so cards do not become summaries of model prose. Produce the day digest: a short summary, topics with a gist, people and projects mentioned with what was said, decisions, open threads, and any preference signals ("stop doing X"). Write `days/D.json`.
3. **Consolidate** (one model call, JSON operations). Input: the day digest plus the existing cards for names it mentions, matched by alias. Output is a list of operations: upsert a card, add an alias, open or close a thread, propose a standing-instruction change. Rust applies them deterministically, stamps `lastSeen` and sources, and rejects anything without a source id.
4. **Decay** (no model). Cards not seen for 60 days are archived (searchable, never injected). Open threads expire after 30 days without a mention. Windows live in the contract.
5. **Record.** Update `sleep_state.json`; a failed stage leaves the day unprocessed.

**Guardrails.**

- Sleep never edits `standing.md` or `user_memory.json`. Proposed changes queue for review in Settings.
- User edits win: a card or thread the user edited is marked pinned, and sleep may append sources but not rewrite it.
- Deleting an entry removes it and records its id in a small "forgotten" list so sleep does not recreate it.
- **Sensitive topics.** Health, finances, and family details are not carded by default; the digest tags them and consolidation drops them unless the user opts a topic in. (Most of the 18 tombstones in the current store are exactly these.)
- Prompts, budgets, schema version, and decay windows live in `resources/contracts/sleepMemory.json`.

### Wake (per turn)

- **Always:** `standing.md` plus capped profile facts.
- **Selected:** cards whose name or alias appears in the current message or conversation title (cap 6, most recent first), threads linked to those cards, and yesterday's and today's summaries. This takes over most of what `[RECENT_CONVERSATIONS]` does now.
- **Recall:** `memory_search_conversations` searches day digests and cards first, then raw conversations, and cites the source conversations.
- **Dictation:** reply-strip actions (Proofread, Distill, ...) get the same selected context, and card names become a spelling vocabulary for transcript cleanup.
- **Context preview** shows which entries were selected and why.

Selection is string matching on names and aliases in v1. Add embeddings only if matching demonstrably misses.

### Privacy and cost

Sleep sends dictations to a model that today never leave the machine. So: off until enabled in Settings, with a plain statement of what is sent; per-conversation "exclude from memory"; Ollama as a local option. A typical day is roughly 5k to 10k characters of input across two calls; the heaviest recorded day is well within one chunked run.

### Slices

0. **Hygiene.** Remove unused surface so the new store starts clean. Done: `memory_list` tool removed (2 calls ever, and redundant while everything is injected); duplicated user-memory storage functions collapsed. Remaining: prune the live store (tombstones, duplicates, expired events) and delete the orphaned `memory_compile_state.json`.
1. **Standing vs facts.** `standing.md` seeded from the current style keys; `user_memory.json` keeps facts only; memory block gets a budget. No model work.
2. **Day digest.** Collect and Digest stages, `days/`, `sleep_state.json`, Settings toggle with **Run now**.
3. **Consolidation.** `entities.json`, `threads.json`, operations and deterministic apply, decay, review queue.
4. **Wake selection.** Replace inject-everything with standing + selected cards and threads; context preview shows selection.
5. **Recall and backfill.** Search over digests and cards; explicit one-time backfill of native and imported Claude history, newest first.
6. **iOS and dictation.** iOS reads the synced store with a parity fixture for selection; cleanup vocabulary from card names.

### Open questions

- Which model runs sleep, and is it a separate setting from the chat model?
- Does `memory_set` stay as the explicit "remember this" path, or do explicit saves become notes to sleep?
- How far back does the backfill go? Claude history reaches 2024; decay will archive most of what is older than a few months anyway.
- Beyond memory, what else keeps conversations in Claude (long replies, projects, model quality)? Worth a separate look at the imported conversations.
- Should day digests be visible as library objects, or only in Settings?

### Success

- Injected memory stays under budget and contains no entry older than its decay window.
- The ten most-mentioned people and projects of the last 30 days each have a card.
- Recall questions get an answer with a source link, without the user naming the conversation.
- The user edits or deletes entries rarely.
- New Claude conversations per month trend to zero.
