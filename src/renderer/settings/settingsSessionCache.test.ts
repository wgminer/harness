import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../../shared/types";
import {
  loadSettingsForSystemPage,
  nonSecretHydrationFromSettings,
  resetSettingsSessionCacheForTests,
  setCachedSettings,
  shouldLoadSettingsSecrets,
} from "./settingsSessionCache";

describe("settingsSessionCache", () => {
  afterEach(() => {
    resetSettingsSessionCacheForTests();
  });

  describe("shouldLoadSettingsSecrets", () => {
    it("does not load on General when secrets are not loaded yet", () => {
      expect(shouldLoadSettingsSecrets("general", false, false)).toBe(false);
    });

    it("loads when Data tab is active", () => {
      expect(shouldLoadSettingsSecrets("data", false, false)).toBe(true);
    });

    it("loads when Sync QR opens from General", () => {
      expect(shouldLoadSettingsSecrets("general", true, false)).toBe(true);
    });

    it("skips once secrets are already loaded", () => {
      expect(shouldLoadSettingsSecrets("data", true, true)).toBe(false);
    });
  });

  describe("loadSettingsForSystemPage", () => {
    it("skips settings.get when the session cache is warm", async () => {
      const cached = { ...DEFAULT_SETTINGS, recording: { autoSend: false, globalFnHotkey: true } };
      setCachedSettings(cached);
      const fetchSettings = vi.fn(async () => DEFAULT_SETTINGS);

      const result = await loadSettingsForSystemPage({
        getCached: () => cached,
        fetchSettings,
        setCache: setCachedSettings,
      });

      expect(result.fetched).toBe(false);
      expect(result.settings).toBe(cached);
      expect(fetchSettings).not.toHaveBeenCalled();
    });

    it("fetches and seeds the cache on a cold open", async () => {
      const fetched = {
        ...DEFAULT_SETTINGS,
        chat: { openToComposeOnLaunch: false },
      } satisfies Settings;
      const fetchSettings = vi.fn(async () => fetched);
      const setCache = vi.fn();

      const result = await loadSettingsForSystemPage({
        getCached: () => null,
        fetchSettings,
        setCache,
      });

      expect(result.fetched).toBe(true);
      expect(result.settings).toBe(fetched);
      expect(fetchSettings).toHaveBeenCalledTimes(1);
      expect(setCache).toHaveBeenCalledWith(fetched);
    });
  });

  describe("nonSecretHydrationFromSettings", () => {
    it("maps recording and chat fields used on General", () => {
      const hydrated = nonSecretHydrationFromSettings({
        ...DEFAULT_SETTINGS,
        recording: {
          autoSend: false,
          globalFnHotkey: false,
          bringToFrontOnBackgroundDictation: true,
        },
        chat: { openToComposeOnLaunch: false },
        appearance: { accent: "#112233" },
      });
      expect(hydrated.autoSend).toBe(false);
      expect(hydrated.globalFnHotkey).toBe(false);
      expect(hydrated.bringToFrontOnBackgroundDictation).toBe(true);
      expect(hydrated.openToComposeOnLaunch).toBe(false);
      expect(hydrated.accent).toBe("#112233");
    });
  });
});
