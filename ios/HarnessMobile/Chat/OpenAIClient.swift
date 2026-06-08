import Foundation

enum OpenAIModel {
    /// Keep in sync with `src/shared/openaiModels.ts` (`OPENAI_CHAT_MODEL`).
    static let chat = "gpt-5.4"
    /// Keep in sync with `src/shared/openaiModels.ts` (`OPENAI_TITLE_MODEL`).
    static let title = "gpt-5.4-nano"
}

struct ChatCompletionMessage {
    let role: String
    var content: String?
    var toolCalls: [AccumulatedToolCall]?
    var toolCallId: String?

    func toRequestBody() -> [String: Any] {
        var body: [String: Any] = ["role": role]
        if role == "tool" {
            body["tool_call_id"] = toolCallId ?? ""
            body["content"] = content ?? ""
            return body
        }
        if let toolCalls, !toolCalls.isEmpty {
            body["content"] = content
            body["tool_calls"] = toolCalls.map { call in
                [
                    "id": call.id,
                    "type": "function",
                    "function": [
                        "name": call.name,
                        "arguments": call.arguments,
                    ],
                ] as [String: Any]
            }
            return body
        }
        body["content"] = content ?? ""
        return body
    }
}

struct AccumulatedToolCall: Equatable {
    let id: String
    let name: String
    let arguments: String
}

struct ChatCompletionResult {
    let content: String
    let toolCalls: [ToolCallRecord]
}

@MainActor
final class OpenAIClient {
    private let apiKey: String
    private var streamTask: Task<ChatCompletionResult, Error>?

    init(apiKey: String) {
        self.apiKey = apiKey
    }

    func cancel() {
        streamTask?.cancel()
        streamTask = nil
    }

    func streamChat(
        messages: [ChatCompletionMessage],
        onChunk: @escaping (String) -> Void
    ) async throws -> String {
        let result = try await streamChatWithTools(
            messages: messages,
            tools: nil,
            executeTool: nil,
            onChunk: onChunk
        )
        return result.content
    }

    func streamChatWithTools(
        messages: [ChatCompletionMessage],
        tools: [[String: Any]]?,
        executeTool: ((String, [String: Any]) async throws -> String)?,
        onChunk: @escaping (String) -> Void
    ) async throws -> ChatCompletionResult {
        let task = Task<ChatCompletionResult, Error> {
            var currentMessages = messages
            var fullContent = ""
            var collectedToolCalls: [ToolCallRecord] = []

            while true {
                let iteration = try await self.streamSingleCompletion(
                    messages: currentMessages,
                    tools: tools,
                    onChunk: onChunk
                )
                fullContent += iteration.content

                guard let executeTool, let toolCalls = iteration.toolCalls, !toolCalls.isEmpty else {
                    return ChatCompletionResult(content: fullContent, toolCalls: collectedToolCalls)
                }

                currentMessages.append(
                    ChatCompletionMessage(
                        role: "assistant",
                        content: iteration.content.isEmpty ? nil : iteration.content,
                        toolCalls: toolCalls
                    )
                )

                for call in toolCalls {
                    let args = parseToolArguments(call.arguments)
                    let result = try await executeTool(call.name, args)
                    if AssistantToolDefinitions.trackedToolNames.contains(call.name),
                       let payload = parseJSONValue(result) {
                        collectedToolCalls.append(ToolCallRecord(toolName: call.name, payload: payload.any))
                    }
                    currentMessages.append(
                        ChatCompletionMessage(
                            role: "tool",
                            content: result,
                            toolCallId: call.id
                        )
                    )
                }
            }
        }
        streamTask = task
        defer { streamTask = nil }
        return try await task.value
    }

    private struct StreamIteration {
        let content: String
        let toolCalls: [AccumulatedToolCall]?
    }

    private func streamSingleCompletion(
        messages: [ChatCompletionMessage],
        tools: [[String: Any]]?,
        onChunk: @escaping (String) -> Void
    ) async throws -> StreamIteration {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/chat/completions")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "model": OpenAIModel.chat,
            "messages": messages.map { $0.toRequestBody() },
            "stream": true,
        ]
        if let tools, !tools.isEmpty {
            body["tools"] = tools
            body["tool_choice"] = "auto"
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw OpenAIError.httpFailure
        }

        var accumulated = PartialAssistantMessage()
        var content = ""
        for try await line in bytes.lines {
            try Task.checkCancellation()
            guard line.hasPrefix("data: ") else { continue }
            let payload = String(line.dropFirst(6))
            if payload == "[DONE]" { break }
            guard let data = payload.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let choices = json["choices"] as? [[String: Any]],
                  let delta = choices.first?["delta"] as? [String: Any]
            else { continue }

            accumulated.merge(delta: delta)
            if let chunk = delta["content"] as? String, !chunk.isEmpty {
                content += chunk
                await MainActor.run { onChunk(chunk) }
            }
        }

        return StreamIteration(content: content, toolCalls: accumulated.toolCalls)
    }

    func generateThreadTitle(previousTitle: String?, context: String) async throws -> String? {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/chat/completions")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        let system =
            "You name chat threads for a sidebar. Reply with a short, descriptive title (a few words). " +
            "No quotes or extra punctuation. " +
            "If the previous title still fits the recent conversation, reply with exactly: UNCHANGED"

        let userBlock = [
            previousTitle.map { "Previous title: \($0)" } ?? "Previous title: (none)",
            "",
            "Recent conversation:",
            context,
        ].joined(separator: "\n")

        let body: [String: Any] = [
            "model": OpenAIModel.title,
            "messages": [
                ["role": "system", "content": system],
                ["role": "user", "content": userBlock],
            ],
            "max_completion_tokens": 512,
            "reasoning_effort": "low",
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw OpenAIError.httpFailure
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = json["choices"] as? [[String: Any]],
              let content = choices.first?["message"] as? [String: Any],
              let raw = content["content"] as? String
        else { return nil }

        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.uppercased() == "UNCHANGED" { return nil }
        return trimmed
            .replacingOccurrences(of: #"["'`]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func parseToolArguments(_ raw: String) -> [String: Any] {
        guard let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return json
    }

    private func parseJSONValue(_ raw: String) -> JSONValue? {
        guard let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data)
        else { return nil }
        return JSONValue(from: json)
    }
}

private struct PartialAssistantMessage {
    private var content: String?
    private var toolCallParts: [Int: (id: String?, name: String?, arguments: String?)] = [:]

    mutating func merge(delta: [String: Any]) {
        if let chunk = delta["content"] as? String {
            content = (content ?? "") + chunk
        }
        guard let toolCalls = delta["tool_calls"] as? [[String: Any]] else { return }
        for part in toolCalls {
            let index = part["index"] as? Int ?? toolCallParts.count
            var existing = toolCallParts[index] ?? (id: nil, name: nil, arguments: nil)
            if let id = part["id"] as? String { existing.id = id }
            if let function = part["function"] as? [String: Any] {
                if let name = function["name"] as? String { existing.name = (existing.name ?? "") + name }
                if let args = function["arguments"] as? String {
                    existing.arguments = (existing.arguments ?? "") + args
                }
            }
            toolCallParts[index] = existing
        }
    }

    var toolCalls: [AccumulatedToolCall]? {
        let sorted = toolCallParts.keys.sorted().compactMap { index -> AccumulatedToolCall? in
            guard let part = toolCallParts[index],
                  let id = part.id,
                  let name = part.name
            else { return nil }
            return AccumulatedToolCall(id: id, name: name, arguments: part.arguments ?? "{}")
        }
        return sorted.isEmpty ? nil : sorted
    }
}

enum OpenAIError: LocalizedError {
    case missingAPIKey
    case httpFailure

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            return "Add your OpenAI API key in Settings."
        case .httpFailure:
            return "OpenAI request failed. Check your key and network."
        }
    }
}
