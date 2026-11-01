# Coding agent v2

Active project on the [roadmap](../../ROADMAP.md). Serves O2/O4, and O3 through slice 5. Promoted from Frozen "Agent mode with human-in-the-loop". Audit and design: [coding-agent-audit.html](../research/coding-agent-audit.html).

Make Harness good enough to replace Claude Code for daily coding. Keep the agent Pi-minimal (read / edit / write / bash, short prompt, loop runs until the model stops calling tools) so most gains come from better models.

## Slices, in order

0. Send tool calls from earlier turns back to the model and replace the silent 10-round cap.
1. A turn timeline with live tool status and output.
2. Steering mid-turn (Enter steers, ⌥Enter queues).
3. Web search v2 + `web_fetch`.
4. Undo via a shadow-git snapshot per turn.
5. iOS shows coding turns the same way (shared `toolDisplay.json`, synced display items) and can queue "run on desktop" jobs, with no coding agent on the phone.
6. Composer attachments: `@` file mentions, images, folder drops.
7. Four tools + AGENTS.md + a permissions contract with "always allow" + workspace folders (read-only or read-write, outside reads ask).
8. Loop guard.
9. Compaction.

## Concurrent turns (prerequisite for long coding turns)

Today one turn runs app-wide: `ChatController` holds a single cancel token / active stream / note stream, `chat:stop` takes no conversation id, and turn state lives in `ChatView` (the sidebar only knows about the open conversation).

- **(a)** Key backend turn state by conversation id, with `chat:stop(conversationId)` and `chat:getActiveTurns`.
- **(b)** A renderer turn registry hook above `ChatView` fed by the stream events (already tagged with `conversationId`), so switching away never cancels and switching back rehydrates.
- **(c)** Sidebar row state from that registry: pulsing dot while running, a distinct "needs you" state when parked on a gated-tool approval, and an unread mark when a background turn finishes.
- **(d)** Attention outside the sidebar (tray / dock badge) for approvals in conversations that are not open.
