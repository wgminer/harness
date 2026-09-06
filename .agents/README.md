# Local agent coordination

Tool-agnostic, **machine-local** coordination for parallel coding agents (any IDE / CLI). Not synced to Git.

## Board

Live file: **`board.md`** (gitignored). Template: [`board.example.md`](board.example.md).

If `board.md` is missing:

```bash
cp .agents/board.example.md .agents/board.md
```

### Tag in

Before editing shared areas (especially Settings, chat renderer, contracts, IPC):

1. Read `board.md`.
2. If another active row overlaps your paths, coordinate or pick a non-overlapping slice.
3. Add or update **your** row (agent id, focus, paths, UTC time).

### Tag out

When finished, idle, or handing off: remove your row (or mark `done` briefly then delete). Don’t leave stale claims.

### Stale rows

If `since` is older than ~4 hours with no update, treat as abandoned and overwrite after a quick check of the working tree.

## Limits

- **Local agents only** share this file.
- **Cloud / remote agents** won’t see it — also check `gh pr list` and `origin/cursor/*` branches.
- Soft protocol: helpful when followed, not enforced.
