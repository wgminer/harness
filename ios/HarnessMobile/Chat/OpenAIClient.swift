import Foundation

enum OpenAIModel {
    /// Keep in sync with `src/shared/openaiModels.ts` (`OPENAI_CHAT_MODEL`).
    static let chat = "gpt-5.4"
    /// Keep in sync with `src/shared/openaiModels.ts` (`OPENAI_TITLE_MODEL`).
    static let title = "gpt-5.4-nano"
}

struct ChatCompletionMessage: Encodable {
    let role: String
    let content: String
}

@MainActor
final class OpenAIClient {
    private let apiKey: String
    private var streamTask: Task<String, Error>?

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
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/chat/completions")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "model": OpenAIModel.chat,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
            "stream": true,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let task = Task<String, Error> {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
                throw OpenAIError.httpFailure
            }

            var full = ""
            for try await line in bytes.lines {
                try Task.checkCancellation()
                guard line.hasPrefix("data: ") else { continue }
                let payload = String(line.dropFirst(6))
                if payload == "[DONE]" { break }
                guard let data = payload.data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let choices = json["choices"] as? [[String: Any]],
                      let delta = choices.first?["delta"] as? [String: Any],
                      let content = delta["content"] as? String,
                      !content.isEmpty
                else { continue }
                full += content
                await MainActor.run { onChunk(content) }
            }
            return full
        }
        streamTask = task
        defer { streamTask = nil }
        return try await task.value
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
