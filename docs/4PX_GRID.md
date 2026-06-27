# 4px layout grid

Harness desktop UI spacing, typography, and fixed dimensions align to a **4px base grid**. The goal is consistent vertical rhythm and fewer “almost aligned” pixels across chat, sidebar, settings, notes, and tasks.

## Rules

| Rule | Detail |
|------|--------|
| **Base unit** | `GRID = 4` in `src/shared/grid.ts` |
| **Spacing & size** | Padding, margin, gap, width, height, border-radius (when fixed px), and icon sizes should be multiples of 4px |
| **Line height** | Use theme CSS variables (`--line-height-*`), not unitless ratios like `line-height: 1.5` |
| **Dynamic layout** | Measured heights (e.g. chat composer dock) call `snapToGrid()` before writing CSS variables |
| **Exceptions** | `1px` hairlines in **box-shadow** (`--hairline-*` tokens), `2px` focus rings, `999px` / `9999px` pill caps; shadow/blur values are not audited |
| **Edges** | UI hairlines use `--hairline-*` inset `box-shadow` tokens in `base.css`, not CSS `border`, so `--input-height` and other box sizes stay on-grid under `border-box` |

## Shared module (`src/shared/grid.ts`)

- `snapToGrid(px)` — round to nearest 4px
- `space(n)` — `"12px"` for `n * 4`
- `lineHeightForFont(fontSizePx, desiredPx?)` — grid-snapped line height, never below font size

## Theme integration (`src/shared/theme.ts`)

`typeScaleCssVars(fontSize)` emits grid-aligned tokens per user base size (12 / 14 / 16px):

- Font steps: `--font-size-caption`, `--font-size-body`, `--font-size-ui`, `--font-size-title`
- Icons: `--icon-size-xs` … `--icon-size-xl`, `--icon-size-compact`
- Line heights: `--line-height-caption`, `--line-height-body`, `--line-height-message`, `--line-height-prose`, etc.

`base.css` defines defaults; theme application overwrites them when the user changes font size in Theme studio.

## CSS pass (v0.6)

Renderer stylesheets were normalized to:

- Replace ad-hoc `px` spacing with grid multiples (e.g. 10px → 8px or 12px)
- Replace unitless `line-height` with `var(--line-height-*)`
- Keep semantic names (`--line-height-compact`, `--line-height-snug`, …) so components do not hardcode px line heights

## CI / local check

```bash
npm run grid:audit
```

`scripts/grid-audit.js` scans `src/renderer/*.css` for:

1. Hardcoded `Npx` values where `N % 4 !== 0` (with allowed exceptions above)
2. Unitless `line-height` numbers (prefer tokens)
3. Layout-affecting CSS borders (`border: 1px`, `border-color`, etc.) — use `--hairline-*` tokens instead

Vitest runs the same checks via `scripts/grid-audit.test.ts` (`npm test`).

## Visual regression (8px grid overlay)

Playwright captures full-window screenshots with the design grid overlay at **8px** so layout
drift shows up as pixel diffs against committed baselines:

```bash
npm run test:e2e:visual          # compare
npm run test:e2e:visual:update   # refresh baselines after intentional UI changes
```

See `e2e/visual-grid.spec.ts` and `e2e/MANUAL.md`. Baselines are OS-specific (`*-darwin.png`).

Add this to pre-commit or CI when convenient; today it is a manual / script hook.

## Layout overlay (unchanged)

The assistant `set_layout` tool still supports an optional **design grid overlay** (`gridOverlay`: off / 4 / 8 / 16) for visual alignment while editing. That overlay is separate from the 4px spacing system.

## Removed: layout density

The old `compact` / `comfortable` layout density setting was removed. Density is now expressed through theme font size and the shared type scale, not a second layout mode.

## Related UX (same release line)

- **Chat**: single-message threads center in the scroll area; composer dock height is grid-snapped
- **Sidebar**: default sort is “Recent”; alternate modes are date buckets and calendar day; peek rows 8–12 use progressive fade
