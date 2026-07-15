import Foundation

enum ChatToolDefinitions {
    static let baseToolNames: Set<String> = [
        "memory_set_fact",
        "memory_list_facts",
        "memory_search_conversations",
        "get_datetime",
    ]

    static let toolNames: Set<String> = baseToolNames.union(["web_search"])

    static let baseOpenAITools: [[String: Any]] = [
        [
            "type": "function",
            "function": [
                "name": "memory_set_fact",
                "description": "Store a stable user fact or preference in persistent memory.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "key": ["type": "string"],
                        "value": ["type": "string"],
                    ] as [String: Any],
                    "required": ["key", "value"],
                ] as [String: Any],
            ] as [String: Any],
        ],
        [
            "type": "function",
            "function": [
                "name": "memory_list_facts",
                "description": "List all stored persistent user facts and preferences.",
                "parameters": ["type": "object", "properties": [:] as [String: Any]],
            ] as [String: Any],
        ],
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
        [
            "type": "function",
            "function": [
                "name": "get_datetime",
                "description": "Get the current date and time from the app host.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "timezone": [
                            "type": "string",
                            "description": "Optional IANA timezone",
                        ],
                    ] as [String: Any],
                ] as [String: Any],
            ] as [String: Any],
        ],
    ]

    static let webSearchOpenAITool: [[String: Any]] = [
        [
            "type": "function",
            "function": [
                "name": "web_search",
                "description": "Search the web for current information via Tavily.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "query": ["type": "string"],
                        "max_results": ["type": "number"],
                    ] as [String: Any],
                    "required": ["query"],
                ] as [String: Any],
            ] as [String: Any],
        ],
    ]
}
