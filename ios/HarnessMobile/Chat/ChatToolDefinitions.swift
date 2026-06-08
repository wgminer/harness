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
                    "Search across the full chat history (all conversations) for a free-text query and return matching conversations and message snippets.",
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
