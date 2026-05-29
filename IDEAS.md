# Ideas

Scratchpad for future product directions. Not commitments.

## Conversation pathways

**Problem:** Need a way to organize conversations and create or refresh *pathways* between them (links, threads, or graph-like relationships—exact shape TBD).

**Near term:** A manual control—e.g. a button in **Settings**—to trigger pathway creation or maintenance on demand, so users can run it when they care without background behavior.

**Later:** Could evolve into scheduled work (e.g. a **cron job** or periodic task) once the behavior is understood and safe to automate.

## Legibility: context assembly + dictation pipeline

**Principle:** Legibility as a design value — the seam isn't a flaw to hide, it's the thing. Mechanisms should be part of what you experience, not behind it; tools should teach you how they work just by using them.

**Problem:** Two of the biggest invisible layers in Harness today:

1. **Per-reply context assembly** — Each chat turn builds a system prompt (memory injection strategy, selected facts, temporal context, `[sent_at=…]` annotations) in `buildMessageList`, but users only configure strategy in Config → Context and never see what landed for a specific reply.
2. **Dictation pipeline** — Voice capture runs Parakeet → optional LLM cleanup → dictionary → sent text, but only the final string is kept; raw WAV is saved unlinked and intermediate stages are discarded.

**Proposed:**

- **Context inspector** on assistant messages — collapsed card (like tool calls) showing injection strategy, injected facts, temporal summary, and expandable full system prompt; snapshot persisted on the message at send time.
- **Dictation inspector** on user messages — tabs for Audio (inline playback when WAV exists locally), Raw (Parakeet), Cleaned (LLM cleanup), Sent (final text); `DictationMeta` persisted on the message; text stages sync, audio stays local-only.

**Out of scope for this idea (deferred):** richer tool cards, sync merge narrative, provenance links, per-thread usage attribution.

**Outcome fit:** O1 (UI craft), O2 (trust-first / local-first transparency).
