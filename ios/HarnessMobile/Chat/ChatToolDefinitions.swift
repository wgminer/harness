import Foundation

enum ChatToolDefinitions {
    static let toolNames: Set<String> = [
        "memory_search_conversations",
    ]

    static let openAITools: [[String: Any]] = [
        [
            "type": "function",
            "function": [
                "name": "memory_search_conversations",
                "description":
                    "Search all prior conversations for a free-text query. Use whenever cross-thread recall, continuity, names, or prior decisions would help — not only when the user explicitly asks to search chat history.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "query": ["type": "string", "description": "Search query text"],
                    ] as [String: Any],
                    "required": ["query"],
                ] as [String: Any],
            ] as [String: Any],
        ],
    ]
}
