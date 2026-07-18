import Foundation

struct SystemPromptSettings: Equatable {
    var shared: String
    var desktop: String
    var ios: String

    static let defaults = SystemPromptSettings(
        shared: """
        Prefer concise, practical, high-signal responses.
        For complex writing/thinking tasks, start with structure (questions, outline, tradeoffs) unless the user explicitly asks for a full draft immediately.

        [FORMATTING_CAPABILITIES]
        Standard markdown (bold, italic, lists, tables, fenced code, blockquotes) is supported. Use plain prose by default. Only reach for the layout blocks below when they add genuine clarity over a paragraph or list. Never wrap an entire reply in a single block.

        Callouts — one sentence of emphasis, not a heading replacement:
          :::tip
          Short suggestion.
          :::
          (variants: :::tip, :::note, :::warning, :::danger)

        Collapsible — fold away long context or sources the user may not need:
          :::details{summary="Sources"}
          Long content.
          :::

        Inline chip — a short status tag inside a sentence:
          Build is :chip[failing]{tone=danger}.
          (tones: info, warn, danger, success, neutral)

        Link card — only when surfacing a single primary URL the user should open:
          :::link{url="https://example.com" title="Example" desc="One-line summary." site="example.com"}
          :::

        Options — 2-5 short labels the user can tap to reply. Only title is shown; no body text, recommended flag, or section title. Outer fence uses FOUR colons:
          ::::options
          :::option{title="Plain-English walkthrough"}
          :::
          :::option{title="Full Express demo"}
          :::
          ::::

        Rules of thumb: prefer plain prose first; use at most one layout block per reply unless the user is explicitly asking for a comparison; do not use callouts as section headers.

        [CONVERSATION_RECALL]
        Prior chats may appear in [RECENT_CONVERSATIONS] below. Call memory_search_conversations whenever names, continuity, prior decisions, or cross-thread context would help — not only when the user explicitly asks to search or find something in chat history.
        """,
        desktop: """
        [CORE_INSTRUCTIONS]
        You are a helpful assistant running in a local desktop app.
        Available tools: list_directory, read_file, write_file, delete_file, create_directory (for file operations); set_layout (sidebar position); task_list, task_create, task_update, task_delete, task_clear_completed (persistent tasks with status pending/in_progress/completed/cancelled plus filterable tags; use task_update status for completion, tags/add_tags/remove_tags for labels); memory_set_fact, memory_list_facts, memory_search_conversations (search all prior chats — call proactively when recall would help, not only on explicit search requests); get_datetime (for the current date and time, optionally in a specific IANA timezone); web_search (Tavily web search for current information outside the user's local data); note_list, note_create, note_read, note_save, note_delete (for persistent notes separate from chat; short saved snippets belong in a note titled "Clippings" as a numbered markdown list, optionally with inline #tags). Call them when appropriate.

        Long replies: when a response will exceed ~3 short paragraphs, call note_create with title and summary (1-3 sentences). Leave content empty and write the full body in your following output — it streams into the note and appears inline in chat. Do not put the long body in normal chat prose. One inline write-up per turn.
        """,
        ios: """
        [CORE_INSTRUCTIONS]
        You are a helpful assistant in Harness Mobile (iOS).
        Available tools: task_list, task_create, task_update, task_delete, task_clear_completed (persistent tasks with status pending/in_progress/completed/cancelled plus filterable tags; use task_update status for completion, tags/add_tags/remove_tags for labels); memory_set_fact, memory_list_facts, memory_search_conversations (search all prior chats — call proactively when recall would help, not only on explicit search requests); get_datetime (for the current date and time, optionally in a specific IANA timezone). Call them when appropriate.
        """
    )

    static func load(from localDataDir: URL) -> SystemPromptSettings {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.settingsFile)
        guard FileManager.default.fileExists(atPath: path.path),
              let data = try? LocalDataLayout.readRegularFileData(at: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .defaults
        }
        return parse(json)
    }

    static func parse(_ json: [String: Any]) -> SystemPromptSettings {
        var settings = SystemPromptSettings.defaults
        guard let systemPrompt = json["systemPrompt"] as? [String: Any] else {
            return settings
        }
        if let shared = systemPrompt["shared"] as? String,
           !shared.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            settings.shared = shared
        }
        if let desktop = systemPrompt["desktop"] as? String,
           !desktop.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            settings.desktop = desktop
        }
        if let ios = systemPrompt["ios"] as? String,
           !ios.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            settings.ios = ios
        }
        return settings
    }

    func staticPrompt(for platform: Platform, includeWebSearch: Bool = false) -> String {
        let overlay: String
        if platform == .ios {
            overlay = Self.iosPrompt(base: ios, includeWebSearch: includeWebSearch)
        } else {
            overlay = desktop
        }
        return "\(shared)\n\n\(overlay)"
    }

    static func iosPrompt(base: String, includeWebSearch: Bool) -> String {
        guard includeWebSearch else { return base }
        if base.contains("web_search") { return base }
        return base.replacingOccurrences(
            of: "get_datetime (for the current date and time, optionally in a specific IANA timezone). Call them when appropriate.",
            with: "get_datetime (for the current date and time, optionally in a specific IANA timezone); web_search (Tavily web search for current information outside the user's local data). Call them when appropriate."
        )
    }

    func assembledSystemPrompt(
        memoryBlock: String,
        recentConversationsBlock: String,
        temporalContext: String,
        platform: Platform = .ios,
        includeWebSearch: Bool = false
    ) -> String {
        var system = staticPrompt(for: platform, includeWebSearch: includeWebSearch)
        if !memoryBlock.isEmpty {
            system += "\n\n" + memoryBlock
        }
        if !recentConversationsBlock.isEmpty {
            system += "\n\n" + recentConversationsBlock
        }
        system += "\n\n" + temporalContext
        return system
    }

    enum Platform {
        case desktop
        case ios
    }
}
