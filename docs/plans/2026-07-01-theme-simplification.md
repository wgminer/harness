# Theme Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove light mode and user font-size scaling; keep fixed dark theme with 14px CSS tokens and font-family pickers only.

**Architecture:** Typography and colors live entirely in `base.css`. `theme.json` stores only `font` + `fontMono`. `applyThemeToRoot()` sets font-family CSS vars on `<html>` at startup and on settings change.

**Tech Stack:** TypeScript, Electron IPC, Vitest, Swift (iOS theme parity)

**Design doc:** `docs/plans/2026-07-01-theme-simplification-design.md`

---

### Task 1: Slim `ThemeSettings` and remove font-size / mode APIs

**Files:**
- Modify: `src/shared/theme.ts`
- Test: `src/shared/theme.test.ts`

**Step 1: Write failing tests for new shape**

Replace font-size stepping and light-mode tests with:

```ts
it("ignores legacy mode and fontSize on normalize", () => {
  const t = normalizeThemeSettings({ mode: "light", fontSize: 16, font: "inter" });
  expect(t).toEqual({ font: "inter", fontMono: DEFAULT_THEME_SETTINGS.fontMono });
  expect(t).not.toHaveProperty("mode");
  expect(t).not.toHaveProperty("fontSize");
});

it("typographyCssVars emits font stacks only", () => {
  const vars = typographyCssVars(DEFAULT_THEME_SETTINGS);
  expect(vars["--font-family"]).toContain("system-ui");
  expect(vars["--font-size-body"]).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/shared/theme.test.ts`  
Expected: FAIL — exports and shape mismatch

**Step 3: Implement minimal theme.ts changes**

- Remove: `FONT_SIZE_OPTIONS`, `FontSizePx`, `typeScaleCssVars`, `stepFontSize`, `coerceFontSizePx`, `ThemeMode`, `THEME_PRESETS`, `THEME_PRESET_ALIASES`, `resolveThemePresetId`, `findThemePreset`, mode parsing helpers
- Change `ThemeSettings` to `{ font, fontMono }` only
- `typographyCssVars()` returns only `--font-family` and `--font-family-mono`
- `applyThemeToRoot()` — remove `root.dataset.theme = …`
- `normalizeThemeSettings()` — drop mode/fontSize from return; ignore on input
- Remove `THEME_PRESET_IDS_FOR_SCHEMA`, `THEME_MODE_IDS_FOR_SCHEMA`, `FONT_SIZE` exports from tool schema helpers

**Step 4: Run test to verify it passes**

Run: `npm test -- src/shared/theme.test.ts`  
Expected: PASS

**Step 1:** `src/shared/theme.ts` and `src/shared/theme.test.ts` — `ThemeSettings` is `{ font, fontMono }` only; legacy `mode`/`fontSize` ignored; `typographyCssVars` emits font stacks only.

**Step 5: Commit**

```bash
git add src/shared/theme.ts src/shared/theme.test.ts
git commit -m "refactor(theme): drop mode and fontSize from ThemeSettings"
```

---

### Task 2: Remove light theme CSS and runtime data-theme

**Files:**
- Delete: `src/renderer/theme-light.css`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/base.css` (header comment only)
- Modify: `src/renderer/settings.css` (remove `.settings-theme-toggle*` block ~line 838+)

**Step 1: Delete theme-light.css and remove import**

In `main.tsx`, remove `import "./theme-light.css";`

**Step 2: Update base.css comment**

Remove references to `theme-light.css` and `data-theme` toggle.

**Step 3: Remove settings theme toggle CSS**

Delete `.settings-theme-toggle` rules from `settings.css`.

**Step 4: Run tests**

Run: `npm test`  
Expected: PASS (no test depends on light CSS file)

**PASS2:** `src/renderer/theme-light.css` deleted; `main.tsx` no longer imports it; `base.css` / `settings.css` comments and theme-toggle styles removed.

**Step 5: Commit**

```bash
git add src/renderer/main.tsx src/renderer/base.css src/renderer/settings.css
git rm src/renderer/theme-light.css
git commit -m "refactor(theme): remove light mode stylesheet"
```

---

### Task 3: Simplify customization IPC and agent tools

**Files:**
- Modify: `src/main/customization.ts`
- Modify: `src/main/customization.test.ts`
- Modify: `src/main/providers/toolDefinitions.ts`
- Modify: `src/renderer/chatHelpers.tsx`
- Modify: `src/shared/electronAPI.ts` (only if types re-export mode)

**Step 1: Write failing customization test**

Update `customization.test.ts`:

```ts
it("update_theme patches fonts only", async () => {
  await makeUserDataDir();
  const raw = executeCustomizationTool("update_theme", { font: "inter", fontMono: "fira_code" });
  const payload = JSON.parse(raw) as { ok: boolean; settings: { font: string; fontMono: string } };
  expect(payload.settings.font).toBe("inter");
  expect(payload.settings.fontMono).toBe("fira_code");
  expect(payload.settings).not.toHaveProperty("fontSize");
});
```

Remove `apply_theme_preset` tests.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/main/customization.test.ts`  
Expected: FAIL

**Step 3: Implement**

- Remove `apply_theme_preset` from `CUSTOMIZATION_TOOL_NAMES` and `executeCustomizationTool`
- Remove `mode` / `fontSize` from `applyThemePatch`
- Remove `findThemePreset`, `THEME_PRESETS` imports
- In `toolDefinitions.ts`: delete `apply_theme_preset` tool; remove `mode` and `fontSize` from `update_theme`; update descriptions
- Remove `apply_theme_preset` string from `chatHelpers.tsx`

**Step 4: Run tests**

Run: `npm test -- src/main/customization.test.ts`  
Expected: PASS

**PASS3:** `customization.ts`, `toolDefinitions.ts`, and tests updated — no `apply_theme_preset`; `update_theme` patches fonts only.

**Step 5: Commit**

```bash
git add src/main/customization.ts src/main/customization.test.ts src/main/providers/toolDefinitions.ts src/renderer/chatHelpers.tsx
git commit -m "refactor(customization): remove theme preset and size tools"
```

---

### Task 4: Remove Settings UI for color mode and font size

**Files:**
- Modify: `src/renderer/SettingsView.tsx`
- Modify: `src/renderer/settings.css`
- Modify: `src/renderer/settings/settingsNavConfig.ts`

**Step 1: Manual verification checklist (no new unit test)**

After edit, Appearance tab should show Typography (2 selects) + Grid overlay only.

**Step 2: Edit SettingsView.tsx**

- Remove imports: `FONT_SIZE_OPTIONS`, `stepFontSize`, `coerceFontSizePx`, `THEME_PRESETS`, `Minus`, `Plus` (if unused elsewhere)
- Remove `activeThemePresetId` derived state
- Delete entire “Color theme” `SettingsGroup` (lines ~957–982)
- Delete “Base font size” `SettingsField` and stepper (lines ~1018–1139)
- Keep UI font + Code/notes font selects

**Step 3: Edit settings.css**

- Remove `.settings-font-size-stepper*` rules (~lines 223–325)
- Remove `:not(.settings-font-size-stepper__input)` exceptions in input selectors (simplify to generic input rules)
- Mirror same cleanup in `base.css` if duplicated

**Step 4: Update settingsNavConfig keywords**

Change appearance subtitle to `"Fonts, layout & editor"`; remove `"color"` from keywords.

**Step 5: Run tests + lint**

Run: `npm test`  
Expected: PASS

**PASS4:** Settings Appearance tab — typography font selects and grid overlay only; no color toggle or font-size stepper; nav config updated.

**Step 6: Commit**

```bash
git add src/renderer/SettingsView.tsx src/renderer/settings.css src/renderer/settings/settingsNavConfig.ts src/renderer/base.css
git commit -m "refactor(settings): remove color mode and font size controls"
```

---

### Task 5: Fix remaining tests and sync fixtures

**Files:**
- Modify: `src/shared/syncMerge.test.ts`
- Modify: any other failing tests from full suite

**Step 1: Run full test suite**

Run: `npm test`  
Expected: May FAIL on syncMerge or theme references

**Step 2: Update syncMerge.test.ts theme fixtures**

Remove `fontSize` and legacy color fields from theme.json merge fixtures; assert merged result has `font` / `fontMono` only.

**Step 3: Re-run**

Run: `npm test`  
Expected: PASS

**PASS5:** Full `npm test` green; sync merge fixtures match new theme shape.

**Step 4: Commit**

```bash
git add src/shared/syncMerge.test.ts
git commit -m "test: update theme fixtures after simplification"
```

---

### Task 6: iOS theme.json parity

**Files:**
- Modify: `ios/HarnessMobile/Data/ThemeSupport.swift`
- Modify: `ios/HarnessMobileTests/ThemeResolverTests.swift`

**Step 1: Update Swift model**

Remove `fontSize` property; ignore on decode. Remove `mode` if modeled.

**Step 2: Update tests**

Remove fontSize assertions; add test that legacy JSON with `fontSize`/`mode` decodes without error.

**Step 3: Run iOS tests** (if available in CI)

Run: `xcodebuild test -scheme HarnessMobile` (or project equivalent)  
Expected: PASS

**PASS6:** iOS `ThemeSupport.swift` and tests aligned — no `fontSize`/`mode` on model; legacy JSON still decodes.

**Step 4: Commit**

```bash
git add ios/HarnessMobile/Data/ThemeSupport.swift ios/HarnessMobileTests/ThemeResolverTests.swift
git commit -m "refactor(ios): align theme model with desktop simplification"
```

---

### Task 7: Documentation cleanup

**Files:**
- Modify: `docs/4PX_GRID.md`
- Modify: `ROADMAP.md` (optional one-line update)

**Step 1: Update 4PX_GRID.md**

- Remove `lineHeightForFont` bullet (not in `grid.ts`)
- Change type-scale section: tokens are static in `base.css`; no runtime override from Theme studio font size
- Note removed layout density → now fixed scale

**Step 2: Commit**

```bash
git add docs/4PX_GRID.md ROADMAP.md
git commit -m "docs: reflect fixed typography scale"
```

**PASS7:** `docs/4PX_GRID.md` (and optional `ROADMAP.md`) describe static tokens in `base.css`, not runtime font-size overrides.

---

## Final verification

Run: `npm test`  
Run: `npm run grid:audit`  
Manual smoke:

1. Launch app — dark theme, 14px body text
2. Settings → Appearance — font selects work; no color/size controls
3. Place `theme.json` with `{ "mode": "light", "fontSize": 12 }` in themes dir — app loads dark at 14px
4. Agent `update_theme` with `{ "font": "inter" }` succeeds; `{ "fontSize": 16 }` ignored
