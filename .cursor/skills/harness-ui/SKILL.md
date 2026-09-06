---
name: harness-ui
description: Inspects and edits Harness desktop UI using design tokens, Storybook galleries, and screenshot capture tools. Use when working on desktop CSS, React renderer components, spacing, typography, colors, Storybook stories, visual polish, or UI layout reviews.
---

# Harness desktop UI

## Tokens and vocabulary

- Design tokens: [`src/renderer/base.css`](src/renderer/base.css) — colors, spacing (`--space-*`), typography, radius (`--radius-*`). Do not invent new hex values or hardcoded px when a token exists.
- Product terms: [`docs/glossary.md`](docs/glossary.md) — **surface**, **chat UI** vs **dictation screen**, chat modes (Chat / Decide / Write / Refine).
- Storybook galleries: [`src/renderer/ui/*.stories.tsx`](src/renderer/ui/Foundations.stories.tsx) — real CSS, not mocks.

## Before claiming a UI change looks correct

1. Read the relevant source (CSS + TSX + stories).
2. Capture pixels and **Read** the PNGs (the Read tool ingests images).
3. After edits, recapture and Read again.

## Capture commands

| Task | Command | Output |
|------|---------|--------|
| Components (buttons, forms, chat chrome, etc.) | `npm run capture:storybook` | `tmp/ui-shots/storybook/{story-id}.png` |
| Current app window | `npm run capture:window` | `tmp/ui-shots/window.png` |
| Full surfaces (compose, thread, search, tasks, settings) | `npm run capture:surfaces -- --launch` | `tmp/ui-shots/surfaces/*.png` |

First Storybook capture on a machine: `npx playwright install chromium`.

If `capture:surfaces` navigation fails (Accessibility permission), capture whatever is on screen, ask the user to switch views manually, then re-run `npm run capture:window`.

## iOS

SwiftUI is platform-native — do not port desktop `--radius-*` tokens. Preview fixtures live in [`ios/HarnessMobile/UI/PreviewSupport.swift`](ios/HarnessMobile/UI/PreviewSupport.swift). No automated iOS screenshot script yet; future path is Simulator `xcrun simctl io booted screenshot` against `#Preview` blocks.

## Checklist

- [ ] Used existing tokens from `base.css`
- [ ] Captured and Read relevant PNGs
- [ ] Recaptured after edits
- [ ] Did not conflate chat UI with dictation screen
