import Foundation

@MainActor
enum AssistantTools {
    static func execute(name: String, args: [String: Any], store: ConversationStore) async throws -> String {
        switch name {
        case "memory_set_fact":
            return try encodeMemoryFacts(try store.setUserMemoryFact(args: args))
        case "memory_list_facts":
            return try encodeMemoryFacts(try store.listUserMemoryFacts())
        case "memory_search_conversations":
            return try encodeSearchResult(args: args, store: store)
        case "get_datetime":
            return encodeJSON(DateTimeTool.result(args: args))
        case "web_search":
            let apiKey = try store.loadTavilyApiKey() ?? ""
            return encodeJSON(await WebSearchTool.result(args: args, apiKey: apiKey))
        default:
            return encodeJSON(["error": "Unknown assistant tool: \(name)"])
        }
    }

    private static func encodeMemoryFacts(_ payload: MemoryFactsPayload) -> String {
        var object: [String: Any] = [
            "lastAction": payload.lastAction,
            "memory": payload.memory,
        ]
        if let key = payload.key {
            object["key"] = key
        }
        return encodeJSON(object)
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

struct MemoryFactsPayload {
    let lastAction: String
    let memory: [String: String]
    let key: String?
}

enum DateTimeTool {
    static func result(args: [String: Any]) -> [String: Any] {
        let now = Date()
        let requested = (args["timezone"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        let timezoneId: String
        if requested.isEmpty {
            timezoneId = TimeZone.current.identifier
        } else if TimeZone(identifier: requested) != nil {
            timezoneId = requested
        } else {
            return ["error": "Invalid timezone: \(requested)"]
        }

        let timeZone = TimeZone(identifier: timezoneId) ?? .current
        let epochMs = Int64(now.timeIntervalSince1970 * 1000)
        let utcISO = ISO8601DateFormatter().string(from: now)

        let offsetFormatter = DateFormatter()
        offsetFormatter.timeZone = timeZone
        offsetFormatter.dateFormat = "XXX"

        let localISOFormatter = DateFormatter()
        localISOFormatter.timeZone = timeZone
        localISOFormatter.locale = Locale(identifier: "en_US_POSIX")
        localISOFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"

        let formattedFormatter = DateFormatter()
        formattedFormatter.timeZone = timeZone
        formattedFormatter.locale = Locale(identifier: "en_US_POSIX")
        formattedFormatter.dateFormat = "EEEE, MMMM dd, yyyy 'at' hh:mm:ss a zzz"

        return [
            "epoch_ms": epochMs,
            "utc_iso": utcISO,
            "timezone": timezoneId,
            "offset": offsetFormatter.string(from: now),
            "local_iso": localISOFormatter.string(from: now),
            "formatted": formattedFormatter.string(from: now),
        ]
    }
}

enum WebSearchTool {
    private static let searchURL = URL(string: "https://api.tavily.com/search")!

    static func result(args: [String: Any], apiKey: String) async -> [String: Any] {
        let query = (args["query"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty {
            return errorPayload(query: "", message: "Search query is required")
        }

        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedKey.isEmpty {
            return errorPayload(
                query: query,
                message: "Tavily API key is not set. Add search.tavilyApiKey in settings/settings.json on this device."
            )
        }

        let maxResults = clampMaxResults(args["max_results"])
        var request = URLRequest(url: searchURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 45
        let body: [String: Any] = [
            "api_key": trimmedKey,
            "query": query,
            "search_depth": "basic",
            "max_results": maxResults,
            "include_answer": false,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return errorPayload(query: query, message: "Invalid response from Tavily")
            }
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            guard http.statusCode >= 200, http.statusCode < 300 else {
                let detail = (json["detail"] as? String) ?? (json["message"] as? String) ?? "request failed"
                return errorPayload(query: query, message: "Tavily error: \(detail)")
            }

            let rawResults = json["results"] as? [[String: Any]] ?? []
            let hits: [[String: Any]] = rawResults.map { row in
                let title = (row["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                let url = row["url"] as? String ?? ""
                let content = row["content"] as? String ?? ""
                let resolvedTitle: String
                if title.isEmpty {
                    resolvedTitle = url.isEmpty ? "Untitled" : url
                } else {
                    resolvedTitle = title
                }
                let snippet = String(content.prefix(4000))
                return [
                    "title": resolvedTitle,
                    "url": url,
                    "snippet": snippet,
                ]
            }

            var payload: [String: Any] = [
                "query": query,
                "results": hits,
            ]
            if let answer = (json["answer"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
               !answer.isEmpty {
                payload["answer"] = answer
            }
            return payload
        } catch {
            return errorPayload(query: query, message: error.localizedDescription)
        }
    }

    private static func clampMaxResults(_ value: Any?) -> Int {
        let parsed: Double
        switch value {
        case let n as Int: parsed = Double(n)
        case let n as Double where n.isFinite: parsed = n
        case let n as NSNumber: parsed = n.doubleValue
        default: parsed = 5
        }
        let clamped = parsed > 0 ? parsed : 5
        return min(10, max(1, Int(clamped)))
    }

    private static func errorPayload(query: String, message: String) -> [String: Any] {
        [
            "query": query,
            "results": [] as [[String: Any]],
            "error": message,
        ]
    }
}

enum AssistantToolDefinitions {
    static var trackedToolNames: Set<String> {
        TaskToolDefinitions.toolNames.union(ChatToolDefinitions.toolNames)
    }

    static func openAITools(in localDataDir: URL) -> [[String: Any]] {
        var tools = TaskToolDefinitions.openAITools + ChatToolDefinitions.baseOpenAITools
        if hasTavilyApiKey(in: localDataDir) {
            tools += ChatToolDefinitions.webSearchOpenAITool
        }
        return tools
    }

    static func hasTavilyApiKey(in localDataDir: URL) -> Bool {
        let path = LocalDataLayout.fileURL(in: localDataDir, relativePath: LocalDataLayout.settingsFile)
        guard FileManager.default.fileExists(atPath: path.path),
              let data = try? LocalDataLayout.readRegularFileData(at: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let search = json["search"] as? [String: Any],
              let key = search["tavilyApiKey"] as? String
        else { return false }
        return !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
