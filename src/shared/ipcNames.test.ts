import { describe, expect, it } from "vitest";
import { legacyIpcCommand, legacyIpcEvent } from "./ipcNames";

describe("legacyIpcCommand", () => {
  it("maps namespace methods to snake_case Rust command ids", () => {
    expect(legacyIpcCommand("chat:send")).toBe("chat_send");
    expect(legacyIpcCommand("memory:createConversation")).toBe("memory_create_conversation");
    expect(legacyIpcCommand("credentials:getStatus")).toBe("credentials_get_status");
    expect(legacyIpcCommand("credentials:setOpenAIApiKey")).toBe("credentials_set_open_ai_api_key");
    expect(legacyIpcCommand("settings:set")).toBe("settings_set");
    expect(legacyIpcCommand("settings:getSystemPromptPreview")).toBe("settings_get_system_prompt_preview");
    expect(legacyIpcCommand("env:isHarnessE2E")).toBe("env_is_harness_e2e");
    expect(legacyIpcCommand("recording:signalFrontendReady")).toBe("recording_signal_frontend_ready");
    expect(legacyIpcCommand("recording:getGlobalStatus")).toBe("recording_get_global_status");
    expect(legacyIpcCommand("notes:openSticky")).toBe("notes_open_sticky");
    expect(legacyIpcCommand("notes:setStickyPinned")).toBe("notes_set_sticky_pinned");
    expect(legacyIpcCommand("notes:popInSticky")).toBe("notes_pop_in_sticky");
    expect(legacyIpcCommand("images:list")).toBe("images_list");
    expect(legacyIpcCommand("images:create")).toBe("images_create");
    expect(legacyIpcCommand("images:generate")).toBe("images_generate");
    expect(legacyIpcCommand("chat:getContextPreview")).toBe("chat_get_context_preview");
    expect(legacyIpcCommand("memory:linkDictationRecording")).toBe("memory_link_dictation_recording");
    expect(legacyIpcCommand("memory:getConversationRecordings")).toBe(
      "memory_get_conversation_recordings",
    );
  });
});

describe("legacyIpcEvent", () => {
  it("maps namespace events to kebab-case wire names", () => {
    expect(legacyIpcEvent("chat:streamChunk")).toBe("chat-stream-chunk");
    expect(legacyIpcEvent("chat:streamEnd")).toBe("chat-stream-end");
    expect(legacyIpcEvent("chat:toolPanelUpdate")).toBe("chat-tool-panel-update");
    expect(legacyIpcEvent("customization:updated")).toBe("customization-updated");
    expect(legacyIpcEvent("sync:changed")).toBe("sync-changed");
    expect(legacyIpcEvent("chat:noteStreamOpen")).toBe("chat-note-stream-open");
    expect(legacyIpcEvent("chat:noteStreamChunk")).toBe("chat-note-stream-chunk");
    expect(legacyIpcEvent("chat:noteStreamClose")).toBe("chat-note-stream-close");
    expect(legacyIpcEvent("notes:openInMain")).toBe("notes-open-in-main");
  });
});
