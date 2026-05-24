import Foundation

enum OpenAIModel {
  /// Keep in sync with `src/shared/openaiModels.ts` (`OPENAI_CHAT_MODEL`).
  static let chat = "gpt-5.4"
}

struct ChatCompletionMessage: Encodable {
    let role: String
    let content: String
}

@MainActor
final class OpenAIClient {
    private let apiKey: String
    private var activeTask: URLSessionDataTask?

    init(apiKey: String) {
        self.apiKey = apiKey
    }

    func cancel() {
        activeTask?.cancel()
        activeTask = nil
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

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw OpenAIError.httpFailure
        }

        var full = ""
        for try await line in bytes.lines {
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
            onChunk(content)
        }
        return full
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
