import Foundation

/// Mirrors `src/shared/conversationTitlePolicy.ts`.
enum ConversationTitlePolicy {
    private static let refineEvery = 4

    static func shouldRefine(messages: [MessageRecord], title: String?) -> Bool {
        let users = messages.filter { $0.messageRole == .user }.count
        let assistants = messages.filter { $0.messageRole == .assistant }.count
        if users < 1 { return false }
        if assistants == 0 {
            return users == 1 && isTimePlaceholderTitle(title)
        }
        if assistants == 1 { return true }
        return users > 1 && users % refineEvery == 0
    }

    static func isTimePlaceholderTitle(_ title: String?) -> Bool {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty { return true }
        return trimmed.range(
            of: #"^(?:Dictation|New chat|Empty chat) @ "#,
            options: .regularExpression
        ) != nil
    }

    /// Initial sidebar label for voice-dictation threads; LLM may replace when configured.
    /// Mirrors `formatVoiceDictationTitle` in `src/shared/conversationSession.ts`.
    static func voiceDictationTitle(at date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.setLocalizedDateFormatFromTemplate("jm")
        return "Dictation @ \(formatter.string(from: date))"
    }

    /// Mirrors `formatNewChatLabel` in `src/shared/conversationSession.ts`.
    static func formatNewChatLabel(createdAtMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(createdAtMs) / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.setLocalizedDateFormatFromTemplate("jm")
        return "Empty chat @ \(formatter.string(from: date))"
    }

    static func conversationDisplayTitle(title: String?, createdAtMs: Int64) -> String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty { return trimmed }
        return formatNewChatLabel(createdAtMs: createdAtMs)
    }

    static func buildContext(messages: [MessageRecord], maxChars: Int = 2400) -> String {
        var parts: [String] = []
        var total = 0
        for message in messages.reversed() where total < maxChars {
            let role = message.messageRole == .user ? "User" : "Assistant"
            let chunk = "\(role): \(message.content)"
            parts.insert(chunk, at: 0)
            total += chunk.count
        }
        let joined = parts.joined(separator: "\n\n")
        if joined.count <= maxChars { return joined }
        return String(joined.suffix(maxChars))
    }
}
