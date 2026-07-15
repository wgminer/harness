import { describe, expect, it } from "vitest";
import { tauriCommandName, tauriEventName } from "./ipcNames";

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
