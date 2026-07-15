import Foundation

enum AssistantTools {
    static func execute(name: String, args: [String: Any], store: ConversationStore) throws -> String {
        switch name {
        case "memory_search_conversations":
            return try encodeSearchResult(args: args, store: store)
        default:
            return encodeJSON(["error": "Unknown assistant tool: \(name)"])
        }
    }

    private static func encodeSearchResult(args: [String: Any], store: ConversationStore) throws -> String {
        let query = (args["query"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let results = query.isEmpty ? [] : try ConversationSearch.search(in: store.localDataDir, query: query)
        let resultObjects = results.map { result -> [String: Any] in
            var object: [String: Any] = [
                "id": result.id,
                "title": result.title as Any,
                "createdAt": result.createdAt,
                "titleMatched": result.titleMatched,
                "snippet": result.snippet,
                "snippetMatchRange": result.snippetMatchRange,
            ]
            if let titleMatchRange = result.titleMatchRange {
                object["titleMatchRange"] = titleMatchRange
            }
            return object
        }
        return encodeJSON([
            "lastAction": "search_conversations",
            "query": query,
            "results": resultObjects,
        ])
    }

    private static func encodeJSON(_ object: [String: Any]) -> String {
        ToolResultJSON.encode(object)
    }
}

enum ToolResultJSON {
    static func encodeError(_ message: String) -> String {
        encode(["error": message])
    }

    static func encode(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let string = String(data: data, encoding: .utf8)
        else {
            return #"{"error":"Failed to encode tool result"}"#
        }
        return string
    }
}

enum AssistantToolDefinitions {
    static var trackedToolNames: Set<String> {
        TaskToolDefinitions.toolNames.union(ChatToolDefinitions.toolNames)
    }

    static var openAITools: [[String: Any]] {
        TaskToolDefinitions.openAITools + ChatToolDefinitions.openAITools
    }
}
