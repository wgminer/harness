import Foundation

/// Static prompt fields from the bundled `resources/contracts/systemPrompt.json`
/// (same file desktop `include_str!`s and TypeScript imports). Not settings-overridable.
struct SystemPromptSettings: Equatable {
    var shared: String
    var desktop: String
    var ios: String

    static let defaults = SystemPromptSettings.loadContractDefaults()

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

    private static func loadContractDefaults() -> SystemPromptSettings {
        guard let url = Bundle.main.url(forResource: "systemPrompt", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let shared = json["shared"] as? String, !shared.isEmpty,
              let desktop = json["desktop"] as? String, !desktop.isEmpty,
              let ios = json["ios"] as? String, !ios.isEmpty
        else {
            assertionFailure("resources/contracts/systemPrompt.json failed to load or parse from the app bundle")
            return SystemPromptSettings(
                shared: "You are Here — a thinking partner in a personal app.",
                desktop: "[CORE_INSTRUCTIONS]\nYou are Here running in a local desktop app.",
                ios: "[CORE_INSTRUCTIONS]\nYou are Here on iOS (Here Mobile)."
            )
        }
        return SystemPromptSettings(shared: shared, desktop: desktop, ios: ios)
    }
}
