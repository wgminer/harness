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
    it("always refetches so a warm cache cannot hide synced settings", async () => {
      const cached = { ...DEFAULT_SETTINGS, recording: { autoSend: false, globalFnHotkey: true } };
      setCachedSettings(cached);
      const fetched = {
        ...DEFAULT_SETTINGS,
        recording: { autoSend: true, globalFnHotkey: true, bringToFrontOnBackgroundDictation: false },
      } satisfies Settings;
      const fetchSettings = vi.fn(async () => fetched);

      const result = await loadSettingsForSystemPage({
        getCached: () => cached,
        fetchSettings,
        setCache: setCachedSettings,
      });

      expect(result.fetched).toBe(true);
      expect(result.settings).toBe(fetched);
      expect(fetchSettings).toHaveBeenCalledTimes(1);
    });

    it("fetches and seeds the cache on a cold open", async () => {
      const fetched = {
        ...DEFAULT_SETTINGS,
        chat: { openToComposeOnLaunch: false, selectionImageLookup: false },
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
        chat: { openToComposeOnLaunch: false, selectionImageLookup: true },
        appearance: { accent: "#112233", theme: "time" },
      });
      expect(hydrated.autoSend).toBe(false);
      expect(hydrated.globalFnHotkey).toBe(false);
      expect(hydrated.bringToFrontOnBackgroundDictation).toBe(true);
      expect(hydrated.openToComposeOnLaunch).toBe(false);
      expect(hydrated.selectionImageLookup).toBe(true);
      expect(hydrated.accent).toBe("#112233");
      expect(hydrated.appearanceTheme).toBe("time");
      expect(hydrated.weatherZip).toBe(DEFAULT_SETTINGS.weather!.defaultZip);
    });

    it("migrates legacy dictionary entries into preferred spellings", () => {
      const hydrated = nonSecretHydrationFromSettings({
        ...DEFAULT_SETTINGS,
        transcription: {
          cleanup: DEFAULT_SETTINGS.transcription!.cleanup!,
          dictionary: [{ from: "cursor", to: "Cursor" }],
        } as Settings["transcription"],
      });
      expect(hydrated.transcriptGlossary).toEqual(["Cursor"]);
    });

    it("maps weather ZIP when present", () => {
      const hydrated = nonSecretHydrationFromSettings({
        ...DEFAULT_SETTINGS,
        weather: { defaultZip: "10001" },
      });
      expect(hydrated.weatherZip).toBe("10001");
    });
  });
});
