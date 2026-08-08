import Foundation

/// Dictation reply-strip action from bundled `dictationSuggestedPrompts.json`.
enum DictationSuggestedPrompts {
    struct Contract {
        var systemPrompt: String
        var vocabulary: [String]
        var runAction: String
        var maxCompletionTokens: Int
        var timeoutSecs: TimeInterval
    }

    static let contract = loadContract()
    static var runAction: String { contract.runAction }

    static func displayLabel(for action: String) -> String {
        let clamped = clampAction(action)
        return clamped == runAction ? "Run" : clamped
    }

    static func buildUserMessage(transcript: String) -> String {
        "Classify this dictation for a reply-strip action.\n\n<<<TRANSCRIPT>>>\n\(transcript.trimmingCharacters(in: .whitespacesAndNewlines))\n<<<END>>>"
    }

    static func clampAction(_ raw: Any?) -> String {
        let run = contract.runAction.isEmpty ? "run" : contract.runAction
        func tryWord(_ value: String) -> String? {
            let trimmed = value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            guard !trimmed.isEmpty else { return nil }
            if trimmed.caseInsensitiveCompare(run) == .orderedSame { return run }
            return contract.vocabulary.first { $0.caseInsensitiveCompare(trimmed) == .orderedSame }
        }
        if let dict = raw as? [String: Any] {
            if let action = dict["action"] as? String, let w = tryWord(action) { return w }
            if let first = (dict["prompts"] as? [Any])?.first as? String, let w = tryWord(first) { return w }
        } else if let s = raw as? String {
            if let w = tryWord(s) { return w }
            if let data = s.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) { return clampAction(json) }
        }
        return run
    }

    private static func loadContract() -> Contract {
        guard let url = Bundle.main.url(forResource: "dictationSuggestedPrompts", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let systemPrompt = json["systemPrompt"] as? String, !systemPrompt.isEmpty,
              let vocabulary = json["vocabulary"] as? [String], !vocabulary.isEmpty,
              let runAction = json["runAction"] as? String,
              let maxCompletionTokens = json["maxCompletionTokens"] as? Int,
              let timeoutSecs = json["timeoutSecs"] as? Double
        else {
            assertionFailure("dictationSuggestedPrompts.json failed to load from the app bundle")
            return Contract(
                systemPrompt: "Return JSON {\"action\":\"run\"} or Summarize/Distill/Breakdown/Proofread.",
                vocabulary: ["Summarize", "Distill", "Breakdown", "Proofread"],
                runAction: "run",
                maxCompletionTokens: 64,
                timeoutSecs: 8
            )
        }
        return Contract(
            systemPrompt: systemPrompt,
            vocabulary: vocabulary,
            runAction: runAction,
            maxCompletionTokens: maxCompletionTokens,
            timeoutSecs: timeoutSecs
        )
    }
}
