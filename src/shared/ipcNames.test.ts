import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tauriCommandName, tauriEventName } from "./ipcNames";

const root = join(__dirname, "../..");

/** Wire names registered in `tauri::generate_handler![...]` (lib.rs). */
function parseGenerateHandlerWireNames(): Set<string> {
  const lib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const match = lib.match(/generate_handler!\[([\s\S]*?)\]/);
  if (!match) throw new Error("generate_handler! block not found in src-tauri/src/lib.rs");
  const names = new Set<string>();
  for (const entry of match[1].split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const wire = trimmed.split("::").pop()?.trim();
    if (!wire) throw new Error(`Could not parse generate_handler entry: ${entry}`);
    names.add(wire);
  }
  return names;
}

/** `namespace:method` literals passed through `cmd()` in desktopAdapter. */
function parseDesktopAdapterIpcNames(): string[] {
  const src = readFileSync(join(root, "src/renderer/desktopAdapter.ts"), "utf8");
  const names = new Set<string>();
  const re = /cmd\(["']([^"']+)["']\)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

describe("tauriCommandName", () => {
  it("maps namespace methods to snake_case Rust command ids", () => {
    expect(tauriCommandName("chat:send")).toBe("chat_send");
    expect(tauriCommandName("memory:createConversation")).toBe("memory_create_conversation");
    expect(tauriCommandName("credentials:getStatus")).toBe("credentials_get_status");
    expect(tauriCommandName("credentials:setOpenAIApiKey")).toBe("credentials_set_open_ai_api_key");
    expect(tauriCommandName("settings:set")).toBe("settings_set");
    expect(tauriCommandName("settings:getSystemPromptPreview")).toBe("settings_get_system_prompt_preview");
    expect(tauriCommandName("env:isHarnessE2E")).toBe("env_is_harness_e2e");
    expect(tauriCommandName("recording:signalFrontendReady")).toBe("recording_signal_frontend_ready");
    expect(tauriCommandName("recording:getGlobalStatus")).toBe("recording_get_global_status");
    expect(tauriCommandName("notes:openSticky")).toBe("notes_open_sticky");
    expect(tauriCommandName("notes:setStickyPinned")).toBe("notes_set_sticky_pinned");
    expect(tauriCommandName("notes:popInSticky")).toBe("notes_pop_in_sticky");
    expect(tauriCommandName("images:list")).toBe("images_list");
    expect(tauriCommandName("images:create")).toBe("images_create");
    expect(tauriCommandName("images:generate")).toBe("images_generate");
    expect(tauriCommandName("chat:getContextPreview")).toBe("chat_get_context_preview");
    expect(tauriCommandName("memory:linkDictationRecording")).toBe("memory_link_dictation_recording");
    expect(tauriCommandName("memory:getConversationRecordings")).toBe(
      "memory_get_conversation_recordings",
    );
  });
});

describe("tauriEventName", () => {
  it("maps namespace events to kebab-case wire names", () => {
    expect(tauriEventName("chat:streamChunk")).toBe("chat-stream-chunk");
    expect(tauriEventName("chat:streamEnd")).toBe("chat-stream-end");
    expect(tauriEventName("chat:toolPanelUpdate")).toBe("chat-tool-panel-update");
    expect(tauriEventName("customization:updated")).toBe("customization-updated");
    expect(tauriEventName("sync:changed")).toBe("sync-changed");
    expect(tauriEventName("chat:noteStreamOpen")).toBe("chat-note-stream-open");
    expect(tauriEventName("chat:noteStreamChunk")).toBe("chat-note-stream-chunk");
    expect(tauriEventName("chat:noteStreamClose")).toBe("chat-note-stream-close");
    expect(tauriEventName("notes:openInMain")).toBe("notes-open-in-main");
  });
});

describe("ipcNames ↔ generate_handler drift", () => {
  it("maps every desktopAdapter invoke to a registered Tauri handler", () => {
    const handlers = parseGenerateHandlerWireNames();
    const ipcNames = parseDesktopAdapterIpcNames();
    const missing: string[] = [];

    for (const ipc of ipcNames) {
      const wire = tauriCommandName(ipc);
      if (!handlers.has(wire)) missing.push(`${ipc} → ${wire}`);
    }

    expect(missing, `Unregistered handlers:\n${missing.join("\n")}`).toEqual([]);
  });

  it("registers a handler for every desktopAdapter invoke (no orphan wire names)", () => {
    const handlers = parseGenerateHandlerWireNames();
    const ipcNames = parseDesktopAdapterIpcNames();
    const wired = new Set(ipcNames.map(tauriCommandName));
    const orphan = [...handlers].filter((wire) => !wired.has(wire)).sort();

    expect(
      orphan,
      `Handlers in generate_handler! with no desktopAdapter cmd():\n${orphan.join("\n")}`,
    ).toEqual([]);
  });
});
