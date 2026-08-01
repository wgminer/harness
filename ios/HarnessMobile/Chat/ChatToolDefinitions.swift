import Foundation

enum ChatToolDefinitions {
    static let baseToolNames: Set<String> = [
        "memory_set",
        "memory_list",
        "memory_search_conversations",
        "get_datetime",
    ]

    static let toolNames: Set<String> = baseToolNames.union(["web_search"])

    /// OpenAI schemas for `baseToolNames`, sourced from the shared `resources/contracts/tools.json`
    /// (see `SharedToolDefinitions`) rather than hand-copied — keeps iOS in sync with desktop.
    static var baseOpenAITools: [[String: Any]] {
        SharedToolDefinitions.filtered(names: baseToolNames)
    }

    static var webSearchOpenAITool: [[String: Any]] {
        SharedToolDefinitions.filtered(names: ["web_search"])
    }
}
