# Theme Simplification Design

**Date:** 2026-07-01  
**Status:** Approved for implementation  
**Scope:** Desktop Electron app (+ aligned iOS theme.json handling)

## Problem

Harness exposes three layers of appearance customization:

1. **Color mode** — dark / light via `data-theme`, `theme-light.css`, and Settings → Appearance toggle
2. **Typography scale** — base font size 12 / 14 / 16px with a runtime `typeScaleCssVars()` lookup that rewrites ~20 CSS custom properties
3. **Font families** — UI font and code/notes font pickers

Renderer CSS already uses semantic tokens (`--font-size-body`, `--line-height-prose`, `--icon-size-md`, etc.). The customization layer exists mainly to **override** those tokens at runtime and persist choices in `theme.json`.

For a product direction of **fixed dark theme**, layers (1) and (2) add complexity without proportional value:

- `typeScaleCssVars()` is ~110 lines of duplicated 12/14/16 tables
- Settings UI includes a bespoke font-size stepper (~120 lines TSX + ~100 lines CSS)
- Light mode requires a parallel palette file and migration logic for legacy presets
- Sync, agent tools, and iOS must all understand `fontSize` and `mode`

Font **family** pickers remain useful and are independent of color mode / size scale.

## Goals

- Single dark palette baked into `base.css` (`:root`)
- Fixed 14px type scale baked into `base.css` (current default)
- Keep semantic CSS variables — **do not** replace `var(--font-size-body)` with hardcoded `14px` across renderer CSS
- Keep UI / editor font family customization and persistence
- Gracefully ignore or strip removed fields from existing `theme.json` and sync merges

## Non-goals

- Removing font family pickers or Google Fonts loading
- Changing the 4px spacing grid (`--space-*`, `snapToGrid()` for composer docks)
- Removing the optional design grid overlay (layout setting, unrelated to typography)
- Rewriting chat slide decorative sizes (`28px`, `56px`) or notes heading `em` multipliers

## Architecture (after)

```
theme.json          base.css (:root)
──────────          ──────────────────
font                --font-size-*
fontMono            --line-height-*
updatedAt           --icon-size-*
                    dark color tokens
        │
        ▼
normalizeThemeSettings()  →  coerce fonts, drop mode/fontSize
        │
        ▼
applyThemeToRoot()  →  set only --font-family, --font-family-mono on <html>
        │
        ▼
Renderer CSS        →  unchanged token references
```

**Removed runtime behavior:**

- `html[data-theme="light"]` — no attribute toggling; dark is always active
- Inline overrides for font size, line heights, and icon sizes

## Data model

### Before

```ts
type ThemeSettings = {
  mode: "dark" | "light";
  font: UiFontId;
  fontMono: MonoFontId;
  fontSize: 12 | 14 | 16;
};
```

### After

```ts
type ThemeSettings = {
  font: UiFontId;
  fontMono: MonoFontId;
};
```

`normalizeThemeSettings()` continues to accept legacy JSON:

| Legacy field | Behavior |
|---|---|
| `mode`, `bg`, preset aliases | Ignored; app is always dark |
| `fontSize` | Ignored |
| `font`, `fontMono`, legacy font keys | Unchanged migration path |
| `accent`, `fg`, `bg` | Still triggers rewrite migration (strip colors) |

Persisted `theme.json` drops `mode` and `fontSize` on next save.

## Code removals

| Area | Remove |
|---|---|
| `src/shared/theme.ts` | `FONT_SIZE_OPTIONS`, `FontSizePx`, `typeScaleCssVars`, `stepFontSize`, `coerceFontSizePx`, `ThemeMode`, `THEME_PRESETS`, preset aliases, mode parsing, typography size from `typographyCssVars` |
| `src/renderer/theme-light.css` | Entire file |
| `src/renderer/main.tsx` | `theme-light.css` import |
| `src/renderer/SettingsView.tsx` | Color theme toggle group; base font size stepper |
| `src/renderer/settings.css` | `.settings-theme-toggle*`, `.settings-font-size-stepper*` |
| `src/main/customization.ts` | `apply_theme_preset` tool; `mode` / `fontSize` patch fields |
| `src/main/providers/toolDefinitions.ts` | `apply_theme_preset`, `mode`, `fontSize` params |
| `src/renderer/chatHelpers.tsx` | `apply_theme_preset` label |
| `docs/4PX_GRID.md` | Stale `lineHeightForFont` reference; update type-scale section |

## Code to keep (simplified)

| Area | Keep |
|---|---|
| `base.css` | All typography + color tokens at 14px default scale |
| `applyThemeToRoot()` | Sets `--font-family`, `--font-family-mono` only |
| `ThemeSettings` persistence | `font`, `fontMono`, `updatedAt` |
| Agent `get_theme` / `update_theme` | FontWeight fields only |
| CSS token usage in renderer | No changes required |

## Settings UI (after)

**Appearance tab** retains:

- Typography group: UI font + Code/notes font selects
- Grid overlay select (layout, not theme)
- Notes/writing template controls (if present below typography)

**Removed:**

- “Color theme” group (Dark/Light toggle)
- “Base font size” stepper

Update `settingsNavConfig.ts` subtitle/keywords to drop “color theme” emphasis.

## iOS alignment

`ios/HarnessMobile/Data/ThemeSupport.swift`:

- Remove `fontSize` from struct (or ignore on read)
- Stop persisting `mode` if present
- Update `ThemeResolverTests.swift`

iOS does not need runtime CSS var injection equivalent; it reads theme.json for sync parity.

## Testing strategy

- Update `src/shared/theme.test.ts`: remove font-size stepping, light mode, preset tests; assert legacy `fontSize`/`mode` ignored
- Update `src/main/customization.test.ts`: remove light/fontSize assertions; remove preset tool tests
- Update `src/shared/syncMerge.test.ts`: fixture without `fontSize`
- Run `npm test` (includes grid audit)
- Manual: Settings → Appearance shows fonts only; app stays dark after loading old `theme.json` with `mode: "light", fontSize: 16`

## Risks

| Risk | Mitigation |
|---|---|
| Users on light mode lose preference | Acceptable per product decision; no migration to light |
| Users on 12px/16px lose preference | Acceptable; default 14px matches prior default |
| Agent prompts referencing `fontSize` / `apply_theme_preset` | Update tool descriptions; unknown fields ignored by normalize |
| Backup sync merges old theme.json | `normalizeThemeSettings` strips on read; rewrite on save |

## Success criteria

- No `fontSize` or `mode` in persisted theme after save
- No `theme-light.css` import
- Renderer appearance unchanged at default (14px dark)
- Test suite green
